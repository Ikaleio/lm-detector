package lmfpd

import (
	"errors"
	"net/url"
	"strings"
	"time"
)

const (
	formatResponses = "responses"
	formatOpenAI    = "openai"
	formatAnthropic = "anthropic"
	// speedBeta is the Anthropic beta header that enables the `speed` field.
	speedBeta = "fast-mode-2026-02-01"
)

// options is a validated DetectConfig with the defaults filled in.
type options struct {
	baseURL, apiKey, model string
	format                 string
	effort, serviceTier    string
	stream, strict         bool
	count, parallel        int
	// timeout is rounded to whole milliseconds, like the CLI.
	timeout time.Duration
}

var (
	errInvalidURL = errors.New("Base URL must be a valid HTTP or HTTPS URL.")
	errURLParts   = errors.New("Base URL must use HTTP or HTTPS without credentials, a query, or a fragment.")
)

// detectOptions validates a config in the TypeScript SDK's order and fills the defaults.
func detectOptions(c DetectConfig) (*options, error) {
	o := &options{
		baseURL: strings.TrimSpace(c.BaseURL), apiKey: strings.TrimSpace(c.APIKey), model: strings.TrimSpace(c.Model),
		effort: c.Effort, serviceTier: c.ServiceTier, stream: !c.NoStream, strict: c.Strict,
		count: c.Count, parallel: c.Parallel,
	}
	if o.baseURL == "" || o.apiKey == "" || o.model == "" {
		return nil, errors.New("base_url, api_key, and model are required.")
	}
	switch c.API {
	case "", APIResponses:
		o.format = formatResponses
	case APIChatCompletions:
		o.format = formatOpenAI
	case APIMessages:
		o.format = formatAnthropic
	default:
		return nil, errors.New("api must be responses, chat_completions, or messages.")
	}
	switch o.serviceTier {
	case "":
		o.serviceTier = "default"
	case "flex", "default", "fast", "ultrafast":
	default:
		return nil, errors.New("service_tier must be flex, default, fast, or ultrafast.")
	}
	if o.count == 0 {
		o.count = 3
	}
	if o.count < 1 || o.count > 3 {
		return nil, errors.New("count must be an integer from 1 to 3.")
	}
	if o.parallel == 0 {
		o.parallel = 3
	}
	if o.parallel < 1 || o.parallel > 3 {
		return nil, errors.New("parallel must be an integer from 1 to 3.")
	}
	timeout := c.Timeout
	if timeout == 0 {
		timeout = 120 * time.Second
	}
	if timeout < time.Millisecond || timeout > 2147483647*time.Millisecond {
		return nil, errors.New("timeout must be between 0.001 and 2147483.647 seconds.")
	}
	if o.strict && o.count != 3 {
		return nil, errors.New("strict requires count 3.")
	}
	if _, err := requestEndpoint(o.baseURL, o.format); err != nil {
		return nil, err
	}
	o.parallel = min(o.parallel, o.count)
	o.timeout = (timeout + time.Millisecond/2) / time.Millisecond * time.Millisecond
	return o, nil
}

// requestEndpoint ports shared/detect-request.ts requestEndpoint.
func requestEndpoint(baseURL, format string) (string, error) {
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", errInvalidURL
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errURLParts
	}
	suffix := "/chat/completions"
	switch format {
	case formatResponses:
		suffix = "/responses"
	case formatAnthropic:
		suffix = "/messages"
	}
	path := strings.TrimRight(u.EscapedPath(), "/")
	if !strings.HasSuffix(path, suffix) {
		for _, endpoint := range [...]string{"/responses", "/messages", "/chat/completions"} {
			if strings.HasSuffix(path, endpoint) {
				return "", errors.New("The endpoint in --baseurl does not match --api.")
			}
		}
		if path == "" {
			path = "/v1"
		}
		path += suffix
	}
	if u.Path, err = url.PathUnescape(path); err != nil {
		return "", errInvalidURL
	}
	u.RawPath, u.ForceQuery = path, false
	return u.String(), nil
}

// buildRequest ports shared/detect-request.ts buildDetectRequest with shared/completion-request.ts completionBody.
func buildRequest(o *options, prompt string) *Request {
	accept := "application/json"
	if o.stream {
		accept = "text/event-stream"
	}
	headers := map[string]string{"Content-Type": "application/json", "Accept": accept}
	sendsTier := o.serviceTier != "default"
	if o.format == formatAnthropic {
		headers["x-api-key"] = o.apiKey
		headers["anthropic-version"] = "2023-06-01"
		if sendsTier {
			headers["anthropic-beta"] = speedBeta
		}
	} else {
		headers["Authorization"] = "Bearer " + o.apiKey
	}
	messages := []map[string]any{{"role": "user", "content": prompt}}
	setsEffort := o.effort != "" && o.effort != "default"
	var body map[string]any
	switch o.format {
	case formatAnthropic:
		body = map[string]any{"model": o.model, "messages": messages, "max_tokens": 8192, "stream": o.stream}
		if o.effort == "none" {
			body["thinking"] = map[string]any{"type": "disabled"}
		} else if setsEffort {
			body["thinking"] = map[string]any{"type": "adaptive"}
			body["output_config"] = map[string]any{"effort": o.effort}
		}
		if sendsTier {
			body["speed"] = o.serviceTier
		}
	case formatResponses:
		// buildDetectRequest deletes max_output_tokens here and max_tokens for Chat Completions.
		body = map[string]any{"model": o.model, "input": messages, "stream": o.stream, "store": false}
		if setsEffort {
			body["reasoning"] = map[string]any{"effort": o.effort}
		}
		if sendsTier {
			body["service_tier"] = o.serviceTier
		}
	default:
		body = map[string]any{"model": o.model, "messages": messages, "stream": o.stream}
		if setsEffort {
			body["reasoning_effort"] = o.effort
		}
		if sendsTier {
			body["service_tier"] = o.serviceTier
		}
		// Chat Completions streams report usage only on request.
		if o.stream {
			body["stream_options"] = map[string]any{"include_usage": true}
		}
	}
	endpoint, _ := requestEndpoint(o.baseURL, o.format)
	return &Request{URL: endpoint, Headers: headers, Body: body}
}
