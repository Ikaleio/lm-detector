package lmfpd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

// sampleClient never follows redirects, so a 3xx is reported like any other non-2xx status. The default transport
// honors HTTPS_PROXY, HTTP_PROXY, and NO_PROXY, and never proxies loopback addresses.
var sampleClient = &http.Client{
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

var (
	errRefused         = errors.New("The model refused the request.")
	errInvalidResponse = errors.New("The server did not return valid JSON or SSE.")
	ansiPattern        = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)
	controlPattern     = regexp.MustCompile(`[\x00-\x1f\x7f-\x{9f}]`)
	trailingDigits     = regexp.MustCompile(`[0-9]+$`)
	completedFinishes  = map[string]bool{"stop": true, "end_turn": true, "completed": true}
)

// Loose accessors for provider payloads, mirroring the JavaScript optional-chaining reads.
type payload = map[string]any

func record(v any) payload {
	m, _ := v.(payload)
	return m
}

func items(v any) []payload {
	list, _ := v.([]any)
	out := make([]payload, len(list))
	for i, item := range list {
		out[i] = record(item)
	}
	return out
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func firstString(values ...any) string {
	for _, v := range values {
		if s := str(v); s != "" {
			return s
		}
	}
	return ""
}

// truthy follows JavaScript truthiness for decoded JSON values.
func truthy(v any) bool {
	switch v := v.(type) {
	case nil:
		return false
	case bool:
		return v
	case string:
		return v != ""
	case float64:
		return v != 0
	}
	return true
}

func responseText(data payload) string {
	var b strings.Builder
	for _, item := range items(data["output"]) {
		if item["type"] != "message" {
			continue
		}
		for _, part := range items(item["content"]) {
			if part["type"] == "output_text" {
				b.WriteString(str(part["text"]))
			}
		}
	}
	return b.String()
}

// cleanError redacts the API key, strips terminal escapes and control characters, and keeps 500 UTF-16 units.
func cleanError(message, key string) string {
	if key != "" {
		message = strings.ReplaceAll(message, key, "[REDACTED]")
	}
	message = controlPattern.ReplaceAllString(ansiPattern.ReplaceAllString(message, ""), " ")
	units := 0
	for i, r := range message {
		units += utf16.RuneLen(r)
		if units > 500 {
			return message[:i]
		}
	}
	return message
}

// sampler holds the state of one requestSample call (shared/detect-request.ts).
type sampler struct {
	opts     *options
	expected int
	sample   Sample
	finish   string
	terminal bool
	// truncated is set once the reply reached expected numbers; later text cannot change the sample.
	truncated bool
	raw       string
}

func (s *sampler) acceptText(text string, final bool) {
	s.sample.RawText = text
	parsed := text
	if !final {
		// A trailing digit can belong to an unfinished SSE token (for example, 3 -> 355).
		parsed = trailingDigits.ReplaceAllString(text, "")
	}
	numbers := ParseNumbers(parsed)
	s.sample.Count = len(numbers)
	s.sample.Text = text
	if !s.opts.strict && len(numbers) >= s.expected {
		s.sample.Text = joinNumbers(numbers[:s.expected])
		s.sample.Count = s.expected
		s.truncated = !final || len(numbers) > s.expected
	}
}

func (s *sampler) appendText(part string) {
	s.raw += part
	if !s.truncated {
		s.acceptText(s.raw, false)
	}
}

func (s *sampler) metadata(data payload) {
	if model, ok := data["model"].(string); ok {
		s.sample.ResponseModel = ptr(model)
	}
	if id, ok := data["id"].(string); ok {
		s.sample.ResponseID = ptr(id)
	}
}

func upstreamError(data payload) error {
	if truthy(data["error"]) || data["type"] == "error" {
		message := firstString(record(data["error"])["message"], data["message"], data["error"])
		if message == "" {
			message = "Request failed."
		}
		return errors.New("Upstream error: " + message)
	}
	return nil
}

func (s *sampler) event(frame string) error {
	var lines []string
	for _, line := range strings.FieldsFunc(frame, func(r rune) bool { return r == '\n' || r == '\r' }) {
		if data, ok := strings.CutPrefix(line, "data:"); ok {
			lines = append(lines, strings.TrimPrefix(data, " "))
		}
	}
	text := strings.Join(lines, "\n")
	if text == "" {
		return nil
	}
	if strings.TrimSpace(text) == "[DONE]" {
		s.terminal = true
		return nil
	}
	var decoded any
	if json.Unmarshal([]byte(text), &decoded) != nil {
		return errors.New("The SSE response contains invalid JSON.")
	}
	data := record(decoded)
	if err := upstreamError(data); err != nil {
		return err
	}
	s.metadata(data)
	kind := str(data["type"])
	switch s.opts.format {
	case formatOpenAI:
		choices := items(data["choices"])
		var choice payload
		for _, c := range choices {
			if index, ok := c["index"].(float64); ok && index == 0 {
				choice = c
				break
			}
		}
		if choice == nil && len(choices) > 0 {
			choice = choices[0]
		}
		delta := record(choice["delta"])
		if truthy(delta["refusal"]) {
			return errRefused
		}
		if truthy(choice["finish_reason"]) {
			s.finish = str(choice["finish_reason"])
		}
		if content, ok := delta["content"].(string); ok {
			s.appendText(content)
		}
	case formatAnthropic:
		block, delta := record(data["content_block"]), record(data["delta"])
		switch kind {
		case "message_start":
			s.metadata(record(data["message"]))
		case "content_block_start":
			if block["type"] == "text" {
				s.appendText(str(block["text"]))
			}
		case "content_block_delta":
			if delta["type"] == "text_delta" {
				s.appendText(str(delta["text"]))
			}
		case "message_delta":
			if reason := str(delta["stop_reason"]); reason != "" {
				s.finish = reason
			}
		case "message_stop":
			s.terminal = true
		}
	default:
		switch kind {
		case "response.created", "response.in_progress":
			s.metadata(record(data["response"]))
		case "response.output_text.delta":
			s.appendText(str(data["delta"]))
		case "response.output_text.done":
			if s.sample.RawText == "" {
				s.acceptText(str(data["text"]), true)
			}
		case "response.output_item.done":
			if s.sample.RawText == "" {
				s.acceptText(responseText(payload{"output": []any{data["item"]}}), true)
			}
		case "response.refusal.delta":
			return errRefused
		case "response.completed":
			response := record(data["response"])
			s.metadata(response)
			s.terminal = true
			s.finish = str(response["status"])
			if s.finish == "" {
				s.finish = "completed"
			}
			if full := responseText(response); full != "" && !s.truncated {
				s.acceptText(full, true)
			}
		case "response.failed", "response.incomplete":
			response := record(data["response"])
			reason := firstString(record(response["error"])["message"], record(response["incomplete_details"])["reason"], kind)
			return errors.New("Responses request did not complete: " + reason + ".")
		}
	}
	if s.finish == "refusal" || s.finish == "content_filter" {
		return errRefused
	}
	return nil
}

// frameEnd finds the earliest SSE frame delimiter and returns its index and length, or -1.
func frameEnd(buf []byte) (int, int) {
	for i := range buf {
		switch {
		case bytes.HasPrefix(buf[i:], []byte("\r\n\r\n")):
			return i, 4
		case bytes.HasPrefix(buf[i:], []byte("\n\n")), bytes.HasPrefix(buf[i:], []byte("\r\r")):
			return i, 2
		}
	}
	return -1, 0
}

func lossy(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	return strings.ToValidUTF8(string(b), "\uFFFD")
}

func (s *sampler) readSSE(body io.Reader, firstByte func()) error {
	var buf []byte
	chunk := make([]byte, 32<<10)
	started := false
	for !s.terminal && !s.truncated {
		n, readErr := body.Read(chunk)
		if n > 0 {
			if !started {
				started = true
				firstByte()
			}
			buf = append(buf, chunk[:n]...)
			for !s.terminal && !s.truncated {
				end, size := frameEnd(buf)
				if end < 0 {
					break
				}
				if err := s.event(lossy(buf[:end])); err != nil {
					return err
				}
				buf = buf[end+size:]
			}
		}
		if readErr == io.EOF {
			if !s.terminal && !s.truncated && len(bytes.TrimSpace(buf)) > 0 {
				return s.event(lossy(buf))
			}
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
	return nil
}

func (s *sampler) readJSON(body io.Reader, done func()) error {
	content, err := io.ReadAll(body)
	var decoded any
	if err == nil {
		err = json.Unmarshal(content, &decoded)
	}
	if err != nil {
		return errInvalidResponse
	}
	done()
	data := record(decoded)
	if err := upstreamError(data); err != nil {
		return err
	}
	s.metadata(data)
	var text string
	switch s.opts.format {
	case formatResponses:
		text, s.finish = responseText(data), str(data["status"])
		s.terminal = s.finish == "completed"
	case formatAnthropic:
		var b strings.Builder
		for _, part := range items(data["content"]) {
			if part["type"] == "text" {
				b.WriteString(str(part["text"]))
			}
		}
		text, s.finish, s.terminal = b.String(), str(data["stop_reason"]), true
	default:
		var choice payload
		if choices := items(data["choices"]); len(choices) > 0 {
			choice = choices[0]
		}
		message := record(choice["message"])
		if truthy(message["refusal"]) {
			return errRefused
		}
		text, s.finish, s.terminal = str(message["content"]), str(choice["finish_reason"]), true
	}
	if s.finish == "refusal" || s.finish == "content_filter" {
		return errRefused
	}
	if !s.terminal || !completedFinishes[s.finish] {
		return s.incomplete()
	}
	s.acceptText(text, true)
	return nil
}

func (s *sampler) incomplete() error {
	finish := s.finish
	if finish == "" {
		finish = "missing finish status"
	}
	return errors.New("The response did not complete (" + finish + ").")
}

func httpError(resp *http.Response) error {
	content, _ := io.ReadAll(resp.Body)
	body := lossy(content)
	detail := body
	var decoded any
	if json.Unmarshal(content, &decoded) == nil {
		data := record(decoded)
		if message := firstString(record(data["error"])["message"], data["message"]); message != "" {
			detail = message
		}
	}
	if detail == "" {
		detail = strings.TrimPrefix(resp.Status, strconv.Itoa(resp.StatusCode)+" ")
	}
	return errors.New("HTTP " + strconv.Itoa(resp.StatusCode) + ": " + detail)
}

// run sends the request and checks the reply. The returned error becomes Sample.Error.
func (s *sampler) run(ctx context.Context, prompt string, stopTimer func() bool) error {
	request := buildRequest(s.opts, prompt)
	body, err := json.Marshal(request.Body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, request.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	for name, value := range request.Headers {
		req.Header.Set(name, value)
	}
	resp, err := sampleClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return httpError(resp)
	}
	firstByte := func() { stopTimer() }
	if strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream") {
		err = s.readSSE(resp.Body, firstByte)
	} else {
		err = s.readJSON(resp.Body, firstByte)
	}
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !s.truncated && (!s.terminal || !completedFinishes[s.finish]) {
		return s.incomplete()
	}
	if !s.truncated {
		s.acceptText(s.sample.RawText, true)
	}
	if minimum := minimumNumbers(s.expected); s.sample.Count < minimum {
		return errors.New("Too few valid numbers: " + strconv.Itoa(s.sample.Count) + "; need at least " + strconv.Itoa(minimum) + ".")
	}
	return nil
}

// requestSample ports shared/detect-request.ts requestSample. The timeout covers the wait for the first SSE byte or
// the whole JSON response.
func requestSample(parent context.Context, opts *options, challenge Challenge) Sample {
	s := &sampler{opts: opts, expected: challenge.ExpectedCount,
		sample: Sample{State: "waiting", ExpectedCount: challenge.ExpectedCount}}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	var timedOut atomic.Bool
	timer := time.AfterFunc(opts.timeout, func() {
		timedOut.Store(true)
		cancel()
	})
	defer timer.Stop()
	err := parent.Err()
	if err == nil {
		err = s.run(ctx, challenge.Prompt, timer.Stop)
	}
	switch {
	case err == nil:
		s.sample.State = "complete"
		if s.truncated {
			s.sample.State = "truncated"
		}
	case parent.Err() != nil:
		s.sample.State, s.sample.Error = "cancelled", ptr("Cancelled.")
	case timedOut.Load():
		waiting := "the JSON response"
		if opts.stream {
			waiting = "the first SSE byte"
		}
		seconds := strconv.FormatFloat(float64(opts.timeout/time.Millisecond)/1000, 'f', -1, 64)
		s.sample.State, s.sample.Error = "failed", ptr("Timed out after "+seconds+"s waiting for "+waiting+".")
	default:
		s.sample.State, s.sample.Error = "failed", ptr(cleanError(err.Error(), opts.apiKey))
	}
	return s.sample
}
