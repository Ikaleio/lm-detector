// Package lmfpd identifies which language model wrote a reply from the numbers it picks. It scores saved replies,
// generates challenges, and runs one live detection round against an OpenAI- or Anthropic-compatible API.
package lmfpd

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

// Output is one model reply and the number count its challenge asked for.
type Output struct {
	Text          string `json:"text"`
	ExpectedCount int    `json:"expected_count"`
}

// Challenge is one prompt sent to the model.
type Challenge struct {
	ID            string `json:"id"`
	ExpectedCount int    `json:"expected_count"`
	Prompt        string `json:"prompt"`
}

// API selects the request format.
type API string

const (
	APIResponses       API = "responses"
	APIChatCompletions API = "chat_completions"
	APIMessages        API = "messages"
)

// DetectConfig configures a live request. Zero values select the defaults.
type DetectConfig struct {
	BaseURL string
	APIKey  string
	Model   string
	// API defaults to APIResponses.
	API API
	// Effort is the reasoning effort sent to the model. Empty sends none; "none" disables thinking on Messages.
	Effort string
	// ServiceTier is flex, default, fast, or ultrafast. Empty means default, which sends no tier field.
	ServiceTier string
	// NoStream requests a JSON response instead of SSE.
	NoStream bool
	// Strict requires three complete replies and no truncation. It needs Count 3.
	Strict bool
	// Count is the number of challenges per round, 1 to 3. Zero means 3.
	Count int
	// Parallel is the number of concurrent requests, 1 to 3, capped at Count. Zero means 3.
	Parallel int
	// Timeout bounds the wait for the first SSE byte or the whole JSON response. Zero means 120 s.
	Timeout time.Duration
}

// AnalysisResult is one candidate model.
type AnalysisResult struct {
	Model       string   `json:"model"`
	DisplayName string   `json:"display_name"`
	Family      string   `json:"family"`
	FamilyName  string   `json:"family_name"`
	Score       float64  `json:"score"`
	Probability *float64 `json:"probability"`
}

// Diagnostic describes how one output was parsed.
type Diagnostic struct {
	Index              int  `json:"index"`
	ParsedNumbers      int  `json:"parsed_numbers"`
	MinimumNumbers     int  `json:"minimum_numbers"`
	Accepted           bool `json:"accepted"`
	RawOutOfRangeCount int  `json:"raw_out_of_range_count"`
}

// Sequence summarizes how consecutive numbers change across the accepted outputs.
type Sequence struct {
	Autocorrelation float64 `json:"autocorrelation"`
	SmallStepShare  float64 `json:"small_step_share"`
	ModelLike       bool    `json:"model_like"`
}

// Calibration identifies the temperature calibration behind the probabilities.
type Calibration struct {
	Method string  `json:"method"`
	Run    string  `json:"run"`
	Tau    float64 `json:"tau"`
	SHA256 *string `json:"sha256"`
}

// ModelVersion identifies the detector.
type ModelVersion struct {
	BaseSHA256 string `json:"base_sha256"`
}

// Evidence explains the decision.
type Evidence struct {
	Insufficient bool   `json:"insufficient"`
	Label        string `json:"label"`
	Reason       string `json:"reason"`
	// Threshold is always null.
	Threshold *float64 `json:"threshold"`
	Method    string   `json:"method"`
}

// Analysis is the scoring result. Every field is always present, so the JSON shape matches the other SDKs.
type Analysis struct {
	// Decision is scored, partial, unscorable, or not_model.
	Decision             string `json:"decision"`
	Prediction           string `json:"prediction"`
	PredictionName       string `json:"prediction_name"`
	FamilyPrediction     string `json:"family_prediction"`
	FamilyPredictionName string `json:"family_prediction_name"`
	// Results lists candidates by ranking score, best first. Empty unless the decision is scored or partial.
	Results      []AnalysisResult `json:"results"`
	RankingScore *float64         `json:"ranking_score"`
	// Probability is the closed-set probability of the top candidate within the reference bank.
	Probability       *float64     `json:"probability"`
	ProbabilityStatus string       `json:"probability_status"`
	ProbabilityScope  *string      `json:"probability_scope"`
	Calibration       *Calibration `json:"calibration"`
	UsedOutputs       int          `json:"used_outputs"`
	Diagnostics       []Diagnostic `json:"diagnostics"`
	Sequence          *Sequence    `json:"sequence"`
	Method            string       `json:"method"`
	ModelVersion      ModelVersion `json:"model_version"`
	Evidence          Evidence     `json:"evidence"`
}

// Sample is one checked reply.
type Sample struct {
	// State is complete, truncated, failed, or cancelled once the request settles.
	State string `json:"state"`
	// Text holds the numbers used for scoring, capped at ExpectedCount when the reply had more.
	Text          string  `json:"text"`
	RawText       string  `json:"raw_text"`
	Count         int     `json:"count"`
	ExpectedCount int     `json:"expected_count"`
	ResponseModel *string `json:"response_model"`
	ResponseID    *string `json:"response_id"`
	Error         *string `json:"error"`
}

// DetectResult is one live detection round.
type DetectResult struct {
	Challenges []Challenge `json:"challenges"`
	Samples    []Sample    `json:"samples"`
	Analysis   *Analysis   `json:"analysis"`
	// Error says why the round has no ranking, or is nil when it has one.
	Error *string `json:"error"`
}

// Request is the HTTP request Detect sends for one prompt.
type Request struct {
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    map[string]any    `json:"body"`
}

// LoadOptions configures Load.
type LoadOptions struct {
	// Sources are base URLs ending in "/", tried in order, or a single local directory such as projects/data. Empty
	// means DefaultDataURLs.
	Sources []string
	// Cache is the cache file path. Empty means <OS cache directory>/lmfpd/data.bin.
	Cache string
	// TTL is how long after a check the cache is refreshed in the background. Zero means 24 hours; a negative value
	// checks on every load.
	TTL time.Duration
}

// Detector holds a loaded reference bank and detector. It is safe for concurrent use.
type Detector struct {
	bank     *bank
	detector *detector
}

// BuiltAt is the built_at of the reference bank, which identifies the data build.
func (d *Detector) BuiltAt() string { return d.bank.BuiltAt }

// Analyze scores one to three saved replies like `fpd --input`. Three valid replies give a calibrated ranking;
// fewer give a partial ranking unless strict is set.
func (d *Detector) Analyze(outputs []Output, strict bool) (*Analysis, error) {
	if len(outputs) < 1 || len(outputs) > 3 {
		return nil, errInvalidOutputs
	}
	prepared := make([]Output, len(outputs))
	for i, output := range outputs {
		if output.ExpectedCount <= 0 || output.ExpectedCount > maxSafeInteger {
			return nil, errInvalidOutputs
		}
		numbers := ParseNumbers(output.Text)
		text := output.Text
		if !strict && len(numbers) > output.ExpectedCount {
			text = joinNumbers(numbers[:output.ExpectedCount])
		}
		if len(numbers) < minimumNumbers(output.ExpectedCount) {
			text = ""
		}
		prepared[i] = Output{Text: text, ExpectedCount: output.ExpectedCount}
	}
	return d.score(prepared, strict)
}

// Detect sends one round of challenges to the model API and scores the replies. It returns an error only for an
// invalid config; request failures are reported in the result.
func (d *Detector) Detect(ctx context.Context, config DetectConfig) (*DetectResult, error) {
	opts, err := detectOptions(config)
	if err != nil {
		return nil, err
	}
	challenges := generateChallenges(opts.count)
	samples := make([]Sample, len(challenges))
	for i, challenge := range challenges {
		samples[i] = Sample{State: "queued", ExpectedCount: challenge.ExpectedCount}
	}
	var next atomic.Int64
	var wg sync.WaitGroup
	for range opts.parallel {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ctx.Err() == nil {
				i := int(next.Add(1) - 1)
				if i >= len(challenges) {
					return
				}
				samples[i] = requestSample(ctx, opts, challenges[i])
			}
		}()
	}
	wg.Wait()
	result := &DetectResult{Challenges: challenges, Samples: samples}
	if ctx.Err() != nil {
		for i := range samples {
			if samples[i].State == "queued" {
				samples[i].State = "cancelled"
				samples[i].Error = ptr("Cancelled before dispatch.")
			}
		}
		result.Error = ptr("Cancelled. This round was not scored.")
		return result, nil
	}
	d.scoreRound(result, opts.strict)
	return result, nil
}

// scoreRound applies the CLI round rules: no accepted sample, or fewer than three in strict mode, is not scored.
func (d *Detector) scoreRound(result *DetectResult, strict bool) {
	outputs := make([]Output, len(result.Samples))
	accepted := 0
	for i, sample := range result.Samples {
		outputs[i].ExpectedCount = sample.ExpectedCount
		if sample.State == "complete" || sample.State == "truncated" {
			outputs[i].Text = sample.Text
			accepted++
		}
	}
	if accepted == 0 || (strict && accepted != 3) {
		if strict {
			result.Error = ptr("Strict mode requires 3/3 successful samples; received " + itoa(accepted) + "/3.")
		} else {
			result.Error = ptr("No valid samples. This round cannot be scored.")
		}
		return
	}
	analysis, err := d.score(outputs, strict)
	if err != nil {
		result.Error = ptr(err.Error())
		return
	}
	result.Analysis = analysis
	if len(analysis.Results) == 0 {
		result.Error = ptr(analysis.Evidence.Reason)
	}
}

// GenerateChallenges returns count random challenges, 1 to 3, in one of five languages, each asking for a distinct
// count from 292 to 332.
func GenerateChallenges(count int) ([]Challenge, error) {
	if count < 1 || count > 3 {
		return nil, errors.New("count must be an integer from 1 to 3.")
	}
	return generateChallenges(count), nil
}

// RequestSample sends one challenge and returns the checked reply. Config and request failures are reported in
// Sample.Error.
func RequestSample(ctx context.Context, config DetectConfig, challenge Challenge) Sample {
	opts, err := detectOptions(config)
	if err != nil {
		return Sample{State: "failed", ExpectedCount: challenge.ExpectedCount, Error: ptr(err.Error())}
	}
	return requestSample(ctx, opts, challenge)
}

// BuildRequest returns the HTTP request Detect sends for one prompt, or the config error.
func BuildRequest(config DetectConfig, prompt string) (*Request, error) {
	opts, err := detectOptions(config)
	if err != nil {
		return nil, err
	}
	return buildRequest(opts, prompt), nil
}

func ptr[T any](v T) *T { return &v }
