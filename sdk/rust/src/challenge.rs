//! Challenge prompts (`shared/challenge-browser.js`), from the embedded `templates.json`.

use std::sync::LazyLock;

use serde::Deserialize;

use crate::{Challenge, Error};

#[derive(Deserialize)]
struct Language {
    space: String,
    openings: Vec<String>,
    actions: Vec<String>,
    request: String,
    rules: String,
    endings: Vec<String>,
    separators: Vec<String>,
    start: String,
}

#[derive(Deserialize)]
struct Templates {
    languages: Vec<Language>,
}

static TEMPLATES: LazyLock<Vec<Language>> = LazyLock::new(|| {
    serde_json::from_str::<Templates>(include_str!("templates.json")).expect("templates.json is valid").languages
});

/// A uniform index below `length` from the OS CSPRNG, with the reference's rejection rule.
fn random_index(length: usize) -> Result<usize, Error> {
    let length = length as u64;
    let limit = (1u64 << 32) / length * length;
    loop {
        let value = u64::from(getrandom::u32().map_err(|e| Error::new(format!("Random source failed: {e}")))?);
        if value < limit {
            return Ok((value % length) as usize);
        }
    }
}

fn choose<T>(values: &[T]) -> Result<&T, Error> {
    Ok(&values[random_index(values.len())?])
}

/// Random challenges in one of five languages, each asking for a distinct count from 292 to 332.
pub fn generate_challenges(count: usize) -> Result<Vec<Challenge>, Error> {
    if !(1..=3).contains(&count) {
        return Err(Error::new("count must be an integer from 1 to 3."));
    }
    let mut available: Vec<u64> = (292..=332).collect();
    let mut lengths = Vec::with_capacity(count);
    while lengths.len() < count {
        lengths.push(available.remove(random_index(available.len())?));
    }
    lengths
        .into_iter()
        .enumerate()
        .map(|(index, length)| {
            let language = choose(&TEMPLATES)?;
            let request = language
                .request
                .replacen("{action}", choose(&language.actions)?, 1)
                .replacen("{count}", &length.to_string(), 1);
            let prompt = [
                choose(&language.openings)?.as_str(),
                &request,
                &language.rules,
                choose(&language.endings)?,
                choose(&language.separators)?,
                &language.start,
            ]
            .join(&language.space);
            Ok(Challenge { id: format!("probe-{}-{}", index + 1, uuid::Uuid::new_v4()), expected_count: length, prompt })
        })
        .collect()
}
