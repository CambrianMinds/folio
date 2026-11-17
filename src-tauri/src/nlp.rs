use crate::{config::Config, engine};
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    sync::{atomic::AtomicU64, Arc},
};
/// Models classify qualitative styles. Measurements remain deterministic.
pub fn interpret(
    executable: &Path,
    model: &Path,
    request: &str,
    config: &Config,
    _fonts: &[String],
    generation: Arc<AtomicU64>,
    id: u64,
) -> Result<Value, String> {
    if request.trim().is_empty() || request.len() > 4000 {
        return Err("Describe a change in 1–2000 characters.".into());
    }
    guard_style_request(request)?;
    let purpose = request.to_lowercase();
    let signals = [
        (
            "Manuscript",
            ["draft", "editor", "reviewer", "markup", "submission"].as_slice(),
        ),
        (
            "Essay",
            [
                "literary",
                "nonfiction",
                "autobiograph",
                "narrative",
                "reflection",
                "essay",
                "prose",
            ]
            .as_slice(),
        ),
        (
            "Journal",
            [
                "scientific",
                "academic",
                "research",
                "scholarly",
                "periodical",
                "journal",
            ]
            .as_slice(),
        ),
        (
            "Reference",
            [
                "technical",
                "technician",
                "reference",
                "lookup",
                "handbook",
                "cheatsheet",
                "cheat sheet",
                "consultation",
                "desk guide",
                "workbench",
                "notes",
            ]
            .as_slice(),
        ),
    ];
    let permitted: Vec<&str> = signals
        .iter()
        .filter(|(_, words)| words.iter().any(|word| purpose.contains(word)))
        .map(|(style, _)| *style)
        .collect();
    if permitted.len() != 1 {
        return Ok(
            json!({"style":null,"clarification":"What is the publishing purpose: an editorial draft, literary prose, an academic article, or a practical reference guide?"}),
        );
    }
    if model
        .extension()
        .and_then(|e| e.to_str())
        .is_none_or(|e| !e.eq_ignore_ascii_case("gguf"))
    {
        return Err("Choose a local .gguf model.".into());
    }
    let model = model
        .canonicalize()
        .map_err(|e| format!("Local model could not be opened: {e}"))?;
    if fs::metadata(&model).map_err(|e| e.to_string())?.len() > 8_000_000_000 {
        return Err("Choose a CPU model under 8 GB.".into());
    }
    config.validate()?;
    let schema = json!({"oneOf":[{"type":"object","properties":{"decision":{"enum":["Manuscript","Essay","Journal","Reference"]},"question":{"const":""}},"required":["decision","question"],"additionalProperties":false},{"type":"object","properties":{"decision":{"const":null},"question":{"type":"string","minLength":1,"maxLength":120}},"required":["decision","question"],"additionalProperties":false}]});
    let system="Classify the requested publishing style. Output decision first, then question. Manuscript = draft for an editor or reviewer, with room for editorial markup. Essay = readable literary prose, personal reflection, narrative or nonfiction. Journal = scientific or academic research publication. Reference = dense practical lookup guide, cheatsheet, technical handbook or reference notes. For a clear match set decision to its exact style name and question to an empty string. Do not ask a question when the purpose matches a style. Only for vague, contradictory, unrelated or unspecified requests set decision to null and ask one concise question. 'Make it nice', 'improve this', and unspecified 'better' are vague. Never calculate individual settings.";
    let prompt=format!("<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{request}<|im_end|>\n<|im_start|>assistant\n");
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let prompt_path = temp.path().join("request.txt");
    fs::write(&prompt_path, prompt).map_err(|e| e.to_string())?;
    let model = model.to_string_lossy();
    let prompt_path = prompt_path.to_string_lossy();
    let schema = schema.to_string();
    let output = engine::run(
        executable,
        &[
            "-m",
            &model,
            "-f",
            &prompt_path,
            "--json-schema",
            &schema,
            "-n",
            "120",
            "-c",
            "2048",
            "--temp",
            "0",
            "-ngl",
            "0",
            "-t",
            "4",
            "--no-display-prompt",
            "--no-warmup",
        ],
        None,
        executable.parent().unwrap(),
        &generation,
        id,
    )?;
    let response = String::from_utf8(output).map_err(|e| e.to_string())?;
    let start = response
        .find('{')
        .ok_or("The style could not be resolved. Name a preset or specify the settings.")?;
    let end = response
        .rfind('}')
        .ok_or("Incomplete style response. Name a preset or specify the settings.")?;
    let result: Value = serde_json::from_str(&response[start..=end])
        .map_err(|e| format!("Invalid style response: {e}"))?;
    let style = result.get("decision").ok_or("Missing style selection")?;
    if !style.is_null()
        && !style
            .as_str()
            .is_some_and(|s| ["Manuscript", "Essay", "Journal", "Reference"].contains(&s))
    {
        return Err("Unsupported style selection.".into());
    }
    let clarification = result["question"]
        .as_str()
        .ok_or("Missing clarification field")?;
    if clarification.len() > 1000 {
        return Err("The model did not provide a concise interpretation.".into());
    }
    if !style.is_null() && style.as_str() != Some(permitted[0]) {
        return Ok(
            json!({"style":null,"clarification":"The style could not be resolved consistently. Choose Manuscript, Essay, Journal, or Reference explicitly."}),
        );
    }
    Ok(json!({"style":style,"clarification":clarification}))
}
fn guard_style_request(request: &str) -> Result<(), String> {
    let lower = request.to_lowercase();
    let individual = [
        "margin",
        "column",
        "gutter",
        "font",
        "point",
        "inch",
        "millimet",
        "heading",
        "rule",
        "separator",
        "spacing",
        "typeface",
        "color",
        "colour",
        "size",
        "portrait",
        "landscape",
    ];
    if request.chars().any(|ch| ch.is_ascii_digit())
        || individual.iter().any(|word| lower.contains(word))
    {
        return Err("This request contains individual settings that the command parser could not fully resolve. Specify them explicitly, such as 'left margin 15 mm' or 'Georgia 11 point'. The model will not guess measurements or silently drop a clause.".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_unverified_measurements() {
        for text in [
            "use half an inch margins",
            "body size 12",
            "pick a font",
            "a thinner separator",
        ] {
            assert!(guard_style_request(text).is_err());
        }
    }
    #[test]
    fn allows_broad_editorial_styles() {
        assert!(guard_style_request("A practical lookup handbook for a technician").is_ok());
    }
}
