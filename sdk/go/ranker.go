package lmfpd

import (
	"errors"
	"math"
	"slices"
)

// Port of shared/shared-detector.ts. Every reduction is a left-to-right loop, and products are converted with
// float64(...) before they are added so the compiler cannot fuse them into FMA instructions; this keeps results
// within 1e-9 of the JavaScript reference.

var errNonFinite = errors.New("non-finite ranking")

func dot(a, b []float64) float64 {
	s := 0.0
	for i, x := range a {
		s += float64(x * b[i])
	}
	return s
}

func mean(a []float64) float64 {
	s := 0.0
	for _, x := range a {
		s += x
	}
	return s / float64(len(a))
}

func normalize(a []float64) []float64 {
	n := math.Max(math.Sqrt(dot(a, a)), 1e-12)
	out := make([]float64, len(a))
	for i, x := range a {
		out[i] = x / n
	}
	return out
}

func zscore(a []float64) []float64 {
	m := mean(a)
	variance := 0.0
	for _, x := range a {
		variance += float64((x - m) * (x - m))
	}
	s := math.Max(math.Sqrt(variance/float64(len(a))), 1e-12)
	out := make([]float64, len(a))
	for i, x := range a {
		out[i] = (x - m) / s
	}
	return out
}

func columnMean(a [][]float64) []float64 {
	out := make([]float64, len(a[0]))
	for i := range out {
		s := 0.0
		for _, row := range a {
			s += row[i]
		}
		out[i] = s / float64(len(a))
	}
	return out
}

func median(a []float64) float64 {
	v := slices.Clone(a)
	slices.Sort(v)
	i := len(v) / 2
	if len(v)%2 == 1 {
		return v[i]
	}
	return (v[i-1] + v[i]) / 2
}

func blocks(numbers []int) [2][]float64 {
	return [2][]float64{hellingerFeature(countNumbers(numbers)), orderedBlockFeature(numbers)}
}

var blockScales = [2]float64{math.Sqrt(.75), math.Sqrt(.25)}

func transform(b [2][]float64, p []meanScale) []float64 {
	out := make([]float64, 0, len(b[0])+len(b[1]))
	for j, v := range b {
		scaled := make([]float64, len(v))
		for i, x := range v {
			scaled[i] = (x - p[j].mean[i]) / p[j].scale[i]
		}
		for _, x := range normalize(scaled) {
			out = append(out, x*blockScales[j])
		}
	}
	return out
}

func centered(v []float64, p *featureBank) []float64 {
	out := make([]float64, len(v))
	for i, x := range v {
		out[i] = (x - p.featureMean[i]) / p.featureScale[i]
	}
	return out
}

// subtract projects out every basis row, with all coefficients taken from the original v.
func subtract(v []float64, basis [][]float64) []float64 {
	coefficients := make([]float64, len(basis))
	for j, row := range basis {
		coefficients[j] = dot(v, row)
	}
	out := make([]float64, len(v))
	for i, x := range v {
		s := 0.0
		for j, row := range basis {
			s += float64(coefficients[j] * row[i])
		}
		out[i] = x - s
	}
	return out
}

// nearest is the mean squared distance from x to its seven closest references. scratch must hold len(references).
func nearest(x []float64, references [][]float64, norms, scratch []float64) float64 {
	xx := dot(x, x)
	for i, r := range references {
		scratch[i] = math.Max(0, xx+norms[i]-2*dot(x, r))
	}
	slices.Sort(scratch)
	k := min(7, len(scratch))
	s := 0.0
	for _, d := range scratch[:k] {
		s += d
	}
	return s / float64(k)
}

func (d *detector) baseline(b [2][]float64) []float64 {
	h, o := &d.hellinger, &d.orderedBlocks
	hUnit := normalize(subtract(centered(b[0], h), h.nuisanceBasis))
	oCentered := centered(b[1], o)
	raw, projected := normalize(oCentered), normalize(subtract(oCentered, o.nuisanceBasis))
	n := len(o.centroids)
	marginal, templates, nuisance := make([]float64, len(h.centroids)), make([]float64, n), make([]float64, n)
	for i, row := range h.centroids {
		marginal[i] = dot(hUnit, row)
	}
	for i, row := range o.centroids {
		best := math.Inf(-1)
		for _, rows := range o.environmentCentroids {
			best = math.Max(best, dot(raw, rows[i]))
		}
		templates[i] = best
		nuisance[i] = dot(projected, row)
	}
	tz, nz := zscore(templates), zscore(nuisance)
	mixed := make([]float64, n)
	for i := range mixed {
		mixed[i] = .5*tz[i] + .5*nz[i]
	}
	ordered, mz := zscore(mixed), zscore(marginal)
	out := make([]float64, len(mz))
	for i, v := range mz {
		out[i] = .5*v + .5*ordered[i]
	}
	return out
}

func (d *detector) rankNumbers(numbers [][]int) ([]float64, error) {
	full := make([][2][]float64, len(numbers))
	ax := make([][]float64, len(numbers))
	lda := make([][]float64, len(numbers))
	baselines := make([][]float64, len(numbers))
	positional := make([][]float64, len(numbers))
	for k, n := range numbers {
		full[k] = blocks(n)
		ax[k] = transform(full[k], d.fullParams)
		x := transform(blocks(n[:min(128, len(n))]), d.headParams)
		scores := make([]float64, len(d.ldaWeights))
		for i, row := range d.ldaWeights {
			scores[i] = dot(row, x) + d.ldaBias[i]
		}
		lda[k] = zscore(scores)
		baselines[k] = d.baseline(full[k])
		positional[k] = zscore(positionalDecision(n, &d.positional))
	}
	l := zscore(columnMean(lda))
	near := make([]float64, len(d.references))
	distances := make([]float64, len(ax))
	var scratch []float64
	for m, ref := range d.references {
		scratch = slices.Grow(scratch[:0], len(ref))[:len(ref)]
		for k, x := range ax {
			distances[k] = -nearest(x, ref, d.referenceNorms[m], scratch)
		}
		near[m] = median(distances)
	}
	near = zscore(near)
	base := zscore(columnMean(baselines))
	frequency := make([]float64, len(l))
	for i, x := range l {
		frequency[i] = .5*x + .25*near[i] + .25*base[i]
	}
	frequency = zscore(frequency)
	pos := zscore(columnMean(positional))
	ranking := make([]float64, len(frequency))
	for i, x := range frequency {
		ranking[i] = float64(d.blendFrequency*x) + float64(d.blendPositional*pos[i])
		if math.IsNaN(ranking[i]) || math.IsInf(ranking[i], 0) {
			return nil, errNonFinite
		}
	}
	return ranking, nil
}

// calibrate returns closed-set probabilities from the calibration bound to this ranker, or nil when none matches.
func (d *detector) calibrate(ranking []float64) []float64 {
	head := d.calibration
	if head == nil || head.Binding == nil {
		return nil
	}
	b := head.Binding
	if head.Schema != "shared-confidence-v2" || head.Method != "ranking-temperature" ||
		math.IsNaN(head.Tau) || head.Tau < .001 || head.Tau > 1000 ||
		b.BaseSHA256 != d.baseSHA256 || b.ReferenceSHA256 != d.sourceReferenceSHA256 ||
		len(b.ModelIDs) != len(ranking) || len(ranking) != len(d.modelIDs) || !slices.Equal(b.ModelIDs, d.modelIDs) {
		return nil
	}
	logits := make([]float64, len(ranking))
	maximum := math.Inf(-1)
	for i, score := range ranking {
		logits[i] = head.Tau * score
		maximum = math.Max(maximum, logits[i])
	}
	sum := 0.0
	for i, v := range logits {
		logits[i] = math.Exp(v - maximum)
		sum += logits[i]
	}
	for i := range logits {
		logits[i] /= sum
	}
	return logits
}

// sequenceLimits are the 99.5% quantiles over reference three-answer groups. A reply is rejected only when both
// signals exceed their limits.
var sequenceLimits = struct{ autocorrelation, smallStepShare float64 }{-.23, .05}

func sequenceShape(numbers [][]int) *Sequence {
	autocorrelations := make([]float64, len(numbers))
	smallSteps := make([]float64, len(numbers))
	for k, n := range numbers {
		values := make([]float64, len(n))
		for i, v := range n {
			values[i] = float64(v)
		}
		m := mean(values)
		variance := 0.0
		for _, x := range values {
			variance += float64((x - m) * (x - m))
		}
		variance /= float64(len(values))
		steps := len(n) - 1
		covariance, small := 0.0, 0.0
		for i := range steps {
			covariance += float64((values[i+1] - m) * (values[i] - m))
			if abs(n[i+1]-n[i]) <= 20 {
				small++
			}
		}
		autocorrelations[k] = 1
		if variance != 0 {
			autocorrelations[k] = covariance / float64(steps) / variance
		}
		smallSteps[k] = small / float64(steps)
	}
	a, s := median(autocorrelations), median(smallSteps)
	return &Sequence{Autocorrelation: a, SmallStepShare: s,
		ModelLike: a <= sequenceLimits.autocorrelation || s <= sequenceLimits.smallStepShare}
}
