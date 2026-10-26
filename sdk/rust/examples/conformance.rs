//! Checks the crate against sdk/conformance.
//! Usage: cargo run --release --example conformance -- <conformance dir> <data dir>

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;

use lmfpd::{Api, Challenge, DetectConfig, Detector, LoadOptions, Output, build_request, parse_numbers, request_sample};
use serde_json::{Value, json};

struct Checker {
    failures: usize,
}

impl Checker {
    /// Reports every mismatch. Numbers match within a relative 1e-9; everything else must be identical.
    fn compare(&mut self, file: &str, name: &str, expected: &Value, actual: &Value, path: &str) {
        let same = match (expected, actual) {
            (Value::Number(a), Value::Number(b)) => {
                let (a, b) = (a.as_f64().unwrap_or(f64::NAN), b.as_f64().unwrap_or(f64::NAN));
                (a - b).abs() <= 1e-9 * 1f64.max(a.abs()).max(b.abs())
            }
            (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
                for (i, (x, y)) in a.iter().zip(b).enumerate() {
                    self.compare(file, name, x, y, &format!("{path}[{i}]"));
                }
                true
            }
            (Value::Object(a), Value::Object(b)) if a.len() == b.len() && a.keys().all(|k| b.contains_key(k)) => {
                for (key, x) in a {
                    self.compare(file, name, x, &b[key], &format!("{path}.{key}"));
                }
                true
            }
            (Value::Array(_), _) | (Value::Object(_), _) | (Value::Number(_), _) => false,
            _ => expected == actual,
        };
        if !same {
            self.failures += 1;
            println!("FAIL {file}:{name}: {path} expected {expected} got {actual}");
        }
    }
}

fn fixture(dir: &Path, name: &str) -> Value {
    let text = std::fs::read_to_string(dir.join(name)).unwrap_or_else(|e| panic!("cannot read {name}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("invalid {name}: {e}"))
}

fn str_field<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

/// Serves every POST under `/<case name>/` with that case's canned response.
fn serve(cases: Arc<Vec<Value>>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let port = listener.local_addr().expect("mock address").port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let cases = Arc::clone(&cases);
            std::thread::spawn(move || respond(stream, &cases));
        }
    });
    port
}

fn respond(stream: TcpStream, cases: &[Value]) {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut length = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':')
            && name.eq_ignore_ascii_case("content-length")
        {
            length = value.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0; length];
    let _ = reader.read_exact(&mut body);
    let mut parts = request_line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let case = cases.iter().find(|case| path.starts_with(&format!("/{}/", str_field(case, "name"))));
    let (status, content_type, body) = match case {
        Some(case) if method == "POST" => {
            let response = &case["response"];
            (response["status"].as_u64().unwrap_or(500), str_field(response, "content_type"), str_field(response, "body"))
        }
        _ => (404, "text/plain", "not found"),
    };
    let mut stream = reader.into_inner();
    let _ = write!(
        stream,
        "HTTP/1.1 {status} X\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [dir, data_dir] = args.as_slice() else {
        eprintln!("Usage: conformance <conformance dir> <data dir>");
        std::process::exit(2);
    };
    let dir = Path::new(dir);
    // The mock server is local; keep any configured proxy away from it. Set before the HTTP agent is created.
    let no_proxy = std::env::var("NO_PROXY").map(|v| format!("{v},127.0.0.1")).unwrap_or_else(|_| "127.0.0.1".into());
    // SAFETY: no other thread is running yet.
    unsafe { std::env::set_var("NO_PROXY", no_proxy) };
    let mut check = Checker { failures: 0 };

    let templates = std::fs::read(dir.join("templates.json")).expect("cannot read templates.json");
    if templates != include_bytes!("../src/templates.json") {
        check.failures += 1;
        println!("FAIL templates.json: src/templates.json differs from the conformance copy");
    }

    let parse = fixture(dir, "parse.json");
    let parse = parse.as_array().expect("parse.json is an array");
    for (i, item) in parse.iter().enumerate() {
        let actual = json!(parse_numbers(str_field(item, "text")));
        check.compare("parse.json", &i.to_string(), &item["numbers"], &actual, "$");
    }

    let requests = fixture(dir, "requests.json");
    let requests = requests.as_array().expect("requests.json is an array");
    for item in requests {
        let config = &item["config"];
        let mut detect = DetectConfig::new(
            str_field(config, "base_url"),
            str_field(config, "api_key"),
            str_field(config, "model"),
        );
        detect.api = serde_json::from_value::<Api>(config["api"].clone()).expect("known api");
        detect.stream = config["stream"].as_bool().unwrap_or(true);
        if let Some(effort) = config["effort"].as_str() {
            detect.effort = effort.into();
        }
        if let Some(tier) = config["service_tier"].as_str() {
            detect.service_tier = tier.into();
        }
        if let Some(timeout) = config["timeout"].as_f64() {
            detect.timeout = timeout;
        }
        let actual = match build_request(&detect, str_field(item, "prompt")) {
            Ok(request) => serde_json::to_value(request).expect("serializable request"),
            Err(error) => json!({ "error": error.to_string() }),
        };
        check.compare("requests.json", str_field(item, "name"), &item["expected"], &actual, "$");
    }

    let streams = fixture(dir, "streams.json");
    let streams = Arc::new(streams["cases"].as_array().expect("streams.json has cases").clone());
    let port = serve(Arc::clone(&streams));
    for item in streams.iter() {
        let name = str_field(item, "name");
        let mut config = DetectConfig::new(format!("http://127.0.0.1:{port}/{name}"), "test-key", "test-model");
        config.api = serde_json::from_value(item["api"].clone()).expect("known api");
        config.stream = item["stream"].as_bool().unwrap_or(true);
        config.strict = item["strict"].as_bool().unwrap_or(false);
        config.timeout = 10.0;
        let challenge = Challenge {
            id: "conformance".into(),
            prompt: "conformance".into(),
            expected_count: item["expected_count"].as_u64().expect("expected_count"),
        };
        let mut actual = serde_json::to_value(request_sample(&config, &challenge)).expect("serializable sample");
        actual.as_object_mut().expect("sample object").remove("expected_count");
        check.compare("streams.json", name, &item["expected"], &actual, "$");
    }

    let analyze = fixture(dir, "analyze.json");
    let options = LoadOptions { sources: vec![data_dir.clone()], ..LoadOptions::default() };
    let detector = Detector::load(&options).unwrap_or_else(|e| {
        println!("FAIL analyze.json: {e}");
        std::process::exit(1);
    });
    if detector.built_at() != str_field(&analyze["data"], "built_at") {
        println!("FAIL analyze.json: analyze.json was generated for another data build; run bun run sdk:generate");
        std::process::exit(1);
    }
    let cases = analyze["cases"].as_array().expect("analyze.json has cases");
    for item in cases {
        let outputs: Vec<Output> = serde_json::from_value(item["outputs"].clone()).expect("valid outputs");
        let strict = item["strict"].as_bool().unwrap_or(false);
        let actual = match detector.analyze(&outputs, strict) {
            Ok(analysis) => serde_json::to_value(analysis).expect("serializable analysis"),
            Err(error) => json!({ "error": error.to_string() }),
        };
        check.compare("analyze.json", str_field(item, "name"), &item["expected"], &actual, "$");
    }

    if check.failures > 0 {
        std::process::exit(1);
    }
    println!(
        "ok analyze={} parse={} requests={} streams={}",
        cases.len(),
        parse.len(),
        requests.len(),
        streams.len()
    );
}
