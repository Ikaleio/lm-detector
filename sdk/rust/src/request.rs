//! Config validation, endpoint resolution, and the request body (`buildDetectRequest`).

use std::collections::BTreeMap;
use std::sync::LazyLock;

use serde::Serialize;
use serde_json::{Map, Value, json};
use ureq::Agent;

use crate::{Api, DetectConfig, Error};

const SERVICE_TIERS: [&str; 4] = ["flex", "default", "fast", "ultrafast"];
/// The Anthropic API reads `speed` only with this beta header.
const SPEED_BETA: &str = "fast-mode-2026-02-01";

/// An HTTP agent that follows no redirects and returns HTTP errors as responses.
/// The proxy comes from `ALL_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY`, honoring `NO_PROXY` (ureq's default).
pub(crate) fn new_agent() -> Agent {
    Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .proxy(ureq::Proxy::try_from_env())
        .build()
        .into()
}

static AGENT: LazyLock<Agent> = LazyLock::new(new_agent);

/// The agent shared by data downloads, which turn redirects back on per request.
pub(crate) fn agent() -> &'static Agent {
    &AGENT
}

/// The HTTP request `detect` sends for one prompt.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Request {
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Value,
}

/// A validated [`DetectConfig`].
pub(crate) struct Options {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub api: Api,
    pub effort: String,
    pub service_tier: String,
    pub stream: bool,
    pub strict: bool,
    pub count: usize,
    pub parallel: usize,
    pub timeout_ms: u64,
}

impl Options {
    pub fn new(config: &DetectConfig) -> Result<Self, Error> {
        let (base_url, api_key, model) = (config.base_url.trim(), config.api_key.trim(), config.model.trim());
        if base_url.is_empty() || api_key.is_empty() || model.is_empty() {
            return Err(Error::new("base_url, api_key, and model are required."));
        }
        if !SERVICE_TIERS.contains(&config.service_tier.as_str()) {
            return Err(Error::new("service_tier must be flex, default, fast, or ultrafast."));
        }
        if !(1..=3).contains(&config.count) {
            return Err(Error::new("count must be an integer from 1 to 3."));
        }
        if !(1..=3).contains(&config.parallel) {
            return Err(Error::new("parallel must be an integer from 1 to 3."));
        }
        if !config.timeout.is_finite() || (config.timeout != 0.0 && !(0.001..=2_147_483.647).contains(&config.timeout)) {
            return Err(Error::new("timeout must be 0 (no timeout) or between 0.001 and 2147483.647 seconds."));
        }
        if config.strict && config.count != 3 {
            return Err(Error::new("strict requires count 3."));
        }
        let options = Self {
            base_url: base_url.into(),
            api_key: api_key.into(),
            model: model.into(),
            api: config.api,
            effort: config.effort.clone(),
            service_tier: config.service_tier.clone(),
            stream: config.stream,
            strict: config.strict,
            count: config.count,
            parallel: config.parallel.min(config.count),
            timeout_ms: (config.timeout * 1000.0).round() as u64,
        };
        options.endpoint()?;
        Ok(options)
    }

    pub fn endpoint(&self) -> Result<String, Error> {
        let mut url = url::Url::parse(&self.base_url)
            .map_err(|_| Error::new("Base URL must be a valid HTTP or HTTPS URL."))?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some_and(|q| !q.is_empty())
            || url.fragment().is_some_and(|f| !f.is_empty())
        {
            return Err(Error::new("Base URL must use HTTP or HTTPS without credentials, a query, or a fragment."));
        }
        let suffix = match self.api {
            Api::Responses => "/responses",
            Api::Messages => "/messages",
            Api::ChatCompletions => "/chat/completions",
        };
        let path = url.path().trim_end_matches('/').to_string();
        let names_endpoint = ["/responses", "/messages", "/chat/completions"].iter().any(|s| path.ends_with(s));
        if names_endpoint && !path.ends_with(suffix) {
            return Err(Error::new("The endpoint in --baseurl does not match --api."));
        }
        if !path.ends_with(suffix) {
            let base = if path.is_empty() { "/v1" } else { &path };
            url.set_path(&format!("{base}{suffix}"));
        } else {
            url.set_path(&path);
        }
        Ok(url.into())
    }

    pub fn request(&self, prompt: &str) -> Result<Request, Error> {
        let url = self.endpoint()?;
        let mut headers = BTreeMap::new();
        headers.insert("Content-Type".into(), "application/json".into());
        let accept = if self.stream { "text/event-stream" } else { "application/json" };
        headers.insert("Accept".into(), accept.into());
        let tier = (self.service_tier != "default").then_some(self.service_tier.as_str());
        let effort = (!self.effort.is_empty() && self.effort != "default").then_some(self.effort.as_str());
        let messages = json!([{ "role": "user", "content": prompt }]);
        let mut body = Map::new();
        body.insert("model".into(), json!(self.model));
        match self.api {
            Api::Messages => {
                headers.insert("x-api-key".into(), self.api_key.clone());
                headers.insert("anthropic-version".into(), "2023-06-01".into());
                body.insert("messages".into(), messages);
                body.insert("max_tokens".into(), json!(8192));
                body.insert("stream".into(), json!(self.stream));
                if self.effort == "none" {
                    body.insert("thinking".into(), json!({ "type": "disabled" }));
                } else if let Some(effort) = effort {
                    body.insert("thinking".into(), json!({ "type": "adaptive" }));
                    body.insert("output_config".into(), json!({ "effort": effort }));
                }
                if let Some(tier) = tier {
                    headers.insert("anthropic-beta".into(), SPEED_BETA.into());
                    body.insert("speed".into(), json!(tier));
                }
            }
            Api::Responses => {
                headers.insert("Authorization".into(), format!("Bearer {}", self.api_key));
                body.insert("input".into(), messages);
                body.insert("stream".into(), json!(self.stream));
                body.insert("store".into(), json!(false));
                if let Some(effort) = effort {
                    body.insert("reasoning".into(), json!({ "effort": effort }));
                }
                if let Some(tier) = tier {
                    body.insert("service_tier".into(), json!(tier));
                }
            }
            Api::ChatCompletions => {
                headers.insert("Authorization".into(), format!("Bearer {}", self.api_key));
                body.insert("messages".into(), messages);
                body.insert("stream".into(), json!(self.stream));
                if let Some(effort) = effort {
                    body.insert("reasoning_effort".into(), json!(effort));
                }
                if let Some(tier) = tier {
                    body.insert("service_tier".into(), json!(tier));
                }
                // Chat Completions streams report usage only on request.
                if self.stream {
                    body.insert("stream_options".into(), json!({ "include_usage": true }));
                }
            }
        }
        Ok(Request { url, headers, body: Value::Object(body) })
    }
}

/// The HTTP request `detect` sends for one prompt, or the config error.
pub fn build_request(config: &DetectConfig, prompt: &str) -> Result<Request, Error> {
    Options::new(config)?.request(prompt)
}
