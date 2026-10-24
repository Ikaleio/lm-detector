//! Number parsing and the feature blocks (`fingerprint-core.js`, `positional.ts`).

use std::sync::LazyLock;

use regex::Regex;

const VALUE_MAX: u32 = 355;
const DIMENSION: usize = 355;
const ALPHA: f64 = 0.5;
const LAGS: [usize; 8] = [1, 2, 3, 5, 8, 13, 21, 34];

static LETTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{L}").expect("valid regex"));

/// The value of an ASCII digit run, or `None` when it is outside 1..=355.
fn value(digits: &str) -> Option<u32> {
    let digits = digits.trim_start_matches('0');
    if digits.len() > 3 {
        return None;
    }
    let value = digits.bytes().fold(0, |value, digit| value * 10 + u32::from(digit - b'0'));
    (1..=VALUE_MAX).contains(&value).then_some(value)
}

/// Byte ranges of the ASCII digit runs in `text`.
fn digit_runs(text: &str) -> impl Iterator<Item = (usize, usize)> + '_ {
    let bytes = text.as_bytes();
    let mut i = 0;
    std::iter::from_fn(move || {
        while i < bytes.len() && !bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i == bytes.len() {
            return None;
        }
        let start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        Some((start, i))
    })
}

/// The numbers 1 to 355 of the longest run in a reply; letters between numbers split runs.
pub fn parse_numbers(text: &str) -> Vec<u32> {
    let mut best = Vec::new();
    let mut current = Vec::new();
    let mut previous_end = 0;
    for (start, end) in digit_runs(text) {
        if !current.is_empty() && LETTER.is_match(&text[previous_end..start]) {
            if current.len() > best.len() {
                best = std::mem::take(&mut current);
            } else {
                current.clear();
            }
        }
        if let Some(value) = value(&text[start..end]) {
            current.push(value);
        }
        previous_end = end;
    }
    if current.len() > best.len() { current } else { best }
}

/// Matches of `-?[0-9]+` whose value is below 1 or above 355.
pub(crate) fn raw_out_of_range_count(text: &str) -> usize {
    let bytes = text.as_bytes();
    digit_runs(text)
        .filter(|&(start, end)| (start > 0 && bytes[start - 1] == b'-') || value(&text[start..end]).is_none())
        .count()
}

pub(crate) fn minimum_numbers(expected: u64) -> u64 {
    80.max((expected as f64 * 0.55).ceil() as u64)
}

fn sum(values: &[f64]) -> f64 {
    values.iter().fold(0.0, |total, value| total + value)
}

fn mean(values: &[f64]) -> f64 {
    sum(values) / values.len() as f64
}

fn count_numbers(numbers: &[u32]) -> Vec<f64> {
    let mut counts = vec![0.0; DIMENSION];
    for &number in numbers {
        counts[number as usize - 1] += 1.0;
    }
    counts
}

pub(crate) fn hellinger_feature(numbers: &[u32]) -> Vec<f64> {
    let counts = count_numbers(numbers);
    let total = sum(&counts) + ALPHA * DIMENSION as f64;
    counts.iter().map(|value| ((value + ALPHA) / total).sqrt()).collect()
}

pub(crate) fn ordered_block_feature(numbers: &[u32]) -> Vec<f64> {
    let mut pieces = Vec::with_capacity(4 * 16 + 10);
    let base = numbers.len() / 4;
    let remainder = numbers.len() % 4;
    let mut start = 0;
    for index in 0..4 {
        let size = base + usize::from(index < remainder);
        let mut bins = [0.5; 16];
        for &value in &numbers[start..start + size] {
            bins[15.min(((f64::from(value) - 1.0) / 355.0 * 16.0).floor() as usize)] += 1.0;
        }
        let total = sum(&bins);
        pieces.extend(bins.iter().map(|value| (value / total).sqrt()));
        start += size;
    }
    let mut last_digits = [0.5; 10];
    for &value in numbers {
        last_digits[(value % 10) as usize] += 1.0;
    }
    let total = sum(&last_digits);
    pieces.extend(last_digits.iter().map(|value| (value / total).sqrt()));
    pieces
}

fn position_kernel(x: &[u32]) -> Vec<f64> {
    let n = x.len() as f64;
    let mut out = vec![0.0; 34 * 3];
    for (position, &value) in x.iter().enumerate() {
        let t = (position as f64 + 0.5) * 2.0 / n - 1.0;
        let basis = [t, 0.5 * (3.0 * t * t - 1.0), 0.5 * (5.0 * t.powi(3) - 3.0 * t)];
        let v = f64::from(value);
        for k in 0..24 {
            let centre = 1.0 + k as f64 * 354.0 / 23.0;
            let d = (v - centre) / 20.0;
            let weight = (-0.5 * (d * d)).exp();
            for (j, b) in basis.iter().enumerate() {
                out[k * 3 + j] += weight * b / n;
            }
        }
        // The digit indicators are one-hot; adding the zero weights would not change any sum.
        let k = 24 + (value % 10) as usize;
        for (j, b) in basis.iter().enumerate() {
            out[k * 3 + j] += b / n;
        }
    }
    out
}

fn centred_transitions(symbols: &[usize], bins: usize, out: &mut Vec<f64>) {
    let mut joint = vec![0.5; bins * bins];
    let total = (symbols.len() - 1) as f64 + 0.5 * (bins * bins) as f64;
    for pair in symbols.windows(2) {
        joint[pair[0] * bins + pair[1]] += 1.0;
    }
    for value in &mut joint {
        *value /= total;
    }
    let rows: Vec<f64> = joint.chunks(bins).map(sum).collect();
    let columns: Vec<f64> = (0..bins).map(|b| (0..bins).fold(0.0, |s, a| s + joint[a * bins + b])).collect();
    out.extend(joint.iter().enumerate().map(|(i, value)| value - rows[i / bins] * columns[i % bins]));
}

fn fraction(length: usize, test: impl Fn(usize) -> bool) -> f64 {
    (0..length).filter(|&i| test(i)).count() as f64 / length as f64
}

fn sign(value: f64) -> i8 {
    if value > 0.0 {
        1
    } else if value < 0.0 {
        -1
    } else {
        0
    }
}

fn sequence_features(numbers: &[u32]) -> Vec<f64> {
    let x: Vec<f64> = numbers.iter().map(|&v| f64::from(v)).collect();
    let n = x.len();
    let m = mean(&x);
    let squares: Vec<f64> = x.iter().map(|v| (v - m) * (v - m)).collect();
    let sd = mean(&squares).sqrt().max(1.0);
    let s: Vec<f64> = x.iter().map(|v| (v - m) / sd).collect();
    let mut out = Vec::new();
    for lag in LAGS {
        let count = n - lag;
        let d: Vec<f64> = (0..count).map(|i| x[i + lag] - x[i]).collect();
        let products: Vec<f64> = (0..count).map(|i| s[i + lag] * s[i]).collect();
        let absolute: Vec<f64> = d.iter().map(|v| v.abs()).collect();
        out.extend([
            mean(&products),
            mean(&absolute) / 355.0,
            fraction(count, |i| d[i] > 0.0),
            fraction(count, |i| d[i] == 0.0),
            fraction(count, |i| d[i].abs() <= 5.0),
            fraction(count, |i| d[i].abs() <= 20.0),
        ]);
    }
    let octets: Vec<usize> = numbers.iter().map(|&v| 7.min((v - 1) as usize * 8 / 355)).collect();
    centred_transitions(&octets, 8, &mut out);
    let digits: Vec<usize> = numbers.iter().map(|&v| (v % 10) as usize).collect();
    centred_transitions(&digits, 10, &mut out);
    let difference: Vec<f64> = (0..n - 1).map(|i| x[i + 1] - x[i]).collect();
    let z_step: Vec<f64> = (0..n - 1).map(|i| (s[i + 1] - s[i]).abs()).collect();
    out.extend([
        fraction(n - 2, |i| sign(difference[i + 1]) == sign(difference[i])),
        fraction(n - 2, |i| difference[i + 1] == difference[i]),
        fraction(n - 1, |i| numbers[i] % 10 == numbers[i + 1] % 10),
        fraction(n - 1, |i| z_step[i] > 1.0),
        fraction(n - 1, |i| z_step[i] > 2.0),
    ]);
    let buckets: Vec<usize> = numbers.iter().map(|&v| 15.min((v - 1) as usize * 16 / 355)).collect();
    for width in [4, 8, 16] {
        let mut total = 0.0;
        for window in buckets.windows(width) {
            let mut seen = 0u16;
            for &bucket in window {
                seen |= 1 << bucket;
            }
            total += seen.count_ones() as f64 / width as f64;
        }
        out.push(total / (n - width + 1) as f64);
    }
    out
}

/// The four blocks of the positional head, in detector order.
pub(crate) fn positional_features(numbers: &[u32]) -> [Vec<f64>; 4] {
    [
        hellinger_feature(numbers),
        ordered_block_feature(numbers),
        position_kernel(numbers),
        sequence_features(numbers),
    ]
}
