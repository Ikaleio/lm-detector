//! Reference data: offline directories, mirror downloads, and the cache.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Deserialize;
use serde_json::Value;

use crate::ranker::Ranker;
use crate::{Calibration, Error, codec};

/// Data sources, tried in order. The second is JSDMirror, a jsDelivr mirror in mainland China, serving the
/// `lmfpd-data` npm package with the same layout as the site's `/data/`.
pub const DEFAULT_DATA_URLS: &[&str] = &["https://lm.ikale.io/data/", "https://cdn.jsdmirror.com/npm/lmfpd-data@latest/"];
/// Bump when the bundle layout changes; older SDKs then refuse the data instead of misreading it.
const DATA_SCHEMA: &str = "lmfpd-data-v1";
const DETECTOR_SCHEMA: &str = "shared-detector-v2";
const BANK: &str = "unified_bank.json";
const BUNDLE: &str = "bundle.json";
const DETECTOR: &str = "shared_detector.bin";
const BUNDLE_TIMEOUT: Duration = Duration::from_secs(10);
const PART_TIMEOUT: Duration = Duration::from_secs(120);

pub(crate) struct Model {
    pub id: String,
    pub display_name: String,
    pub family: String,
    pub family_name: String,
}

/// The decoded bank and detector, ready for scoring.
pub(crate) struct ReferenceData {
    pub built_at: String,
    pub models: Vec<Model>,
    pub base_sha256: String,
    pub ranker: Ranker,
    /// The calibration output and its temperature, present only when its binding matches this detector.
    pub calibration: Option<(Calibration, f64)>,
}

#[derive(Deserialize)]
struct Bank {
    #[serde(default)]
    built_at: Option<String>,
    #[serde(default)]
    models: Vec<BankModel>,
}

#[derive(Deserialize)]
struct BankModel {
    id: String,
    display_name: String,
    family: String,
    family_name: String,
    response_count: f64,
}

fn string<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str()
}

fn strings(value: Option<&Value>) -> Option<Vec<&str>> {
    value?.as_array()?.iter().map(Value::as_str).collect()
}

/// The calibration head of `calibrateRanking`, checked once at load instead of on every call.
fn calibration(detector: &Value, model_ids: &[&str]) -> Option<(Calibration, f64)> {
    let head = detector.get("calibration")?;
    let binding = head.get("binding")?;
    let tau = head.get("tau")?.as_f64()?;
    let valid = string(head, "schema") == Some("shared-confidence-v2")
        && string(head, "method") == Some("ranking-temperature")
        && tau.is_finite()
        && (0.001..=1000.0).contains(&tau)
        && string(binding, "base_sha256").is_some_and(|s| Some(s) == string(detector, "base_sha256"))
        && string(binding, "reference_sha256").is_some_and(|s| Some(s) == string(detector, "source_reference_sha256"))
        && strings(binding.get("model_ids")).is_some_and(|ids| ids == model_ids);
    valid.then(|| {
        let output = Calibration {
            method: "ranking-temperature".into(),
            run: string(head, "calibration_run").unwrap_or_default().into(),
            tau,
            sha256: string(detector, "calibration_sha256").map(Into::into),
        };
        (output, tau)
    })
}

/// Decodes and cross-checks the bank and the detector. Scoring reads only `built_at` and the model names and counts,
/// which `bundle.json` repeats at its top level, so it can stand in for `unified_bank.json`. The names appear in read
/// errors.
fn decode_data(bank: &[u8], detector: &[u8], bank_name: &str, detector_name: &str) -> Result<ReferenceData, Error> {
    let bank: Bank = serde_json::from_slice(bank).map_err(|_| Error::new(format!("Cannot read {bank_name}.")))?;
    let cannot_read_detector = || Error::new(format!("Cannot read {detector_name}."));
    let decoded = codec::decode(detector).ok_or_else(cannot_read_detector)?;
    let header = &decoded.header;
    let model_ids = strings(header.get("model_ids")).unwrap_or_default();
    let response_counts = header.get("response_counts").and_then(|v| decoded.vec(v)).unwrap_or_default();
    let matches = string(header, "schema") == Some(DETECTOR_SCHEMA)
        && bank.built_at.is_some()
        && bank.built_at.as_deref() == string(header, "bank_built_at")
        && bank.models.len() == model_ids.len()
        && response_counts.len() == model_ids.len()
        && bank.models.iter().zip(&model_ids).zip(&response_counts).all(|((model, id), count)| {
            model.id == *id && model.response_count == *count
        });
    if !matches {
        return Err(Error::new("The reference bank does not match its detector."));
    }
    let ranker = decoded.ranker(model_ids.len()).ok_or_else(cannot_read_detector)?;
    let calibration = calibration(header, &model_ids);
    Ok(ReferenceData {
        built_at: bank.built_at.unwrap_or_default(),
        base_sha256: string(header, "base_sha256").ok_or_else(cannot_read_detector)?.into(),
        models: bank
            .models
            .into_iter()
            .map(|m| Model { id: m.id, display_name: m.display_name, family: m.family, family_name: m.family_name })
            .collect(),
        ranker,
        calibration,
    })
}

/// Reads `unified_bank.json` and `shared_detector.bin` from a directory such as `projects/data`.
fn read_dir(dir: &Path) -> Result<ReferenceData, Error> {
    let (bank_path, detector_path) = (dir.join(BANK), dir.join(DETECTOR));
    let read = |path: &Path| fs::read(path).map_err(|_| Error::new(format!("Cannot read {}.", path.display())));
    let bank = read(&bank_path)?;
    let detector = read(&detector_path)?;
    decode_data(&bank, &detector, &bank_path.display().to_string(), &detector_path.display().to_string())
}

struct Cached {
    data: ReferenceData,
    /// The detector's SHA-256 from the cached `bundle.json`.
    version: String,
    checked_at: SystemTime,
}

/// The cache file holds the u32 little-endian length of `bundle.json`, `bundle.json`, then `shared_detector.bin`.
/// A missing or damaged cache is `None` and is downloaded again.
fn read_cache(path: &Path) -> Option<Cached> {
    let bytes = fs::read(path).ok()?;
    let checked_at = fs::metadata(path).and_then(|info| info.modified()).ok()?;
    let length = u32::from_le_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
    let bundle = bytes.get(4..4usize.checked_add(length)?)?;
    let version = serde_json::from_slice::<Value>(bundle).ok()?.get("files")?.get(DETECTOR)?.get("sha256")?.as_str()?.into();
    let data = decode_data(bundle, &bytes[4 + length..], BUNDLE, DETECTOR).ok()?;
    Some(Cached { data, version, checked_at })
}

/// `<OS cache directory>/lmfpd/data.bin`, under the same root the lmfpd CLI uses.
pub(crate) fn default_cache_path() -> PathBuf {
    let home = || std::env::home_dir().unwrap_or_default();
    let root = match std::env::var_os("XDG_CACHE_HOME").filter(|v| !v.is_empty()) {
        Some(root) => PathBuf::from(root),
        None if cfg!(target_os = "macos") => home().join("Library/Caches"),
        None if cfg!(windows) => std::env::var_os("LOCALAPPDATA")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData/Local")),
        None => home().join(".cache"),
    };
    root.join("lmfpd").join("data.bin")
}

fn random_hex() -> String {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).expect("the OS random source is available");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn download(url: &str, timeout: Duration) -> Result<Vec<u8>, String> {
    let mut response = crate::request::agent()
        .get(url)
        .config()
        .timeout_global(Some(timeout))
        // Mirrors may redirect; model requests never follow redirects.
        .max_redirects(10)
        .build()
        .call()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    response.body_mut().with_config().limit(u64::MAX).read_to_vec().map_err(|e| e.to_string())
}

/// Best effort: a failed write only means the next load downloads again.
fn write_cache(path: &Path, bundle: &[u8], detector: &[u8]) {
    let mut staging = path.as_os_str().to_owned();
    staging.push(format!(".tmp-{}", random_hex()));
    let staging = PathBuf::from(staging);
    let mut packed = Vec::with_capacity(4 + bundle.len() + detector.len());
    packed.extend_from_slice(&(bundle.len() as u32).to_le_bytes());
    packed.extend_from_slice(bundle);
    packed.extend_from_slice(detector);
    let written = path.parent().map_or(Ok(()), fs::create_dir_all).and_then(|()| fs::write(&staging, &packed));
    if written.and_then(|()| fs::rename(&staging, path)).is_err() {
        let _ = fs::remove_file(&staging);
    }
}

/// Marks the cache as checked now.
fn touch(path: &Path) -> std::io::Result<()> {
    fs::File::options().write(true).open(path)?.set_modified(SystemTime::now())
}

fn decompress(compressed: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = ruzstd::decoding::StreamingDecoder::new(compressed).map_err(|e| e.to_string())?;
    let mut content = Vec::new();
    decoder.read_to_end(&mut content).map_err(|e| e.to_string())?;
    Ok(content)
}

fn schema_text(value: &Value) -> String {
    match value {
        Value::Null => "undefined".into(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// One source's attempt: `None` when it still serves `cached_version` (the cache is then marked as checked).
fn refresh_from(source: &str, cache: &Path, cached_version: Option<&str>) -> Result<Option<ReferenceData>, String> {
    let bundle_bytes = download(&format!("{source}{BUNDLE}"), BUNDLE_TIMEOUT)?;
    let bundle: Value = serde_json::from_slice(&bundle_bytes).map_err(|e| e.to_string())?;
    let (schema, detector_schema) = (&bundle["schema"], &bundle["detector_schema"]);
    if schema != DATA_SCHEMA || detector_schema != DETECTOR_SCHEMA {
        return Err(format!(
            "data schema {}/{} is not supported by this SDK version. Upgrade lmfpd.",
            schema_text(schema),
            schema_text(detector_schema),
        ));
    }
    // The detector's SHA-256 names its version.
    let file = &bundle["files"][DETECTOR];
    if cached_version.is_some() && file["sha256"].as_str() == cached_version {
        let _ = touch(cache);
        return Ok(None);
    }
    let parts = file["parts"].as_array().ok_or("bundle.json has no detector parts")?;
    let mut compressed = Vec::new();
    for part in parts {
        let part = part.as_str().ok_or("bundle.json has an invalid detector part")?;
        compressed.extend(download(&format!("{source}chunks/{part}"), PART_TIMEOUT)?);
    }
    let detector = decompress(&compressed)?;
    let data = decode_data(&bundle_bytes, &detector, BUNDLE, DETECTOR).map_err(|e| e.to_string())?;
    write_cache(cache, &bundle_bytes, &detector);
    Ok(Some(data))
}

/// Downloads the data from the first working source and caches it.
fn refresh(sources: &[String], cache: &Path, cached_version: Option<&str>) -> Result<Option<ReferenceData>, Error> {
    let mut failures = Vec::with_capacity(sources.len());
    for source in sources {
        match refresh_from(source, cache, cached_version) {
            Ok(data) => return Ok(data),
            Err(cause) => failures.push(format!("{source} ({cause})")),
        }
    }
    Err(Error::new(format!("lmfpd: cannot download reference data from {}", failures.join(", "))))
}

fn is_url(source: &str) -> bool {
    let lower = source.get(..8).unwrap_or(source).to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// A single source that is not an http(s) URL is a local directory, read as is. For URLs, answers from the cache file
/// when there is one (stale-while-revalidate): a cache last checked `ttl` seconds ago or earlier is refreshed in the
/// background for the next load. Without a cache it downloads.
pub(crate) fn load(sources: &[String], cache: &Path, ttl: f64) -> Result<ReferenceData, Error> {
    if let [source] = sources
        && !is_url(source)
    {
        return read_dir(Path::new(source));
    }
    let Some(cached) = read_cache(cache) else {
        let data = refresh(sources, cache, None)?;
        return Ok(data.expect("a refresh without a cached version returns data"));
    };
    // A modification time in the future counts as fresh.
    if SystemTime::now().duration_since(cached.checked_at).is_ok_and(|age| age.as_secs_f64() >= ttl) {
        let (sources, cache, version) = (sources.to_vec(), cache.to_path_buf(), cached.version);
        std::thread::spawn(move || {
            let _ = refresh(&sources, &cache, Some(&version));
        });
    }
    Ok(cached.data)
}
