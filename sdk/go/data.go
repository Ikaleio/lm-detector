package lmfpd

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/klauspost/compress/zstd"
)

// DefaultDataURLs are the sources Load tries in order. The second is JSDMirror, a jsDelivr mirror in mainland China
// serving the lmfpd-data npm package, which has the same layout as the site's /data/.
var DefaultDataURLs = []string{
	"https://lm.ikale.io/data/",
	"https://cdn.jsdmirror.com/npm/lmfpd-data@latest/",
}

const (
	// dataSchema is bumped when the bundle layout changes; older SDKs then refuse the data instead of misreading it.
	dataSchema     = "lmfpd-data-v1"
	detectorSchema = "shared-detector-v2"
	detectorFile   = "shared_detector.bin"
)

type bankModel struct {
	ID            string  `json:"id"`
	DisplayName   string  `json:"display_name"`
	Family        string  `json:"family"`
	FamilyName    string  `json:"family_name"`
	ResponseCount float64 `json:"response_count"`
}

// bank holds the fields scoring reads. bundle.json repeats them at its top level, so it parses as a bank too.
type bank struct {
	BuiltAt string      `json:"built_at"`
	Models  []bankModel `json:"models"`
}

type bundle struct {
	bank
	Schema         any `json:"schema"`
	DetectorSchema any `json:"detector_schema"`
	Files          map[string]struct {
		Parts  []string `json:"parts"`
		SHA256 string   `json:"sha256"`
	} `json:"files"`
}

func newDetector(b *bank, det *detector) (*Detector, error) {
	matches := b.Models != nil && det.schema == detectorSchema && b.BuiltAt == det.bankBuiltAt &&
		len(b.Models) == len(det.modelIDs) && len(det.responseCounts) == len(det.modelIDs)
	for i := 0; matches && i < len(b.Models); i++ {
		matches = b.Models[i].ID == det.modelIDs[i] && b.Models[i].ResponseCount == det.responseCounts[i]
	}
	if !matches {
		return nil, errors.New("The reference bank does not match its detector.")
	}
	return &Detector{bank: b, detector: det}, nil
}

// readDir reads unified_bank.json and shared_detector.bin from a directory such as projects/data.
func readDir(dir string) (*Detector, error) {
	bankPath, detectorPath := filepath.Join(dir, "unified_bank.json"), filepath.Join(dir, detectorFile)
	b := &bank{}
	data, err := os.ReadFile(bankPath)
	if err == nil {
		err = json.Unmarshal(data, b)
	}
	if err != nil {
		return nil, fmt.Errorf("Cannot read %s.", bankPath)
	}
	data, err = os.ReadFile(detectorPath)
	var det *detector
	if err == nil {
		det, err = decodeDetector(data)
	}
	if err != nil {
		return nil, fmt.Errorf("Cannot read %s.", detectorPath)
	}
	return newDetector(b, det)
}

type cacheEntry struct {
	detector  *Detector
	version   string
	checkedAt time.Time
}

// readCache reads the cache file: the u32 little-endian length of bundle.json, bundle.json, then shared_detector.bin.
// A missing or damaged cache returns nil and is downloaded again.
func readCache(path string) *cacheEntry {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) < 4 {
		return nil
	}
	length := uint64(binary.LittleEndian.Uint32(data))
	if 4+length > uint64(len(data)) {
		return nil
	}
	var b bundle
	if json.Unmarshal(data[4:4+length], &b) != nil {
		return nil
	}
	file, ok := b.Files[detectorFile]
	if !ok {
		return nil
	}
	det, err := decodeDetector(data[4+length:])
	if err != nil {
		return nil
	}
	d, err := newDetector(&b.bank, det)
	if err != nil {
		return nil
	}
	return &cacheEntry{detector: d, version: file.SHA256, checkedAt: info.ModTime()}
}

// writeCache is best effort: a failed write only means the next load downloads again.
func writeCache(path string, bundleBytes, detectorBytes []byte) {
	random := make([]byte, 8)
	_, _ = rand.Read(random)
	staging := path + ".tmp-" + hex.EncodeToString(random)
	content := make([]byte, 4, 4+len(bundleBytes)+len(detectorBytes))
	binary.LittleEndian.PutUint32(content, uint32(len(bundleBytes)))
	content = append(append(content, bundleBytes...), detectorBytes...)
	if os.MkdirAll(filepath.Dir(path), 0o755) != nil {
		return
	}
	if os.WriteFile(staging, content, 0o644) != nil || os.Rename(staging, path) != nil {
		_ = os.Remove(staging)
	}
}

// defaultCachePath follows shared/cache-dir.ts cacheRoot, plus /data.bin.
func defaultCachePath() string {
	home, _ := os.UserHomeDir()
	root := os.Getenv("XDG_CACHE_HOME")
	if root == "" {
		switch runtime.GOOS {
		case "darwin":
			root = filepath.Join(home, "Library", "Caches")
		case "windows":
			if root = os.Getenv("LOCALAPPDATA"); root == "" {
				root = filepath.Join(home, "AppData", "Local")
			}
		default:
			root = filepath.Join(home, ".cache")
		}
	}
	return filepath.Join(root, "lmfpd", "data.bin")
}

// dataClient follows redirects (mirrors may redirect) and uses the proxy environment variables.
var dataClient = &http.Client{}

func download(ctx context.Context, url string, timeout time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := dataClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// jsString formats a decoded JSON value the way JavaScript template interpolation does in the schema message.
func jsString(v any) string {
	if v == nil {
		return "undefined"
	}
	return fmt.Sprint(v)
}

// refreshFrom downloads the data from one source and caches it. It returns nil data when the source still serves
// cachedVersion, after marking the cache as checked.
func refreshFrom(ctx context.Context, source, cachePath, cachedVersion string) (*Detector, error) {
	bundleBytes, err := download(ctx, source+"bundle.json", 10*time.Second)
	if err != nil {
		return nil, err
	}
	var b bundle
	if err := json.Unmarshal(bundleBytes, &b); err != nil {
		return nil, err
	}
	if b.Schema != dataSchema || b.DetectorSchema != detectorSchema {
		return nil, fmt.Errorf("data schema %s/%s is not supported by this SDK version. Upgrade lmfpd.",
			jsString(b.Schema), jsString(b.DetectorSchema))
	}
	// The detector's SHA-256 names its version.
	file, ok := b.Files[detectorFile]
	if !ok {
		return nil, errors.New("bundle.json does not list " + detectorFile + ".")
	}
	if cachedVersion != "" && file.SHA256 == cachedVersion {
		now := time.Now()
		_ = os.Chtimes(cachePath, now, now)
		return nil, nil
	}
	var compressed []byte
	for _, part := range file.Parts {
		chunk, err := download(ctx, source+"chunks/"+part, 120*time.Second)
		if err != nil {
			return nil, err
		}
		compressed = append(compressed, chunk...)
	}
	decoder, err := zstd.NewReader(nil, zstd.WithDecoderConcurrency(1))
	if err != nil {
		return nil, err
	}
	detectorBytes, err := decoder.DecodeAll(compressed, nil)
	decoder.Close()
	if err != nil {
		return nil, err
	}
	det, err := decodeDetector(detectorBytes)
	if err != nil {
		return nil, err
	}
	d, err := newDetector(&b.bank, det)
	if err != nil {
		return nil, err
	}
	writeCache(cachePath, bundleBytes, detectorBytes)
	return d, nil
}

// refresh tries every source in order and fails only when all of them fail.
func refresh(ctx context.Context, sources []string, cachePath, cachedVersion string) (*Detector, error) {
	failures := make([]string, 0, len(sources))
	for _, source := range sources {
		d, err := refreshFrom(ctx, source, cachePath, cachedVersion)
		if err == nil {
			return d, nil
		}
		failures = append(failures, source+" ("+err.Error()+")")
	}
	return nil, errors.New("lmfpd: cannot download reference data from " + strings.Join(failures, ", "))
}

func isURL(source string) bool {
	lower := strings.ToLower(source)
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

// Load returns a Detector for the reference data.
//
// A single source that is not an http(s) URL is a local directory, such as projects/data, read as is without the
// cache. For URLs, Load answers from the cache file when there is one (stale-while-revalidate): a cache last checked
// options.TTL ago or earlier is refreshed in the background for the next load. Without a cache it downloads. HTTP requests honor
// HTTPS_PROXY, HTTP_PROXY, and NO_PROXY.
func Load(ctx context.Context, options LoadOptions) (*Detector, error) {
	sources := options.Sources
	if len(sources) == 0 {
		sources = DefaultDataURLs
	}
	if len(sources) == 1 && !isURL(sources[0]) {
		return readDir(sources[0])
	}
	cachePath := options.Cache
	if cachePath == "" {
		cachePath = defaultCachePath()
	}
	ttl := options.TTL
	if ttl == 0 {
		ttl = 24 * time.Hour
	}
	cached := readCache(cachePath)
	if cached == nil {
		// Without a cached version a successful refresh always returns data.
		return refresh(ctx, sources, cachePath, "")
	}
	if time.Since(cached.checkedAt) >= ttl {
		go func() { _, _ = refresh(context.Background(), sources, cachePath, cached.version) }()
	}
	return cached.detector, nil
}
