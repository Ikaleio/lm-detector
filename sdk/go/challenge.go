package lmfpd

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"strconv"
	"strings"
)

//go:embed templates.json
var templatesJSON []byte

type language struct {
	ID         string   `json:"id"`
	Space      string   `json:"space"`
	Openings   []string `json:"openings"`
	Actions    []string `json:"actions"`
	Request    string   `json:"request"`
	Rules      string   `json:"rules"`
	Endings    []string `json:"endings"`
	Separators []string `json:"separators"`
	Start      string   `json:"start"`
}

var languages = func() []language {
	var t struct {
		Languages []language `json:"languages"`
	}
	if err := json.Unmarshal(templatesJSON, &t); err != nil {
		panic("lmfpd: invalid embedded templates.json: " + err.Error())
	}
	return t.Languages
}()

// randomIndex draws uniformly from 0..n-1 with a CSPRNG.
func randomIndex(n int) int {
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		panic("lmfpd: crypto/rand failed: " + err.Error())
	}
	return int(v.Int64())
}

func choose[T any](values []T) T { return values[randomIndex(len(values))] }

func uuidV4() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("lmfpd: crypto/rand failed: " + err.Error())
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// generateChallenges ports shared/challenge-browser.js generateChallenges; count must be 1 to 3.
func generateChallenges(count int) []Challenge {
	available := make([]int, 41)
	for i := range available {
		available[i] = 292 + i
	}
	challenges := make([]Challenge, count)
	for index := range challenges {
		k := randomIndex(len(available))
		length := available[k]
		available = append(available[:k], available[k+1:]...)
		l := choose(languages)
		request := strings.Replace(l.Request, "{action}", choose(l.Actions), 1)
		request = strings.Replace(request, "{count}", strconv.Itoa(length), 1)
		challenges[index] = Challenge{
			ID:            "probe-" + strconv.Itoa(index+1) + "-" + uuidV4(),
			ExpectedCount: length,
			Prompt: strings.Join([]string{
				choose(l.Openings), request, l.Rules, choose(l.Endings), choose(l.Separators), l.Start,
			}, l.Space),
		}
	}
	return challenges
}
