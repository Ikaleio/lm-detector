// Command conformance checks the Go SDK against sdk/conformance.
// Usage: go run ./cmd/conformance <conformance dir> <data dir>
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"

	lmfpd "github.com/Ikaleio/lm-detector/sdk/go"
)

var failures int

func toJSON(v any) any {
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	var out any
	if err := json.Unmarshal(data, &out); err != nil {
		panic(err)
	}
	return out
}

func show(v any) string {
	data, _ := json.Marshal(v)
	return string(data)
}

// compare reports every mismatch. Numbers match within a relative 1e-9; everything else must be identical.
func compare(file, name string, expected, actual any, path string) {
	fail := func() {
		failures++
		fmt.Printf("FAIL %s:%s: %s expected %s got %s\n", file, name, path, show(expected), show(actual))
	}
	switch e := expected.(type) {
	case float64:
		a, ok := actual.(float64)
		if !ok || !(math.Abs(e-a) <= 1e-9*math.Max(1, math.Max(math.Abs(e), math.Abs(a)))) {
			fail()
		}
	case []any:
		a, ok := actual.([]any)
		if !ok || len(a) != len(e) {
			fail()
			return
		}
		for i := range e {
			compare(file, name, e[i], a[i], path+"["+strconv.Itoa(i)+"]")
		}
	case map[string]any:
		a, ok := actual.(map[string]any)
		if !ok {
			fail()
			return
		}
		keys, actualKeys := make([]string, 0, len(e)), make([]string, 0, len(a))
		for k := range e {
			keys = append(keys, k)
		}
		for k := range a {
			actualKeys = append(actualKeys, k)
		}
		slices.Sort(keys)
		slices.Sort(actualKeys)
		if !slices.Equal(keys, actualKeys) {
			fail()
			return
		}
		for _, k := range keys {
			compare(file, name, e[k], a[k], path+"."+k)
		}
	default:
		if expected != actual {
			fail()
		}
	}
}

func fixture(dir, name string, v any) {
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err == nil {
		err = json.Unmarshal(data, v)
	}
	if err != nil {
		fmt.Printf("FAIL %s: %v\n", name, err)
		os.Exit(1)
	}
}

type requestConfig struct {
	BaseURL     string    `json:"base_url"`
	APIKey      string    `json:"api_key"`
	Model       string    `json:"model"`
	API         lmfpd.API `json:"api"`
	Stream      bool      `json:"stream"`
	Effort      string    `json:"effort"`
	ServiceTier string    `json:"service_tier"`
	Timeout     *float64  `json:"timeout"`
}

type streamCase struct {
	Name          string         `json:"name"`
	API           lmfpd.API      `json:"api"`
	Stream        bool           `json:"stream"`
	Strict        bool           `json:"strict"`
	ExpectedCount int            `json:"expected_count"`
	Expected      map[string]any `json:"expected"`
	Response      struct {
		Status      int    `json:"status"`
		ContentType string `json:"content_type"`
		Body        string `json:"body"`
	} `json:"response"`
}

func main() {
	if len(os.Args) != 3 {
		fmt.Println("Usage: conformance <conformance dir> <data dir>")
		os.Exit(2)
	}
	dir, dataDir := os.Args[1], os.Args[2]

	_, source, _, _ := runtime.Caller(0)
	packaged, err := os.ReadFile(filepath.Join(filepath.Dir(source), "..", "..", "templates.json"))
	if err != nil {
		fmt.Println("FAIL templates.json:", err)
		os.Exit(1)
	}
	reference, err := os.ReadFile(filepath.Join(dir, "templates.json"))
	if err != nil || !bytes.Equal(packaged, reference) {
		failures++
		fmt.Println("FAIL templates.json: sdk/go/templates.json differs from conformance/templates.json")
	}

	var parse []struct {
		Text    string `json:"text"`
		Numbers []any  `json:"numbers"`
	}
	fixture(dir, "parse.json", &parse)
	for i, item := range parse {
		compare("parse.json", strconv.Itoa(i), toJSON(item.Numbers), toJSON(lmfpd.ParseNumbers(item.Text)), "$")
	}

	var requests []struct {
		Name     string        `json:"name"`
		Config   requestConfig `json:"config"`
		Prompt   string        `json:"prompt"`
		Expected any           `json:"expected"`
	}
	fixture(dir, "requests.json", &requests)
	for _, item := range requests {
		c := item.Config
		timeout := time.Duration(0)
		if c.Timeout != nil {
			if *c.Timeout == 0 {
				timeout = -1 * time.Second
			} else {
				timeout = time.Duration(*c.Timeout * float64(time.Second))
			}
		}
		request, err := lmfpd.BuildRequest(lmfpd.DetectConfig{
			BaseURL: c.BaseURL, APIKey: c.APIKey, Model: c.Model, API: c.API, NoStream: !c.Stream,
			Effort: c.Effort, ServiceTier: c.ServiceTier, Timeout: timeout,
		}, item.Prompt)
		var actual any = request
		if err != nil {
			actual = map[string]string{"error": err.Error()}
		}
		compare("requests.json", item.Name, item.Expected, toJSON(actual), "$")
	}

	var streams struct {
		Cases []streamCase `json:"cases"`
	}
	fixture(dir, "streams.json", &streams)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, item := range streams.Cases {
			if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/"+item.Name+"/") {
				w.Header().Set("Content-Type", item.Response.ContentType)
				w.WriteHeader(item.Response.Status)
				_, _ = w.Write([]byte(item.Response.Body))
				return
			}
		}
		http.Error(w, "not found", http.StatusNotFound)
	}))
	for _, item := range streams.Cases {
		sample := lmfpd.RequestSample(context.Background(), lmfpd.DetectConfig{
			BaseURL: server.URL + "/" + item.Name, APIKey: "test-key", Model: "test-model",
			API: item.API, NoStream: !item.Stream, Strict: item.Strict, Timeout: 10 * time.Second,
		}, lmfpd.Challenge{ID: "conformance", Prompt: "conformance", ExpectedCount: item.ExpectedCount})
		actual := toJSON(sample).(map[string]any)
		delete(actual, "expected_count")
		compare("streams.json", item.Name, item.Expected, actual, "$")
	}
	server.Close()

	var analyze struct {
		Data struct {
			BuiltAt string `json:"built_at"`
		} `json:"data"`
		Cases []struct {
			Name     string         `json:"name"`
			Strict   bool           `json:"strict"`
			Outputs  []lmfpd.Output `json:"outputs"`
			Expected any            `json:"expected"`
		} `json:"cases"`
	}
	fixture(dir, "analyze.json", &analyze)
	detector, err := lmfpd.Load(context.Background(), lmfpd.LoadOptions{Sources: []string{dataDir}})
	if err != nil {
		fmt.Println("FAIL analyze.json:", err)
		os.Exit(1)
	}
	if detector.BuiltAt() != analyze.Data.BuiltAt {
		fmt.Println("FAIL analyze.json: analyze.json was generated for another data build; run bun run sdk:generate")
		os.Exit(1)
	}
	for _, item := range analyze.Cases {
		analysis, err := detector.Analyze(item.Outputs, item.Strict)
		var actual any = analysis
		if err != nil {
			actual = map[string]string{"error": err.Error()}
		}
		compare("analyze.json", item.Name, item.Expected, toJSON(actual), "$")
	}

	if failures > 0 {
		os.Exit(1)
	}
	fmt.Printf("ok analyze=%d parse=%d requests=%d streams=%d\n",
		len(analyze.Cases), len(parse), len(requests), len(streams.Cases))
}
