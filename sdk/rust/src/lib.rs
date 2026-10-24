//! Language-model fingerprint detection.
//!
//! Load the reference data with [`Detector::load`] from the published URLs (cached) or a local directory, then score
//! saved replies with [`Detector::analyze`] or run one live round with [`Detector::detect`].

mod analysis;
mod challenge;
mod codec;
mod data;
mod error;
mod features;
mod ranker;
mod request;
mod sample;

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::{Deserialize, Serialize};

pub use challenge::generate_challenges;
pub use data::DEFAULT_DATA_URLS;
pub use error::Error;
pub use features::parse_numbers;
pub use request::{Request, build_request};
pub use sample::request_sample;

/// One model reply and the number count its challenge asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Output {
    pub text: String,
    pub expected_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Challenge {
    pub id: String,
    pub expected_count: u64,
    pub prompt: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Api {
    #[default]
    Responses,
    ChatCompletions,
    Messages,
}

/// Settings for live detection. [`DetectConfig::new`] fills the defaults.
#[derive(Debug, Clone, PartialEq)]
pub struct DetectConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    /// Default [`Api::Responses`].
    pub api: Api,
    /// Reasoning effort sent to the model. Empty sends none; `none` disables thinking on Messages.
    pub effort: String,
    /// `flex`, `default`, `fast`, or `ultrafast`. `default` sends no tier field.
    pub service_tier: String,
    /// Default true.
    pub stream: bool,
    /// Require three complete replies and no truncation. Needs `count` 3. Default false.
    pub strict: bool,
    /// Challenges per round, 1 to 3. Default 3.
    pub count: usize,
    /// Concurrent requests, 1 to 3, capped at `count`. Default 3.
    pub parallel: usize,
    /// Seconds to wait for the first SSE byte or the whole JSON response. Default 120.
    pub timeout: f64,
}

impl DetectConfig {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            api_key: api_key.into(),
            model: model.into(),
            api: Api::Responses,
            effort: String::new(),
            service_tier: "default".into(),
            stream: true,
            strict: false,
            count: 3,
            parallel: 3,
            timeout: 120.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Scored,
    Partial,
    Unscorable,
    NotModel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbabilityStatus {
    Unavailable,
    ReferenceCalibrated,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub model: String,
    pub display_name: String,
    pub family: String,
    pub family_name: String,
    pub score: f64,
    pub probability: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Calibration {
    pub method: String,
    pub run: String,
    pub tau: f64,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub index: usize,
    pub parsed_numbers: usize,
    pub minimum_numbers: u64,
    pub accepted: bool,
    pub raw_out_of_range_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sequence {
    pub autocorrelation: f64,
    pub small_step_share: f64,
    pub model_like: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelVersion {
    pub base_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Evidence {
    pub insufficient: bool,
    pub label: String,
    pub reason: String,
    /// Always `None`; kept for the shared analysis shape.
    pub threshold: Option<f64>,
    pub method: String,
}

/// The scoring result. Every field is always present, so the shape matches the TS, Go, and Python SDKs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Analysis {
    pub decision: Decision,
    pub prediction: String,
    pub prediction_name: String,
    pub family_prediction: String,
    pub family_prediction_name: String,
    /// Candidates by ranking score, best first. Empty unless the decision is `Scored` or `Partial`.
    pub results: Vec<AnalysisResult>,
    pub ranking_score: Option<f64>,
    /// Closed-set probability of the top candidate within the reference bank.
    pub probability: Option<f64>,
    pub probability_status: ProbabilityStatus,
    pub probability_scope: Option<String>,
    pub calibration: Option<Calibration>,
    pub used_outputs: usize,
    pub diagnostics: Vec<Diagnostic>,
    pub sequence: Option<Sequence>,
    pub method: String,
    pub model_version: ModelVersion,
    pub evidence: Evidence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SampleState {
    Complete,
    Truncated,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sample {
    pub state: SampleState,
    /// The numbers used for scoring; capped at `expected_count` when the reply had more.
    pub text: String,
    pub raw_text: String,
    pub count: u64,
    pub expected_count: u64,
    pub response_model: Option<String>,
    pub response_id: Option<String>,
    pub error: Option<String>,
}

impl Sample {
    fn accepted(&self) -> bool {
        matches!(self.state, SampleState::Complete | SampleState::Truncated)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DetectResult {
    pub challenges: Vec<Challenge>,
    pub samples: Vec<Sample>,
    pub analysis: Option<Analysis>,
    /// Why the round has no ranking, or `None` when it has one.
    pub error: Option<String>,
}

/// Where [`Detector::load`] gets the reference data.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadOptions {
    /// Base URLs, each ending in `/`, tried in order; or a single local directory holding `unified_bank.json` and
    /// `shared_detector.bin`, such as `projects/data`. Default [`DEFAULT_DATA_URLS`].
    pub sources: Vec<String>,
    /// The cache file for URL sources. Default `<OS cache directory>/lmfpd/data.bin`.
    pub cache: PathBuf,
    /// Seconds after a check before the cache is refreshed in the background; 0 checks on every load. Default 86400.
    pub ttl: f64,
}

impl Default for LoadOptions {
    fn default() -> Self {
        Self {
            sources: DEFAULT_DATA_URLS.iter().map(|url| url.to_string()).collect(),
            cache: data::default_cache_path(),
            ttl: 86_400.0,
        }
    }
}

/// A loaded reference bank and detector.
pub struct Detector {
    data: data::ReferenceData,
}

impl Detector {
    /// Loads the reference data. A single local directory is read as is, without the cache. For URLs, an existing
    /// cache is returned at once and, when last checked over a day ago, refreshed in a background thread for the next
    /// load; without a cache the data is downloaded first.
    pub fn load(options: &LoadOptions) -> Result<Self, Error> {
        Ok(Self { data: data::load(&options.sources, &options.cache, options.ttl)? })
    }

    /// `built_at` of the reference bank, which identifies the data build.
    pub fn built_at(&self) -> &str {
        &self.data.built_at
    }

    /// Scores one to three saved replies. Three valid replies give a calibrated ranking; fewer give a partial
    /// ranking unless `strict` is set.
    pub fn analyze(&self, outputs: &[Output], strict: bool) -> Result<Analysis, Error> {
        analysis::analyze_outputs(outputs, &self.data, strict)
    }

    /// Sends one round of challenges to the model API and scores the replies. Errors only on an invalid config.
    pub fn detect(&self, config: &DetectConfig) -> Result<DetectResult, Error> {
        let options = request::Options::new(config)?;
        let challenges = generate_challenges(options.count)?;
        let next = AtomicUsize::new(0);
        let mut slots: Vec<Option<Sample>> = vec![None; challenges.len()];
        std::thread::scope(|scope| {
            let workers: Vec<_> = (0..options.parallel)
                .map(|_| {
                    scope.spawn(|| {
                        let mut done = Vec::new();
                        loop {
                            let index = next.fetch_add(1, Ordering::Relaxed);
                            let Some(challenge) = challenges.get(index) else { break };
                            done.push((index, sample::sample(&options, challenge)));
                        }
                        done
                    })
                })
                .collect();
            for worker in workers {
                for (index, sample) in worker.join().expect("sampler thread panicked") {
                    slots[index] = Some(sample);
                }
            }
        });
        let samples: Vec<Sample> = slots.into_iter().map(|slot| slot.expect("every challenge is sampled")).collect();
        let (analysis, error) = self.score_round(&samples, options.strict);
        Ok(DetectResult { challenges, samples, analysis, error })
    }

    fn score_round(&self, samples: &[Sample], strict: bool) -> (Option<Analysis>, Option<String>) {
        let accepted = samples.iter().filter(|sample| sample.accepted()).count();
        if strict && accepted != 3 {
            return (None, Some(format!("Strict mode requires 3/3 successful samples; received {accepted}/3.")));
        }
        if accepted == 0 {
            return (None, Some("No valid samples. This round cannot be scored.".into()));
        }
        let outputs: Vec<(&str, u64)> = samples
            .iter()
            .map(|sample| (if sample.accepted() { sample.text.as_str() } else { "" }, sample.expected_count))
            .collect();
        match analysis::score(&outputs, &self.data, strict) {
            Ok(analysis) => {
                let error = analysis.results.is_empty().then(|| analysis.evidence.reason.clone());
                (Some(analysis), error)
            }
            Err(error) => (None, Some(error.to_string())),
        }
    }
}
