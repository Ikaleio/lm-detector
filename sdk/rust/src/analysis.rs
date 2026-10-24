//! `analyzeSharedOutputs` with the CLI's English labels, in the canonical shape.

use crate::data::ReferenceData;
use crate::features::{minimum_numbers, parse_numbers, raw_out_of_range_count};
use crate::ranker::{calibrate, sequence_shape};
use crate::{
    Analysis, AnalysisResult, Decision, Diagnostic, Error, Evidence, ModelVersion, Output, ProbabilityStatus,
};

pub(crate) const SCORING_FAILED: &str = "Scoring failed. Check that the reference bank and detector files are valid.";
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

fn evidence(label: &str, reason: String, method: &str) -> Evidence {
    Evidence { insufficient: true, label: label.into(), reason, threshold: None, method: method.into() }
}

/// Scores saved replies like `fpd --input`: extra numbers are cut in relaxed mode, short replies count as missing.
pub(crate) fn analyze_outputs(outputs: &[Output], data: &ReferenceData, strict: bool) -> Result<Analysis, Error> {
    if outputs.is_empty()
        || outputs.len() > 3
        || outputs.iter().any(|o| o.expected_count == 0 || o.expected_count > MAX_SAFE_INTEGER)
    {
        return Err(Error::new(
            "Each input round must contain one to three outputs with text and a positive integer expected_count.",
        ));
    }
    let prepared: Vec<(String, u64)> = outputs
        .iter()
        .map(|output| {
            let numbers = parse_numbers(&output.text);
            let expected = output.expected_count;
            let text = if (numbers.len() as u64) < minimum_numbers(expected) {
                String::new()
            } else if !strict && numbers.len() as u64 > expected {
                join(&numbers[..expected as usize])
            } else {
                output.text.clone()
            };
            (text, expected)
        })
        .collect();
    let prepared: Vec<(&str, u64)> = prepared.iter().map(|(text, expected)| (text.as_str(), *expected)).collect();
    score(&prepared, data, strict)
}

pub(crate) fn join(numbers: &[u32]) -> String {
    numbers.iter().map(u32::to_string).collect::<Vec<_>>().join(", ")
}

/// Scores `(text, expected_count)` replies as they are. Fails only when the ranking is not finite.
pub(crate) fn score(outputs: &[(&str, u64)], data: &ReferenceData, strict: bool) -> Result<Analysis, Error> {
    let parsed: Vec<Vec<u32>> = outputs.iter().map(|(text, _)| parse_numbers(text)).collect();
    let diagnostics: Vec<Diagnostic> = outputs
        .iter()
        .zip(&parsed)
        .enumerate()
        .map(|(index, ((text, expected), numbers))| {
            let minimum = minimum_numbers(*expected);
            Diagnostic {
                index,
                parsed_numbers: numbers.len(),
                minimum_numbers: minimum,
                accepted: numbers.len() as u64 >= minimum,
                raw_out_of_range_count: raw_out_of_range_count(text),
            }
        })
        .collect();
    let accepted: Vec<Vec<u32>> =
        parsed.iter().zip(&diagnostics).filter(|(_, d)| d.accepted).map(|(n, _)| n.clone()).collect();
    let used = accepted.len();
    let sequence = (used > 0).then(|| sequence_shape(&accepted));
    let model_like = sequence.as_ref().is_some_and(|s| s.model_like);
    let mut analysis = Analysis {
        decision: Decision::Unscorable,
        prediction: String::new(),
        prediction_name: "Not scored".into(),
        family_prediction: String::new(),
        family_prediction_name: String::new(),
        results: Vec::new(),
        ranking_score: None,
        probability: None,
        probability_status: ProbabilityStatus::Unavailable,
        probability_scope: None,
        calibration: None,
        used_outputs: used,
        diagnostics,
        sequence,
        method: "shared-detector-v2".into(),
        model_version: ModelVersion { base_sha256: data.base_sha256.clone() },
        evidence: evidence(
            "Not enough valid samples",
            format!("Received {used}/3 valid samples. Three valid samples are required."),
            "complete-three-answers",
        ),
    };
    let not_model = |analysis: &mut Analysis| {
        analysis.decision = Decision::NotModel;
        analysis.prediction_name = "Not a model reply".into();
        analysis.evidence = evidence(
            "Not like a language model reply",
            "Consecutive numbers change differently from the language-model replies in the reference bank. Program-generated, sorted or shuffled numbers often do this. No ranking was produced.".into(),
            "sequence-shape",
        );
    };
    let partial = !strict && used > 0 && used < 3 && outputs.len() <= 3;
    if !partial && (outputs.len() != 3 || used != 3) {
        return Ok(analysis);
    }
    if !model_like {
        not_model(&mut analysis);
        return Ok(analysis);
    }
    let ranking = data.ranker.rank(if partial { &accepted } else { &parsed }).ok_or_else(|| Error::new(SCORING_FAILED))?;
    let calibration = if partial { None } else { data.calibration.as_ref() };
    let probabilities = calibration.map(|(_, tau)| calibrate(&ranking, *tau));
    // Stable: ties keep bank order.
    let mut order: Vec<usize> = (0..ranking.len()).collect();
    order.sort_by(|&i, &j| ranking[j].total_cmp(&ranking[i]));
    analysis.results = order
        .iter()
        .map(|&i| {
            let model = &data.models[i];
            AnalysisResult {
                model: model.id.clone(),
                display_name: model.display_name.clone(),
                family: model.family.clone(),
                family_name: model.family_name.clone(),
                score: ranking[i],
                probability: probabilities.as_ref().map(|p| p[i]),
            }
        })
        .collect();
    let first = &data.models[order[0]];
    analysis.prediction = first.id.clone();
    analysis.prediction_name = first.display_name.clone();
    analysis.family_prediction = first.family.clone();
    analysis.family_prediction_name = first.family_name.clone();
    analysis.ranking_score = Some(ranking[order[0]]);
    if partial {
        analysis.decision = Decision::Partial;
        analysis.method = "shared-ranker-partial-v1".into();
        let plural = if used == 1 { "" } else { "s" };
        analysis.evidence = evidence(
            "Partial sample ranking",
            format!("Ranked {used} valid sample{plural}. Confidence requires three valid samples."),
            "partial-sample-ranking",
        );
        return Ok(analysis);
    }
    analysis.decision = Decision::Scored;
    analysis.probability = analysis.results[0].probability;
    analysis.evidence = match calibration {
        Some((output, _)) => {
            analysis.probability_status = ProbabilityStatus::ReferenceCalibrated;
            analysis.probability_scope = Some("reference-closed-set".into());
            analysis.calibration = Some(output.clone());
            evidence(
                "Calibrated ranking",
                "Confidence is a closed-set probability within the reference bank.".into(),
                "reference-calibrated-ranking",
            )
        }
        None => evidence(
            "Uncalibrated ranking",
            "The confidence calibration does not match this detector. Confidence is unavailable.".into(),
            "uncalibrated-ranking",
        ),
    };
    Ok(analysis)
}
