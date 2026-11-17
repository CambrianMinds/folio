use folio::{config::Config, engine};
use std::{
    fs,
    path::PathBuf,
    sync::{atomic::AtomicU64, Arc},
};
fn main() {
    if let Err(e) = execute() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
fn execute() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|s| s == "--interpret") {
        if args.len() < 4 {
            return Err("Usage: folio-render --interpret model.gguf request".into());
        }
        let patch = folio::nlp::interpret(
            &engine::binaries().join("cpu/llama-completion.exe"),
            std::path::Path::new(&args[2]),
            &args[3],
            &Config::default(),
            &[
                "Georgia".into(),
                "Arial".into(),
                "Times New Roman".into(),
                "Segoe UI".into(),
            ],
            Arc::new(AtomicU64::new(1)),
            1,
        )?;
        println!("{}", patch);
        return Ok(());
    }
    if args.len() < 3 {
        return Err("Usage: folio-render input.md output.pdf [layout.json]".into());
    }
    let source = PathBuf::from(&args[1])
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let config = if let Some(p) = args.get(3) {
        Config::from_json(&fs::read_to_string(p).map_err(|e| e.to_string())?)?
    } else {
        Config::default()
    };
    let rendered = engine::render(
        &fs::read_to_string(&source).map_err(|e| e.to_string())?,
        Some(&source),
        &config,
        &engine::binaries(),
        Arc::new(AtomicU64::new(1)),
        1,
    )?;
    fs::write(&args[2], &rendered.pdf).map_err(|e| e.to_string())?;
    fs::write(
        PathBuf::from(&args[2]).with_extension("typ"),
        &rendered.typst,
    )
    .map_err(|e| e.to_string())?;
    for w in rendered.warnings {
        eprintln!("Warning: {w}");
    }
    Ok(())
}
