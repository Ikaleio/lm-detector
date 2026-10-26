//! One live request (`requestSample` in `shared/detect-request.ts`): SSE or JSON, completion checks, and error cleanup.

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, LazyLock};
use std::thread;
use std::time::{Duration, Instant};

use regex::Regex;
use serde_json::Value;
use ureq::Agent;

use crate::analysis::join;
use crate::features::{minimum_numbers, parse_numbers};
use crate::request::{Options, new_agent};
use crate::{Api, Challenge, DetectConfig, Sample, SampleState};

/// The TS request timer: until disarmed, it waits for the first SSE byte or the whole JSON response. When it expires,
/// shutting the request's agent down interrupts the blocked read. Dropping it disarms it.
struct Watchdog {
    cancel: Option<mpsc::Sender<()>>,
    fired: Arc<AtomicBool>,
}

impl Watchdog {
    fn start(agent: Agent, timeout: Duration) -> Self {
        let (cancel, cancelled) = mpsc::channel::<()>();
        let fired = Arc::new(AtomicBool::new(false));
        if !timeout.is_zero() {
            let flag = Arc::clone(&fired);
            thread::spawn(move || {
                // Dropping the sender disconnects the channel, which ends the wait early.
                if cancelled.recv_timeout(timeout) == Err(RecvTimeoutError::Timeout) {
                    flag.store(true, Ordering::SeqCst);
                    agent.shutdown();
                }
            });
        }
        Self { cancel: Some(cancel), fired }
    }

    fn disarm(&mut self) {
        self.cancel = None;
    }

    fn fired(&self) -> bool {
        self.fired.load(Ordering::SeqCst)
    }
}

const NULL: Value = Value::Null;
const FINISHED: [&str; 3] = ["stop", "end_turn", "completed"];
const REFUSED: &str = "The model refused the request.";

static ANSI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").expect("valid regex"));

enum Failure {
    Timeout,
    Message(String),
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self::Message(message)
    }
}

impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        Self::Message(message.into())
    }
}

impl From<ureq::Error> for Failure {
    fn from(error: ureq::Error) -> Self {
        match error {
            ureq::Error::Timeout(_) => Self::Timeout,
            error => Self::Message(error.to_string()),
        }
    }
}

fn get<'a>(value: &'a Value, key: &str) -> &'a Value {
    value.get(key).unwrap_or(&NULL)
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

/// JavaScript truthiness.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn items(value: &Value) -> &[Value] {
    value.as_array().map_or(&[], Vec::as_slice)
}

/// The output text of Responses `output` items.
fn response_text<'a>(output: impl IntoIterator<Item = &'a Value>) -> String {
    output
        .into_iter()
        .filter(|item| get(item, "type") == "message")
        .flat_map(|item| items(get(item, "content")))
        .filter(|part| get(part, "type") == "output_text")
        .map(|part| text(get(part, "text")))
        .collect()
}

fn upstream_error(data: &Value) -> Result<(), Failure> {
    let error = get(data, "error");
    if truthy(error) || get(data, "type") == "error" {
        let detail = [text(get(error, "message")), text(get(data, "message")), text(error)]
            .into_iter()
            .find(|s| !s.is_empty())
            .unwrap_or("Request failed.");
        return Err(format!("Upstream error: {detail}").into());
    }
    Ok(())
}

/// Removes the API key and terminal control sequences, and caps the length at 500 UTF-16 units like the reference.
fn clean_error(message: &str, key: &str) -> String {
    let message = if key.is_empty() { message.to_string() } else { message.replace(key, "[REDACTED]") };
    let mut units = 0;
    ANSI.replace_all(&message, "")
        .chars()
        .map(|c| if matches!(c, '\x00'..='\x1f' | '\x7f'..='\u{9f}') { ' ' } else { c })
        .take_while(|c| {
            units += c.len_utf16();
            units <= 500
        })
        .collect()
}

/// Position and length of the first SSE frame delimiter.
fn frame_end(buffer: &[u8]) -> Option<(usize, usize)> {
    (0..buffer.len()).find_map(|i| {
        let rest = &buffer[i..];
        if rest.starts_with(b"\r\n\r\n") {
            Some((i, 4))
        } else if rest.starts_with(b"\n\n") || rest.starts_with(b"\r\r") {
            Some((i, 2))
        } else {
            None
        }
    })
}

struct Sampler<'a> {
    options: &'a Options,
    /// Receives the live sample at each progress point.
    update: &'a mut dyn FnMut(&Sample),
    sample: Sample,
    started: Instant,
    raw: String,
    finish: String,
    terminal: bool,
    truncated: bool,
}

impl Sampler<'_> {
    fn report(&mut self) {
        (self.update)(&self.sample);
    }

    fn first_byte(&mut self) {
        self.sample.first_byte_ms = Some(self.started.elapsed().as_millis() as u64);
    }

    fn accept_text(&mut self, text: String, last: bool) {
        let expected = self.sample.expected_count;
        // A trailing digit can belong to an unfinished SSE token (for example, 3 -> 355).
        let numbers = parse_numbers(if last { &text } else { text.trim_end_matches(|c: char| c.is_ascii_digit()) });
        self.sample.count = numbers.len() as u64;
        if !self.options.strict && self.sample.count >= expected {
            self.sample.text = join(&numbers[..expected as usize]);
            self.sample.count = expected;
            self.truncated = !last || numbers.len() as u64 > expected;
        } else {
            self.sample.text = text.clone();
        }
        self.sample.raw_text = text;
        self.report();
    }

    fn append_text(&mut self, part: &str) {
        self.raw.push_str(part);
        if !self.truncated {
            self.accept_text(self.raw.clone(), false);
        }
    }

    fn metadata(&mut self, data: &Value) {
        if let Some(model) = data.get("model").and_then(Value::as_str) {
            self.sample.response_model = Some(model.into());
        }
        if let Some(id) = data.get("id").and_then(Value::as_str) {
            self.sample.response_id = Some(id.into());
        }
    }

    fn check_refusal(&self) -> Result<(), Failure> {
        if self.finish == "refusal" || self.finish == "content_filter" { Err(REFUSED.into()) } else { Ok(()) }
    }

    fn finished(&self) -> bool {
        self.terminal && FINISHED.contains(&self.finish.as_str())
    }

    fn incomplete(&self) -> Failure {
        let finish = if self.finish.is_empty() { "missing finish status" } else { &self.finish };
        format!("The response did not complete ({finish}).").into()
    }

    fn event(&mut self, frame: &str) -> Result<(), Failure> {
        let payload = frame
            .split("\r\n")
            .flat_map(|line| line.split(['\r', '\n']))
            .filter_map(|line| line.strip_prefix("data:"))
            .map(|line| line.strip_prefix(' ').unwrap_or(line))
            .collect::<Vec<_>>()
            .join("\n");
        if payload.is_empty() {
            return Ok(());
        }
        if payload.trim() == "[DONE]" {
            self.terminal = true;
            return Ok(());
        }
        let data: Value =
            serde_json::from_str(&payload).map_err(|_| Failure::from("The SSE response contains invalid JSON."))?;
        let data = if data.is_object() { data } else { Value::Null };
        upstream_error(&data)?;
        self.metadata(&data);
        let kind = text(get(&data, "type"));
        match self.options.api {
            Api::ChatCompletions => {
                let choices = items(get(&data, "choices"));
                let choice =
                    choices.iter().find(|c| get(c, "index").as_f64() == Some(0.0)).or(choices.first()).unwrap_or(&NULL);
                let delta = get(choice, "delta");
                if truthy(get(delta, "refusal")) {
                    return Err(REFUSED.into());
                }
                if truthy(get(choice, "finish_reason")) {
                    self.finish = text(get(choice, "finish_reason")).into();
                }
                if let Some(content) = get(delta, "content").as_str() {
                    self.append_text(content);
                }
            }
            Api::Messages => {
                if kind == "message_start" {
                    self.metadata(get(&data, "message"));
                }
                if kind == "content_block_start" && get(get(&data, "content_block"), "type") == "text" {
                    self.append_text(text(get(get(&data, "content_block"), "text")));
                }
                let delta = get(&data, "delta");
                if kind == "content_block_delta" && get(delta, "type") == "text_delta" {
                    self.append_text(text(get(delta, "text")));
                }
                if kind == "message_delta" {
                    let stop = text(get(delta, "stop_reason"));
                    if !stop.is_empty() {
                        self.finish = stop.into();
                    }
                }
                if kind == "message_stop" {
                    self.terminal = true;
                }
            }
            Api::Responses => {
                let response = get(&data, "response");
                if kind == "response.created" || kind == "response.in_progress" {
                    self.metadata(response);
                }
                if kind == "response.output_text.delta" {
                    self.append_text(text(get(&data, "delta")));
                }
                if kind == "response.output_text.done" && self.sample.raw_text.is_empty() {
                    self.accept_text(text(get(&data, "text")).into(), true);
                }
                if kind == "response.output_item.done" && self.sample.raw_text.is_empty() {
                    self.accept_text(response_text([get(&data, "item")]), true);
                }
                if kind == "response.refusal.delta" {
                    return Err(REFUSED.into());
                }
                if kind == "response.completed" {
                    self.metadata(response);
                    self.terminal = true;
                    let status = text(get(response, "status"));
                    self.finish = if status.is_empty() { "completed".into() } else { status.into() };
                    let full = response_text(items(get(response, "output")));
                    if !full.is_empty() && !self.truncated {
                        self.accept_text(full, true);
                    }
                }
                if kind == "response.failed" || kind == "response.incomplete" {
                    let detail = [
                        text(get(get(response, "error"), "message")),
                        text(get(get(response, "incomplete_details"), "reason")),
                        kind,
                    ]
                    .into_iter()
                    .find(|s| !s.is_empty())
                    .unwrap_or("");
                    return Err(format!("Responses request did not complete: {detail}.").into());
                }
            }
        }
        self.check_refusal()
    }

    fn reading(&self) -> bool {
        // Text after the cap cannot change the sample, so reading stops there.
        !self.terminal && !self.truncated
    }

    fn read_sse(&mut self, mut reader: impl Read, watchdog: &mut Watchdog) -> Result<(), Failure> {
        let mut buffer = Vec::new();
        let mut chunk = vec![0u8; 16 * 1024];
        while self.reading() {
            let n = reader.read(&mut chunk).map_err(|e| e.to_string())?;
            if n > 0 && self.sample.first_byte_ms.is_none() {
                // Only the first body byte has a deadline; a stream may then run past the timeout.
                watchdog.disarm();
                self.first_byte();
                self.sample.state = SampleState::Streaming;
                self.report();
            }
            if n == 0 {
                let rest = String::from_utf8_lossy(&buffer);
                if !rest.trim().is_empty() {
                    self.event(&rest)?;
                }
                break;
            }
            buffer.extend_from_slice(&chunk[..n]);
            let mut start = 0;
            while self.reading() {
                let Some((at, length)) = frame_end(&buffer[start..]) else { break };
                self.event(&String::from_utf8_lossy(&buffer[start..start + at]))?;
                start += at + length;
            }
            buffer.drain(..start);
        }
        Ok(())
    }

    fn read_json(&mut self, body: &[u8]) -> Result<(), Failure> {
        let data: Value =
            serde_json::from_slice(body).map_err(|_| Failure::from("The server did not return valid JSON or SSE."))?;
        self.first_byte();
        let data = if data.is_object() { data } else { Value::Null };
        upstream_error(&data)?;
        self.metadata(&data);
        let text = match self.options.api {
            Api::Responses => {
                self.finish = text(get(&data, "status")).into();
                self.terminal = self.finish == "completed";
                response_text(items(get(&data, "output")))
            }
            Api::Messages => {
                self.finish = text(get(&data, "stop_reason")).into();
                self.terminal = true;
                items(get(&data, "content"))
                    .iter()
                    .filter(|part| get(part, "type") == "text")
                    .map(|part| text(get(part, "text")))
                    .collect()
            }
            Api::ChatCompletions => {
                let choice = items(get(&data, "choices")).first().unwrap_or(&NULL);
                let message = get(choice, "message");
                if truthy(get(message, "refusal")) {
                    return Err(REFUSED.into());
                }
                self.finish = text(get(choice, "finish_reason")).into();
                self.terminal = true;
                text(get(message, "content")).into()
            }
        };
        self.check_refusal()?;
        if !self.finished() {
            return Err(self.incomplete());
        }
        self.accept_text(text, true);
        Ok(())
    }

    fn run(&mut self, prompt: &str) -> Result<SampleState, Failure> {
        let request = self.options.request(prompt).map_err(|e| e.to_string())?;
        let timeout = Duration::from_millis(self.options.timeout_ms);
        // A private agent lets the watchdog interrupt this request without touching parallel ones.
        let agent = new_agent();
        let mut watchdog = Watchdog::start(agent.clone(), timeout);
        let result = self.exchange(&agent, &request, timeout, &mut watchdog);
        // As in TS, a timer that fired decides the error even when the interrupted read ended another way.
        if watchdog.fired() { Err(Failure::Timeout) } else { result }
    }

    fn exchange(
        &mut self,
        agent: &Agent,
        request: &crate::Request,
        timeout: Duration,
        watchdog: &mut Watchdog,
    ) -> Result<SampleState, Failure> {
        let mut builder = agent.post(&request.url);
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        // Shutting the agent down cannot interrupt a connect in progress, so connecting keeps its own deadline.
        let builder = if timeout.is_zero() {
            builder
        } else {
            builder.config().timeout_resolve(Some(timeout)).timeout_connect(Some(timeout)).build()
        };
        let body = serde_json::to_vec(&request.body).map_err(|e| e.to_string())?;
        let mut response = builder.send(body.as_slice())?;
        let status = response.status();
        if !status.is_success() {
            let body = response.body_mut().read_to_vec()?;
            let body = String::from_utf8_lossy(&body);
            let detail = match serde_json::from_str::<Value>(&body) {
                Ok(data) => [text(get(get(&data, "error"), "message")), text(get(&data, "message"))]
                    .into_iter()
                    .find(|s| !s.is_empty())
                    .map_or_else(|| body.to_string(), str::to_string),
                Err(_) => body.to_string(),
            };
            let detail = if detail.is_empty() { status.canonical_reason().unwrap_or("").to_string() } else { detail };
            return Err(format!("HTTP {}: {detail}", status.as_u16()).into());
        }
        let event_stream = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.to_ascii_lowercase().contains("text/event-stream"));
        if event_stream {
            self.read_sse(response.into_body().into_reader(), watchdog)?;
        } else {
            let body = response.body_mut().read_to_vec()?;
            watchdog.disarm();
            self.read_json(&body)?;
        }
        if !self.truncated && !self.finished() {
            return Err(self.incomplete());
        }
        if !self.truncated {
            self.accept_text(self.sample.raw_text.clone(), true);
        }
        let minimum = minimum_numbers(self.sample.expected_count);
        if self.sample.count < minimum {
            return Err(format!("Too few valid numbers: {}; need at least {minimum}.", self.sample.count).into());
        }
        Ok(if self.truncated { SampleState::Truncated } else { SampleState::Complete })
    }
}

/// Sends one challenge and passes the live sample to `update` when it starts, at the first SSE byte, at each text
/// change, and once settled. Returns the settled sample, which is also the last update.
pub(crate) fn sample(options: &Options, challenge: &Challenge, update: &mut dyn FnMut(&Sample)) -> Sample {
    let mut sampler = Sampler {
        options,
        update,
        sample: Sample::empty(SampleState::Waiting, challenge.expected_count),
        started: Instant::now(),
        raw: String::new(),
        finish: String::new(),
        terminal: false,
        truncated: false,
    };
    sampler.report();
    let (state, error) = match sampler.run(&challenge.prompt) {
        Ok(state) => (state, None),
        Err(Failure::Timeout) => {
            // The timer can fire just as the first byte arrives; a timed-out sample has none.
            sampler.sample.first_byte_ms = None;
            let waiting = if options.stream { "the first SSE byte" } else { "the JSON response" };
            let seconds = options.timeout_ms as f64 / 1000.0;
            (SampleState::Failed, Some(format!("Timed out after {seconds}s waiting for {waiting}.")))
        }
        Err(Failure::Message(message)) => (SampleState::Failed, Some(clean_error(&message, &options.api_key))),
    };
    sampler.sample.state = state;
    sampler.sample.error = error;
    sampler.report();
    sampler.sample
}

/// Sends one challenge and returns the checked reply. Request and config failures are reported in `error`.
pub fn request_sample(config: &DetectConfig, challenge: &Challenge) -> Sample {
    match Options::new(config) {
        Ok(options) => sample(&options, challenge, &mut |_| {}),
        Err(error) => Sample {
            error: Some(error.to_string()),
            ..Sample::empty(SampleState::Failed, challenge.expected_count)
        },
    }
}
