package lmfpd

import (
	"math"
	"strconv"
	"strings"
	"unicode"
)

const (
	valueMin  = 1
	valueMax  = 355
	dimension = valueMax - valueMin + 1
	alpha     = 0.5
)

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// numberValue reads an ASCII digit run. ok is false when the value is outside 1..355.
func numberValue(digits string) (int, bool) {
	digits = strings.TrimLeft(digits, "0")
	if digits == "" || len(digits) > 3 {
		return 0, false
	}
	v, _ := strconv.Atoi(digits)
	return v, v <= valueMax
}

func hasLetter(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

// ParseNumbers returns the numbers 1 to 355 of the longest run in a reply; letters between numbers split runs.
func ParseNumbers(text string) []int {
	var best, current []int
	previousEnd := 0
	for i := 0; i < len(text); {
		if !isDigit(text[i]) {
			i++
			continue
		}
		start := i
		for i < len(text) && isDigit(text[i]) {
			i++
		}
		if len(current) > 0 && hasLetter(text[previousEnd:start]) {
			if len(current) > len(best) {
				best = current
			}
			current = nil
		}
		if v, ok := numberValue(text[start:i]); ok {
			current = append(current, v)
		}
		previousEnd = i
	}
	if len(current) > len(best) {
		best = current
	}
	if best == nil {
		return []int{}
	}
	return best
}

// rawOutOfRange counts `-?[0-9]+` matches below 1 or above 355.
func rawOutOfRange(text string) int {
	count := 0
	for i := 0; i < len(text); {
		negative := text[i] == '-' && i+1 < len(text) && isDigit(text[i+1])
		if !negative && !isDigit(text[i]) {
			i++
			continue
		}
		if negative {
			i++
		}
		start := i
		for i < len(text) && isDigit(text[i]) {
			i++
		}
		if _, ok := numberValue(text[start:i]); negative || !ok {
			count++
		}
	}
	return count
}

func joinNumbers(numbers []int) string {
	var b strings.Builder
	for i, n := range numbers {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString(strconv.Itoa(n))
	}
	return b.String()
}

func minimumNumbers(expected int) int {
	return max(80, int(math.Ceil(float64(expected)*0.55)))
}

func countNumbers(numbers []int) []float64 {
	counts := make([]float64, dimension)
	for _, n := range numbers {
		counts[n-valueMin]++
	}
	return counts
}

func hellingerFeature(counts []float64) []float64 {
	total := 0.0
	for _, v := range counts {
		total += v
	}
	total += alpha * dimension
	out := make([]float64, len(counts))
	for i, v := range counts {
		out[i] = math.Sqrt((v + alpha) / total)
	}
	return out
}

func splitIntoFour(values []int) [4][]int {
	base, remainder := len(values)/4, len(values)%4
	var chunks [4][]int
	start := 0
	for i := range 4 {
		size := base
		if i < remainder {
			size++
		}
		chunks[i] = values[start : start+size]
		start += size
	}
	return chunks
}

// appendSqrtShares appends sqrt(v / sum(bins)) for every bin.
func appendSqrtShares(out, bins []float64) []float64 {
	total := 0.0
	for _, v := range bins {
		total += v
	}
	for _, v := range bins {
		out = append(out, math.Sqrt(v/total))
	}
	return out
}

func orderedBlockFeature(numbers []int) []float64 {
	out := make([]float64, 0, 4*16+10)
	var bins [16]float64
	for _, chunk := range splitIntoFour(numbers) {
		for i := range bins {
			bins[i] = 0.5
		}
		for _, v := range chunk {
			bins[min(15, int(math.Floor(float64(v-1)/355*16)))]++
		}
		out = appendSqrtShares(out, bins[:])
	}
	var last [10]float64
	for i := range last {
		last[i] = 0.5
	}
	for _, v := range numbers {
		last[v%10]++
	}
	return appendSqrtShares(out, last[:])
}

// Positional head (shared/positional.ts). Block order is part of the detector format.

var positionalWeights = [4]float64{.6, .15, .125, .125}

var positionalScales = [4]float64{
	math.Sqrt(positionalWeights[0]), math.Sqrt(positionalWeights[1]),
	math.Sqrt(positionalWeights[2]), math.Sqrt(positionalWeights[3]),
}

var centres = func() [24]float64 {
	var c [24]float64
	for i := range c {
		c[i] = 1 + float64(i)*354/23
	}
	return c
}()

var lags = [...]int{1, 2, 3, 5, 8, 13, 21, 34}

func fraction(length int, test func(int) bool) float64 {
	hits := 0
	for i := range length {
		if test(i) {
			hits++
		}
	}
	return float64(hits) / float64(length)
}

func positionKernel(x []int) []float64 {
	n := float64(len(x))
	out := make([]float64, 34*3)
	var features [34]float64
	for position, value := range x {
		t := (float64(position)+.5)*2/n - 1
		basis := [3]float64{t, .5 * (float64(3*t*t) - 1), .5 * (float64(5*math.Pow(t, 3)) - float64(3*t))}
		v := float64(value)
		for k, centre := range centres {
			d := (v - centre) / 20
			features[k] = math.Exp(-.5 * (d * d))
		}
		for digit := range 10 {
			features[24+digit] = 0
			if digit == value%10 {
				features[24+digit] = 1
			}
		}
		for k, weight := range features {
			for j, b := range basis {
				out[k*3+j] += weight * b / n
			}
		}
	}
	return out
}

func centredTransitions(out []float64, symbols []int, bins int) []float64 {
	joint := make([]float64, bins*bins)
	for i := range joint {
		joint[i] = .5
	}
	total := float64(len(symbols)-1) + .5*float64(bins*bins)
	for i := 1; i < len(symbols); i++ {
		joint[symbols[i-1]*bins+symbols[i]]++
	}
	for i := range joint {
		joint[i] /= total
	}
	rows := make([]float64, bins)
	for a := range bins {
		s := 0.0
		for _, v := range joint[a*bins : a*bins+bins] {
			s += v
		}
		rows[a] = s
	}
	columns := make([]float64, bins)
	for b := range bins {
		s := 0.0
		for a := range bins {
			s += joint[a*bins+b]
		}
		columns[b] = s
	}
	for i, v := range joint {
		out = append(out, v-float64(rows[i/bins]*columns[i%bins]))
	}
	return out
}

func sign(v int) int {
	switch {
	case v > 0:
		return 1
	case v < 0:
		return -1
	}
	return 0
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func sequenceFeatures(x []int) []float64 {
	n := len(x)
	xf := make([]float64, n)
	for i, v := range x {
		xf[i] = float64(v)
	}
	m := mean(xf)
	variance := 0.0
	for _, v := range xf {
		variance += float64((v - m) * (v - m))
	}
	sd := math.Max(math.Sqrt(variance/float64(n)), 1)
	s := make([]float64, n)
	for i, v := range xf {
		s[i] = (v - m) / sd
	}
	out := make([]float64, 0, len(lags)*6+64+100+5+3)
	d := make([]int, n)
	for _, lag := range lags {
		count := n - lag
		d := d[:count]
		for i := range d {
			d[i] = x[i+lag] - x[i]
		}
		products, absolute := 0.0, 0.0
		for i := range count {
			products += float64(s[i+lag] * s[i])
		}
		for _, v := range d {
			absolute += float64(abs(v))
		}
		out = append(out, products/float64(count), absolute/float64(count)/355,
			fraction(count, func(i int) bool { return d[i] > 0 }),
			fraction(count, func(i int) bool { return d[i] == 0 }),
			fraction(count, func(i int) bool { return abs(d[i]) <= 5 }),
			fraction(count, func(i int) bool { return abs(d[i]) <= 20 }))
	}
	symbols := make([]int, n)
	for i, v := range x {
		symbols[i] = min(7, (v-1)*8/355)
	}
	out = centredTransitions(out, symbols, 8)
	for i, v := range x {
		symbols[i] = v % 10
	}
	out = centredTransitions(out, symbols, 10)
	difference := d[:n-1]
	zStep := make([]float64, n-1)
	for i := range n - 1 {
		difference[i] = x[i+1] - x[i]
		zStep[i] = math.Abs(s[i+1] - s[i])
	}
	out = append(out,
		fraction(n-2, func(i int) bool { return sign(difference[i+1]) == sign(difference[i]) }),
		fraction(n-2, func(i int) bool { return difference[i+1] == difference[i] }),
		fraction(n-1, func(i int) bool { return x[i]%10 == x[i+1]%10 }),
		fraction(n-1, func(i int) bool { return zStep[i] > 1 }),
		fraction(n-1, func(i int) bool { return zStep[i] > 2 }))
	for i, v := range x {
		symbols[i] = min(15, (v-1)*16/355)
	}
	for _, width := range [...]int{4, 8, 16} {
		sum := 0.0
		for i := 0; i+width <= n; i++ {
			var seen uint16
			for _, b := range symbols[i : i+width] {
				seen |= 1 << b
			}
			sum += float64(popcount(seen)) / float64(width)
		}
		out = append(out, sum/float64(n-width+1))
	}
	return out
}

func popcount(v uint16) int {
	c := 0
	for ; v != 0; v &= v - 1 {
		c++
	}
	return c
}

// positionalDecision returns the per-answer decision values over identities.
func positionalDecision(numbers []int, head *positionalHead) []float64 {
	parts := [4][]float64{
		hellingerFeature(countNumbers(numbers)), orderedBlockFeature(numbers),
		positionKernel(numbers), sequenceFeatures(numbers),
	}
	size := 0
	for _, block := range parts {
		size += len(block)
	}
	x := make([]float64, 0, size)
	for j, block := range parts {
		p := head.params[j]
		start := len(x)
		sumSquares := 0.0
		for i, v := range block {
			scaled := (v - p.mean[i]) / p.scale[i]
			sumSquares += float64(scaled * scaled)
			x = append(x, scaled)
		}
		length := math.Max(math.Sqrt(sumSquares), 1e-12)
		for i := start; i < len(x); i++ {
			x[i] = x[i] / length * positionalScales[j]
		}
	}
	out := make([]float64, len(head.weights))
	for k, row := range head.weights {
		s := head.bias[k]
		for i, w := range row {
			s += float64(w * x[i])
		}
		out[k] = s
	}
	return out
}
