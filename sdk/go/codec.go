package lmfpd

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
)

type meanScale struct{ mean, scale []float64 }

type featureBank struct {
	featureMean, featureScale []float64
	nuisanceBasis, centroids  [][]float64
	environmentCentroids      [][][]float64
}

type positionalHead struct {
	params  []meanScale
	weights [][]float64
	bias    []float64
}

type calibrationHead struct {
	Schema  string  `json:"schema"`
	Method  string  `json:"method"`
	Tau     float64 `json:"tau"`
	Binding *struct {
		BaseSHA256      string   `json:"base_sha256"`
		ReferenceSHA256 string   `json:"reference_sha256"`
		ModelIDs        []string `json:"model_ids"`
	} `json:"binding"`
	CalibrationRun string `json:"calibration_run"`
}

// detector is the decoded `shared_detector.bin` (shared/shared-detector.ts SharedDetector).
type detector struct {
	schema                string
	baseSHA256            string
	sourceReferenceSHA256 string
	bankBuiltAt           string
	modelIDs              []string
	responseCounts        []float64
	calibrationSHA256     *string
	calibration           *calibrationHead

	headParams, fullParams []meanScale
	ldaWeights             [][]float64
	ldaBias                []float64
	references             [][][]float64
	// referenceNorms[m][r] is dot(references[m][r], references[m][r]).
	referenceNorms  [][]float64
	hellinger       featureBank
	orderedBlocks   featureBank
	blendFrequency  float64
	blendPositional float64
	positional      positionalHead
}

// f32Ref is an `{"$f32": offset, "n": length}` reference into the float section. The encoder leaves empty arrays as
// plain `[]`, so those decode to an empty vector.
type f32Ref struct {
	offset, n int
	empty     bool
}

func (r *f32Ref) UnmarshalJSON(data []byte) error {
	var plain []float64
	if json.Unmarshal(data, &plain) == nil {
		if len(plain) > 0 {
			return errors.New("unencoded float array")
		}
		r.empty = true
		return nil
	}
	var ref struct {
		Offset *int `json:"$f32"`
		N      int  `json:"n"`
	}
	if err := json.Unmarshal(data, &ref); err != nil {
		return err
	}
	if ref.Offset == nil || *ref.Offset < 0 || ref.N < 0 {
		return errors.New("invalid float reference")
	}
	r.offset, r.n = *ref.Offset, ref.N
	return nil
}

type rawMeanScale struct {
	Mean  f32Ref `json:"mean"`
	Scale f32Ref `json:"scale"`
}

type rawFeatureBank struct {
	FeatureMean          f32Ref     `json:"feature_mean"`
	FeatureScale         f32Ref     `json:"feature_scale"`
	NuisanceBasis        []f32Ref   `json:"nuisance_basis"`
	Centroids            []f32Ref   `json:"centroids"`
	EnvironmentCentroids [][]f32Ref `json:"environment_centroids"`
}

type rawHeader struct {
	Schema                string           `json:"schema"`
	BaseSHA256            string           `json:"base_sha256"`
	SourceReferenceSHA256 string           `json:"source_reference_sha256"`
	BankBuiltAt           string           `json:"bank_built_at"`
	ModelIDs              []string         `json:"model_ids"`
	ResponseCounts        f32Ref           `json:"response_counts"`
	CalibrationSHA256     *string          `json:"calibration_sha256"`
	Calibration           *calibrationHead `json:"calibration"`
	Ranker                struct {
		HeadParams []rawMeanScale `json:"head_params"`
		FullParams []rawMeanScale `json:"full_params"`
		LDAWeights []f32Ref       `json:"lda_weights"`
		LDABias    f32Ref         `json:"lda_bias"`
		References [][]f32Ref     `json:"references"`
		Bank       struct {
			Hellinger     rawFeatureBank `json:"hellinger"`
			OrderedBlocks rawFeatureBank `json:"ordered_blocks"`
		} `json:"bank"`
		Blend struct {
			Frequency  float64 `json:"frequency"`
			Positional float64 `json:"positional"`
		} `json:"blend"`
		Positional struct {
			Params  []rawMeanScale `json:"params"`
			Weights []f32Ref       `json:"weights"`
			Bias    f32Ref         `json:"bias"`
		} `json:"positional"`
	} `json:"ranker"`
}

// floatTable resolves float references; the first out-of-range reference is kept in err.
type floatTable struct {
	floats []float64
	err    error
}

func (t *floatTable) vec(r f32Ref) []float64 {
	if r.empty {
		return []float64{}
	}
	if r.offset+r.n > len(t.floats) {
		t.err = errors.New("float reference out of range")
		return nil
	}
	return t.floats[r.offset : r.offset+r.n : r.offset+r.n]
}

func (t *floatTable) mat(refs []f32Ref) [][]float64 {
	out := make([][]float64, len(refs))
	for i, r := range refs {
		out[i] = t.vec(r)
	}
	return out
}

func (t *floatTable) mats(refs [][]f32Ref) [][][]float64 {
	out := make([][][]float64, len(refs))
	for i, r := range refs {
		out[i] = t.mat(r)
	}
	return out
}

func (t *floatTable) params(raw []rawMeanScale) []meanScale {
	out := make([]meanScale, len(raw))
	for i, p := range raw {
		out[i] = meanScale{t.vec(p.Mean), t.vec(p.Scale)}
	}
	return out
}

func (t *floatTable) bank(raw *rawFeatureBank) featureBank {
	return featureBank{
		featureMean: t.vec(raw.FeatureMean), featureScale: t.vec(raw.FeatureScale),
		nuisanceBasis: t.mat(raw.NuisanceBasis), centroids: t.mat(raw.Centroids),
		environmentCentroids: t.mats(raw.EnvironmentCentroids),
	}
}

// decodeDetector reads the layout written by shared/detector-codec.ts: a u32 LE header length, the JSON header, zero
// padding to 4 bytes, then little-endian float32 values stored byte plane by byte plane.
func decodeDetector(data []byte) (*detector, error) {
	if len(data) < 4 {
		return nil, errors.New("truncated detector")
	}
	headerLength := int(binary.LittleEndian.Uint32(data))
	start := (4 + headerLength + 3) / 4 * 4
	if start > len(data) || (len(data)-start)%4 != 0 {
		return nil, errors.New("truncated detector")
	}
	count := (len(data) - start) / 4
	planes := data[start:]
	floats := make([]float64, count)
	for i := range floats {
		bits := uint32(planes[i]) | uint32(planes[count+i])<<8 | uint32(planes[2*count+i])<<16 | uint32(planes[3*count+i])<<24
		floats[i] = float64(math.Float32frombits(bits))
	}
	var raw rawHeader
	if err := json.Unmarshal(data[4:4+headerLength], &raw); err != nil {
		return nil, err
	}
	t := &floatTable{floats: floats}
	r := &raw.Ranker
	d := &detector{
		schema: raw.Schema, baseSHA256: raw.BaseSHA256, sourceReferenceSHA256: raw.SourceReferenceSHA256,
		bankBuiltAt: raw.BankBuiltAt, modelIDs: raw.ModelIDs, responseCounts: t.vec(raw.ResponseCounts),
		calibrationSHA256: raw.CalibrationSHA256, calibration: raw.Calibration,
		headParams: t.params(r.HeadParams), fullParams: t.params(r.FullParams),
		ldaWeights: t.mat(r.LDAWeights), ldaBias: t.vec(r.LDABias), references: t.mats(r.References),
		hellinger: t.bank(&r.Bank.Hellinger), orderedBlocks: t.bank(&r.Bank.OrderedBlocks),
		blendFrequency: r.Blend.Frequency, blendPositional: r.Blend.Positional,
		positional: positionalHead{
			params: t.params(r.Positional.Params), weights: t.mat(r.Positional.Weights), bias: t.vec(r.Positional.Bias),
		},
	}
	if t.err != nil {
		return nil, t.err
	}
	d.referenceNorms = make([][]float64, len(d.references))
	for m, rows := range d.references {
		norms := make([]float64, len(rows))
		for i, row := range rows {
			norms[i] = dot(row, row)
		}
		d.referenceNorms[m] = norms
	}
	return d, nil
}
