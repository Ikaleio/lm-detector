//! Reads `shared_detector.bin` (`shared/detector-codec.ts`) into the ranker's working layout.

use serde_json::Value;

use crate::ranker::{FeatureBank, PositionalHead, Preprocessing, Ranker, References};

/// The JSON header and the float32 values it points into.
pub(crate) struct Decoded {
    pub header: Value,
    floats: Vec<f32>,
}

/// Layout: u32 LE header length, JSON header, padding to 4 bytes, then the float bytes grouped by byte position.
pub(crate) fn decode(data: &[u8]) -> Option<Decoded> {
    let length = u32::from_le_bytes(data.get(..4)?.try_into().ok()?) as usize;
    let header = serde_json::from_slice(data.get(4..4 + length)?).ok()?;
    let start = (4 + length).div_ceil(4) * 4;
    let planes = data.get(start..)?;
    if planes.len() % 4 != 0 {
        return None;
    }
    let count = planes.len() / 4;
    let (b0, rest) = planes.split_at(count);
    let (b1, rest) = rest.split_at(count);
    let (b2, b3) = rest.split_at(count);
    let floats = (0..count).map(|i| f32::from_le_bytes([b0[i], b1[i], b2[i], b3[i]])).collect();
    Some(Decoded { header, floats })
}

fn field<'a>(value: &'a Value, key: &str) -> &'a Value {
    value.get(key).unwrap_or(&Value::Null)
}

impl Decoded {
    /// A number array: `{"$f32": offset, "n": length}`, or an inline array (the encoder keeps empty arrays inline).
    pub fn vec(&self, value: &Value) -> Option<Vec<f64>> {
        if let Some(offset) = value.get("$f32") {
            let offset = usize::try_from(offset.as_u64()?).ok()?;
            let n = usize::try_from(value.get("n")?.as_u64()?).ok()?;
            let values = self.floats.get(offset..offset.checked_add(n)?)?;
            return Some(values.iter().map(|&x| f64::from(x)).collect());
        }
        value.as_array()?.iter().map(Value::as_f64).collect()
    }

    fn mat(&self, value: &Value) -> Option<Vec<Vec<f64>>> {
        value.as_array()?.iter().map(|row| self.vec(row)).collect()
    }

    fn rows(&self, value: &Value, rows: usize, columns: usize) -> Option<Vec<Vec<f64>>> {
        let matrix = self.mat(value)?;
        (matrix.len() == rows && matrix.iter().all(|row| row.len() == columns)).then_some(matrix)
    }

    fn sized(&self, value: &Value, length: usize) -> Option<Vec<f64>> {
        self.vec(value).filter(|v| v.len() == length)
    }

    fn preprocessing(&self, value: &Value, sizes: &[usize]) -> Option<Vec<Preprocessing>> {
        let blocks = value.as_array()?;
        if blocks.len() != sizes.len() {
            return None;
        }
        blocks
            .iter()
            .zip(sizes)
            .map(|(block, &size)| {
                Some(Preprocessing {
                    mean: self.sized(field(block, "mean"), size)?,
                    scale: self.sized(field(block, "scale"), size)?,
                })
            })
            .collect()
    }

    fn feature_bank(&self, value: &Value, models: usize, size: usize) -> Option<FeatureBank> {
        let nuisance_basis = self.mat(field(value, "nuisance_basis"))?;
        if nuisance_basis.iter().any(|row| row.len() != size) {
            return None;
        }
        Some(FeatureBank {
            feature_mean: self.sized(field(value, "feature_mean"), size)?,
            feature_scale: self.sized(field(value, "feature_scale"), size)?,
            nuisance_basis,
            centroids: self.rows(field(value, "centroids"), models, size)?,
        })
    }

    /// The ranker for `models` identities. Checks every dimension, so scoring never indexes out of bounds.
    pub fn ranker(&self, models: usize) -> Option<Ranker> {
        const HELLINGER: usize = 355;
        const ORDERED: usize = 74;
        const POSITIONAL: [usize; 4] = [HELLINGER, ORDERED, 102, 220];
        let ranker = field(&self.header, "ranker");
        let bank = field(ranker, "bank");
        let width = HELLINGER + ORDERED;
        let references = field(ranker, "references")
            .as_array()?
            .iter()
            .map(|own| {
                let rows = self.mat(own)?;
                if rows.is_empty() || rows.iter().any(|row| row.len() != width) {
                    return None;
                }
                Some(References::new(width, &rows))
            })
            .collect::<Option<Vec<_>>>()?;
        let ordered = field(bank, "ordered_blocks");
        let environment_centroids = field(ordered, "environment_centroids")
            .as_array()?
            .iter()
            .map(|rows| self.rows(rows, models, ORDERED))
            .collect::<Option<Vec<_>>>()?;
        let positional = field(ranker, "positional");
        let blend = field(ranker, "blend");
        (references.len() == models && !environment_centroids.is_empty()).then_some(())?;
        Some(Ranker {
            head_params: self.preprocessing(field(ranker, "head_params"), &[HELLINGER, ORDERED])?,
            full_params: self.preprocessing(field(ranker, "full_params"), &[HELLINGER, ORDERED])?,
            lda_weights: self.rows(field(ranker, "lda_weights"), models, width)?,
            lda_bias: self.sized(field(ranker, "lda_bias"), models)?,
            references,
            hellinger: self.feature_bank(field(bank, "hellinger"), models, HELLINGER)?,
            ordered: self.feature_bank(ordered, models, ORDERED)?,
            environment_centroids,
            blend_frequency: field(blend, "frequency").as_f64()?,
            blend_positional: field(blend, "positional").as_f64()?,
            positional: PositionalHead {
                params: self.preprocessing(field(positional, "params"), &POSITIONAL)?,
                weights: self.rows(field(positional, "weights"), models, POSITIONAL.iter().sum())?,
                bias: self.sized(field(positional, "bias"), models)?,
            },
        })
    }
}
