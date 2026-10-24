package lmfpd

import (
	"errors"
	"sort"
	"strconv"
)

const maxSafeInteger = 1<<53 - 1

var (
	errInvalidOutputs = errors.New("Each input round must contain one to three outputs with text and a positive integer expected_count.")
	errScoringFailed  = errors.New("Scoring failed. Check that the reference bank and detector files are valid.")
)

func itoa(v int) string { return strconv.Itoa(v) }

// score ports analyzeSharedOutputs, englishAnalysis, and canonicalAnalysis. Any panic from malformed detector data
// becomes the scoring error, as the TypeScript SDK catches every scorer exception.
func (d *Detector) score(outputs []Output, strict bool) (analysis *Analysis, err error) {
	defer func() {
		if recover() != nil {
			analysis, err = nil, errScoringFailed
		}
	}()
	det, models := d.detector, d.bank.Models
	parsed := make([][]int, len(outputs))
	diagnostics := make([]Diagnostic, len(outputs))
	var accepted [][]int
	for i, output := range outputs {
		parsed[i] = ParseNumbers(output.Text)
		minimum := minimumNumbers(output.ExpectedCount)
		ok := len(parsed[i]) >= minimum
		diagnostics[i] = Diagnostic{Index: i, ParsedNumbers: len(parsed[i]), MinimumNumbers: minimum, Accepted: ok,
			RawOutOfRangeCount: rawOutOfRange(output.Text)}
		if ok {
			accepted = append(accepted, parsed[i])
		}
	}
	used := len(accepted)
	a := &Analysis{
		Results: []AnalysisResult{}, ProbabilityStatus: "unavailable", UsedOutputs: used, Diagnostics: diagnostics,
		Method: "shared-detector-v2", ModelVersion: ModelVersion{BaseSHA256: det.baseSHA256},
		Evidence: Evidence{Insufficient: true},
	}
	if used > 0 {
		a.Sequence = sequenceShape(accepted)
	}
	notModel := func() *Analysis {
		a.Decision, a.PredictionName = "not_model", "Not a model reply"
		a.Evidence.Label = "Not like a language model reply"
		a.Evidence.Reason = "Consecutive numbers change differently from the language-model replies in the reference bank. Program-generated, sorted or shuffled numbers often do this. No ranking was produced."
		a.Evidence.Method = "sequence-shape"
		return a
	}
	// ranked fills the ranking fields; only full (scored) results carry probabilities.
	ranked := func(numbers [][]int) error {
		ranking, err := det.rankNumbers(numbers)
		if err != nil {
			return err
		}
		var probabilities []float64
		if a.Decision == "scored" {
			probabilities = det.calibrate(ranking)
		}
		order := make([]int, len(det.modelIDs))
		for i := range order {
			order[i] = i
		}
		sort.SliceStable(order, func(x, y int) bool { return ranking[order[x]] > ranking[order[y]] })
		a.Results = make([]AnalysisResult, len(order))
		for k, i := range order {
			m := &models[i]
			a.Results[k] = AnalysisResult{Model: det.modelIDs[i], DisplayName: m.DisplayName, Family: m.Family,
				FamilyName: m.FamilyName, Score: ranking[i]}
			if probabilities != nil {
				a.Results[k].Probability = ptr(probabilities[i])
			}
		}
		first := order[0]
		a.Prediction, a.PredictionName = a.Results[0].Model, a.Results[0].DisplayName
		a.FamilyPrediction, a.FamilyPredictionName = models[first].Family, models[first].FamilyName
		a.RankingScore = ptr(ranking[first])
		if probabilities != nil {
			c := det.calibration
			a.Probability = a.Results[0].Probability
			a.ProbabilityStatus, a.ProbabilityScope = "reference_calibrated", ptr("reference-closed-set")
			a.Calibration = &Calibration{Method: c.Method, Run: c.CalibrationRun, Tau: c.Tau, SHA256: det.calibrationSHA256}
		}
		return nil
	}
	if !strict && used > 0 && used < 3 && len(outputs) <= 3 {
		if !a.Sequence.ModelLike {
			return notModel(), nil
		}
		a.Decision, a.Method = "partial", "shared-ranker-partial-v1"
		if ranked(accepted) != nil {
			return nil, errScoringFailed
		}
		plural := "s"
		if used == 1 {
			plural = ""
		}
		a.Evidence.Label = "Partial sample ranking"
		a.Evidence.Reason = "Ranked " + itoa(used) + " valid sample" + plural + ". Confidence requires three valid samples."
		a.Evidence.Method = "partial-sample-ranking"
		return a, nil
	}
	if len(outputs) != 3 || used != 3 {
		a.Decision, a.PredictionName = "unscorable", "Not scored"
		a.Evidence.Label = "Not enough valid samples"
		a.Evidence.Reason = "Received " + itoa(used) + "/3 valid samples. Three valid samples are required."
		a.Evidence.Method = "complete-three-answers"
		return a, nil
	}
	if !a.Sequence.ModelLike {
		return notModel(), nil
	}
	a.Decision = "scored"
	if ranked(parsed) != nil {
		return nil, errScoringFailed
	}
	if a.Calibration != nil {
		a.Evidence.Label = "Calibrated ranking"
		a.Evidence.Reason = "Confidence is a closed-set probability within the reference bank."
		a.Evidence.Method = "reference-calibrated-ranking"
	} else {
		a.Evidence.Label = "Uncalibrated ranking"
		a.Evidence.Reason = "The confidence calibration does not match this detector. Confidence is unavailable."
		a.Evidence.Method = "uncalibrated-ranking"
	}
	return a, nil
}
