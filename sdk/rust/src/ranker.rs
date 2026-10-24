//! The shared ranker (`shared/shared-detector.ts`, `shared/positional.ts`). Every reduction is a left-to-right
//! loop so the results match the TypeScript reference.

use crate::Sequence;
use crate::features::{hellinger_feature, ordered_block_feature, positional_features};

const POSITIONAL_WEIGHTS: [f64; 4] = [0.6, 0.15, 0.125, 0.125];
/// 99.5% quantiles over reference three-answer groups; see `SEQUENCE_LIMITS` in `shared/shared-detector.ts`.
const AUTOCORRELATION_LIMIT: f64 = -0.23;
const SMALL_STEP_SHARE_LIMIT: f64 = 0.05;
const NEIGHBOURS: usize = 7;

pub(crate) struct Preprocessing {
    pub mean: Vec<f64>,
    pub scale: Vec<f64>,
}

pub(crate) struct FeatureBank {
    pub feature_mean: Vec<f64>,
    pub feature_scale: Vec<f64>,
    pub nuisance_basis: Vec<Vec<f64>>,
    pub centroids: Vec<Vec<f64>>,
}

/// One identity's reference rows, stored contiguously with their precomputed squared norms.
pub(crate) struct References {
    width: usize,
    rows: Vec<f64>,
    norms: Vec<f64>,
}

pub(crate) struct PositionalHead {
    pub params: Vec<Preprocessing>,
    pub weights: Vec<Vec<f64>>,
    pub bias: Vec<f64>,
}

pub(crate) struct Ranker {
    pub head_params: Vec<Preprocessing>,
    pub full_params: Vec<Preprocessing>,
    pub lda_weights: Vec<Vec<f64>>,
    pub lda_bias: Vec<f64>,
    pub references: Vec<References>,
    pub hellinger: FeatureBank,
    pub ordered: FeatureBank,
    pub environment_centroids: Vec<Vec<Vec<f64>>>,
    pub blend_frequency: f64,
    pub blend_positional: f64,
    pub positional: PositionalHead,
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    let mut sum = 0.0;
    for (x, y) in a.iter().zip(b) {
        sum += x * y;
    }
    sum
}

fn sum(values: impl IntoIterator<Item = f64>) -> f64 {
    values.into_iter().fold(0.0, |total, value| total + value)
}

fn mean(values: &[f64]) -> f64 {
    sum(values.iter().copied()) / values.len() as f64
}

/// `Math.max(...values)`: NaN wins.
fn js_max(values: impl IntoIterator<Item = f64>) -> f64 {
    values.into_iter().fold(f64::NEG_INFINITY, |best, value| if value.is_nan() || value > best { value } else { best })
}

fn norm(mut values: Vec<f64>) -> Vec<f64> {
    let n = dot(&values, &values).sqrt().max(1e-12);
    for value in &mut values {
        *value /= n;
    }
    values
}

fn z(mut values: Vec<f64>) -> Vec<f64> {
    let m = mean(&values);
    let variance = sum(values.iter().map(|x| (x - m) * (x - m))) / values.len() as f64;
    let s = variance.sqrt().max(1e-12);
    for value in &mut values {
        *value = (*value - m) / s;
    }
    values
}

fn column_mean(rows: &[Vec<f64>]) -> Vec<f64> {
    (0..rows[0].len()).map(|i| sum(rows.iter().map(|row| row[i])) / rows.len() as f64).collect()
}

fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let i = sorted.len() / 2;
    if sorted.len() % 2 == 1 { sorted[i] } else { (sorted[i - 1] + sorted[i]) / 2.0 }
}

fn transform(blocks: [&[f64]; 2], params: &[Preprocessing]) -> Vec<f64> {
    let mut out = Vec::with_capacity(blocks[0].len() + blocks[1].len());
    for (j, (block, p)) in blocks.iter().zip(params).enumerate() {
        let scaled = block.iter().zip(&p.mean).zip(&p.scale).map(|((x, m), s)| (x - m) / s).collect();
        let weight = if j == 0 { 0.75f64 } else { 0.25 }.sqrt();
        out.extend(norm(scaled).into_iter().map(|x| x * weight));
    }
    out
}

fn centered(values: &[f64], bank: &FeatureBank) -> Vec<f64> {
    values.iter().zip(&bank.feature_mean).zip(&bank.feature_scale).map(|((x, m), s)| (x - m) / s).collect()
}

/// Removes every basis direction using coefficients taken from the original vector.
fn subtract(values: &[f64], basis: &[Vec<f64>]) -> Vec<f64> {
    let coefficients: Vec<f64> = basis.iter().map(|row| dot(values, row)).collect();
    values
        .iter()
        .enumerate()
        .map(|(i, x)| x - sum(basis.iter().zip(&coefficients).map(|(row, c)| c * row[i])))
        .collect()
}

impl References {
    pub fn new(width: usize, rows: &[Vec<f64>]) -> Self {
        Self { width, rows: rows.concat(), norms: rows.iter().map(|row| dot(row, row)).collect() }
    }

    /// Mean squared distance to the nearest references. `distances` is scratch space.
    fn nearest(&self, x: &[f64], xx: f64, distances: &mut Vec<f64>) -> f64 {
        distances.clear();
        distances.extend(
            self.rows.chunks_exact(self.width).zip(&self.norms).map(|(row, rr)| (xx + rr - 2.0 * dot(x, row)).max(0.0)),
        );
        distances.sort_unstable_by(f64::total_cmp);
        let nearest = &distances[..NEIGHBOURS.min(distances.len())];
        mean(nearest)
    }
}

impl Ranker {
    fn baseline(&self, hellinger: &[f64], ordered: &[f64]) -> Vec<f64> {
        let (h, o) = (&self.hellinger, &self.ordered);
        let h_unit = norm(subtract(&centered(hellinger, h), &h.nuisance_basis));
        let marginal = h.centroids.iter().map(|row| dot(&h_unit, row)).collect();
        let o_centered = centered(ordered, o);
        let projected = norm(subtract(&o_centered, &o.nuisance_basis));
        let raw = norm(o_centered);
        let templates = (0..o.centroids.len())
            .map(|i| js_max(self.environment_centroids.iter().map(|rows| dot(&raw, &rows[i]))))
            .collect();
        let nuisance = o.centroids.iter().map(|row| dot(&projected, row)).collect();
        let (tz, nz) = (z(templates), z(nuisance));
        let ordered = z(tz.iter().zip(&nz).map(|(t, n)| 0.5 * t + 0.5 * n).collect());
        z(marginal).iter().zip(&ordered).map(|(m, o)| 0.5 * m + 0.5 * o).collect()
    }

    fn positional_decision(&self, numbers: &[u32]) -> Vec<f64> {
        let head = &self.positional;
        let mut x = Vec::with_capacity(head.weights[0].len());
        for (j, (block, p)) in positional_features(numbers).iter().zip(&head.params).enumerate() {
            let scaled: Vec<f64> = block.iter().zip(&p.mean).zip(&p.scale).map(|((v, m), s)| (v - m) / s).collect();
            let length = dot(&scaled, &scaled).sqrt().max(1e-12);
            let weight = POSITIONAL_WEIGHTS[j].sqrt();
            x.extend(scaled.iter().map(|v| v / length * weight));
        }
        head.weights.iter().zip(&head.bias).map(|(row, &bias)| row.iter().zip(&x).fold(bias, |s, (w, v)| s + w * v)).collect()
    }

    /// Ranking scores per identity, or `None` when they are not finite.
    pub fn rank(&self, numbers: &[Vec<u32>]) -> Option<Vec<f64>> {
        let full: Vec<[Vec<f64>; 2]> =
            numbers.iter().map(|n| [hellinger_feature(n), ordered_block_feature(n)]).collect();
        let ax: Vec<Vec<f64>> = full.iter().map(|[h, o]| transform([h, o], &self.full_params)).collect();
        let lda: Vec<Vec<f64>> = numbers
            .iter()
            .map(|n| {
                let head = &n[..n.len().min(128)];
                let x = transform([&hellinger_feature(head), &ordered_block_feature(head)], &self.head_params);
                z(self.lda_weights.iter().zip(&self.lda_bias).map(|(row, b)| dot(row, &x) + b).collect())
            })
            .collect();
        let l = z(column_mean(&lda));
        let norms: Vec<f64> = ax.iter().map(|x| dot(x, x)).collect();
        let mut distances = Vec::new();
        let mut negatives = Vec::with_capacity(ax.len());
        let near = z(self
            .references
            .iter()
            .map(|references| {
                negatives.clear();
                negatives.extend(ax.iter().zip(&norms).map(|(x, &xx)| -references.nearest(x, xx, &mut distances)));
                median(&negatives)
            })
            .collect());
        let baselines: Vec<Vec<f64>> = full.iter().map(|[h, o]| self.baseline(h, o)).collect();
        let base = z(column_mean(&baselines));
        let frequency = z(l.iter().zip(&near).zip(&base).map(|((l, n), b)| 0.5 * l + 0.25 * n + 0.25 * b).collect());
        let decisions: Vec<Vec<f64>> = numbers.iter().map(|n| z(self.positional_decision(n))).collect();
        let positional = z(column_mean(&decisions));
        let ranking: Vec<f64> = frequency
            .iter()
            .zip(&positional)
            .map(|(f, p)| self.blend_frequency * f + self.blend_positional * p)
            .collect();
        ranking.iter().all(|x| x.is_finite()).then_some(ranking)
    }
}

/// Closed-set probabilities from a ranking-temperature calibration.
pub(crate) fn calibrate(ranking: &[f64], tau: f64) -> Vec<f64> {
    let logits: Vec<f64> = ranking.iter().map(|score| tau * score).collect();
    let maximum = js_max(logits.iter().copied());
    let weights: Vec<f64> = logits.iter().map(|value| (value - maximum).exp()).collect();
    let total = sum(weights.iter().copied());
    weights.iter().map(|value| value / total).collect()
}

/// Reference replies have negative lag-1 autocorrelation and few steps of 20 or less. Reject only when both
/// signals exceed their limits.
pub(crate) fn sequence_shape(numbers: &[Vec<u32>]) -> Sequence {
    let (autocorrelations, small_steps): (Vec<f64>, Vec<f64>) = numbers
        .iter()
        .map(|n| {
            let x: Vec<f64> = n.iter().map(|&v| f64::from(v)).collect();
            let m = mean(&x);
            let variance = sum(x.iter().map(|v| (v - m) * (v - m))) / x.len() as f64;
            let steps = x.len() - 1;
            let autocorrelation = if variance != 0.0 {
                sum((0..steps).map(|i| (x[i + 1] - m) * (x[i] - m))) / steps as f64 / variance
            } else {
                1.0
            };
            let small = sum((0..steps).map(|i| if (x[i + 1] - x[i]).abs() <= 20.0 { 1.0 } else { 0.0 })) / steps as f64;
            (autocorrelation, small)
        })
        .unzip();
    let autocorrelation = median(&autocorrelations);
    let small_step_share = median(&small_steps);
    Sequence {
        autocorrelation,
        small_step_share,
        model_like: autocorrelation <= AUTOCORRELATION_LIMIT || small_step_share <= SMALL_STEP_SHARE_LIMIT,
    }
}
