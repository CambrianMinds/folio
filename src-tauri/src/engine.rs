use crate::config::Config;
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

pub struct Rendered {
    pub pdf: Vec<u8>,
    pub typst: String,
    pub assets: Vec<(String, Vec<u8>)>,
    pub warnings: Vec<String>,
}
pub fn binaries() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/bin")
}
fn q(s: &str) -> String {
    serde_json::to_string(s).unwrap()
}
pub(crate) fn run(
    exe: &Path,
    args: &[&str],
    input: Option<&[u8]>,
    cwd: &Path,
    generation: &Arc<AtomicU64>,
    id: u64,
) -> Result<Vec<u8>, String> {
    run_with_diagnostics(exe, args, input, cwd, generation, id).map(|(output, _)| output)
}
fn run_with_diagnostics(
    exe: &Path,
    args: &[&str],
    input: Option<&[u8]>,
    cwd: &Path,
    generation: &Arc<AtomicU64>,
    id: u64,
) -> Result<(Vec<u8>, String), String> {
    if generation.load(Ordering::SeqCst) != id {
        return Err("Render superseded".into());
    }
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Cannot start {}: {e}. Re-run the bundled-binary preparation script.",
            exe.display()
        )
    })?;
    let mut stdin = child.stdin.take().unwrap();
    let data = input.unwrap_or_default().to_vec();
    let writer = thread::spawn(move || stdin.write_all(&data));
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out = thread::spawn(move || {
        use std::io::Read;
        let mut b = Vec::new();
        stdout.read_to_end(&mut b).map(|_| b)
    });
    let err = thread::spawn(move || {
        use std::io::Read;
        let mut b = Vec::new();
        stderr.read_to_end(&mut b).map(|_| b)
    });
    let start = Instant::now();
    let status = loop {
        if generation.load(Ordering::SeqCst) != id || start.elapsed() > Duration::from_secs(90) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = writer.join();
            let _ = out.join();
            let _ = err.join();
            return Err(if generation.load(Ordering::SeqCst) != id {
                "Render superseded"
            } else {
                "Typesetting exceeded 90 seconds. Try a smaller document."
            }
            .into());
        }
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        thread::sleep(Duration::from_millis(20));
    };
    let _ = writer.join();
    let output = out
        .join()
        .map_err(|_| "Converter output thread failed")?
        .map_err(|e| e.to_string())?;
    let error = err
        .join()
        .map_err(|_| "Converter error thread failed")?
        .map_err(|e| e.to_string())?;
    if !status.success() {
        if let Some(message) = String::from_utf8_lossy(&error)
            .lines()
            .find_map(|line| line.strip_prefix("error: panicked with: "))
            .and_then(|quoted| serde_json::from_str::<String>(quoted).ok())
        {
            return Err(message);
        }
        return Err(format!(
            "{}: {}",
            exe.file_stem().unwrap_or_default().to_string_lossy(),
            String::from_utf8_lossy(&error)
        ));
    }
    // Typst reports overfull boxes as warnings; do not silently publish clipped content.
    if String::from_utf8_lossy(&error).contains("does not fit") {
        return Err(format!("Content is too wide for this layout. Reduce columns or simplify the table/code block.\n{}",String::from_utf8_lossy(&error)));
    }
    Ok((output, String::from_utf8_lossy(&error).into_owned()))
}
fn meta_text(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        return s.into();
    }
    if let Some(a) = v.as_array() {
        return a.iter().map(meta_text).collect::<Vec<_>>().join("");
    }
    match v.get("t").and_then(Value::as_str) {
        Some("Space" | "SoftBreak" | "LineBreak") => " ".into(),
        Some(
            "Str" | "MetaString" | "MetaInlines" | "MetaBlocks" | "MetaList" | "Plain" | "Para",
        ) => meta_text(&v["c"]),
        _ => String::new(),
    }
}
fn sanitize(
    v: &mut Value,
    base: Option<&Path>,
    job: &Path,
    assets: &mut Vec<(String, Vec<u8>)>,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    if let Some(t) = v.get("t").and_then(Value::as_str).map(str::to_owned) {
        if t == "RawBlock" || t == "RawInline" {
            let raw = v["c"][1].as_str().unwrap_or("").trim();
            let directive = match raw {
                "<!-- folio:pagebreak -->" => Some("#pagebreak()"),
                "<!-- folio:columnbreak -->" => Some("#colbreak()"),
                "<!-- folio:toc -->" => Some("#outline()"),
                _ => None,
            };
            if let Some(code) = directive {
                *v = json!({"t":t,"c":["typst",code]});
            } else {
                if !raw.starts_with("<!--") {
                    warnings.push(
                        "Raw HTML, LaTeX and Typst are omitted. Use Markdown and Folio directives."
                            .into(),
                    );
                }
                *v = if t == "RawBlock" {
                    json!({"t":"Para","c":[]})
                } else {
                    json!({"t":"Str","c":""})
                };
            }
            return Ok(());
        }
        if t == "Image" {
            let target = v["c"][2][0].as_str().ok_or("Invalid image path")?;
            let decoded =
                urlencoding::decode(target).map_err(|_| "Image path has invalid URL escaping")?;
            if decoded.contains("://") || decoded.starts_with("data:") || decoded.starts_with("//")
            {
                return Err(
                    "Remote images are disabled. Save the image beside your Markdown file.".into(),
                );
            }
            let base = base.ok_or("Save the document before using relative images.")?;
            let path = base
                .join(decoded.as_ref())
                .canonicalize()
                .map_err(|_| format!("Image not found: {decoded}"))?;
            let root = base.canonicalize().map_err(|e| e.to_string())?;
            if !path.starts_with(&root) {
                return Err("Images must be inside the document folder or its subfolders.".into());
            }
            if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 50_000_000 {
                return Err("Image exceeds the 50 MB limit.".into());
            }
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !["png", "jpg", "jpeg", "gif", "svg", "webp"].contains(&ext.as_str()) {
                return Err(format!("Unsupported image type: {ext}"));
            }
            let name = format!("asset-{}.{}", assets.len(), ext);
            let data = fs::read(&path).map_err(|e| e.to_string())?;
            fs::write(job.join(&name), &data).map_err(|e| e.to_string())?;
            assets.push((name.clone(), data));
            v["c"][2][0] = name.into();
        }
    }
    match v {
        Value::Array(a) => {
            for x in a {
                sanitize(x, base, job, assets, warnings)?;
            }
        }
        Value::Object(m) => {
            for (_, x) in m {
                sanitize(x, base, job, assets, warnings)?;
            }
        }
        _ => {}
    }
    Ok(())
}
pub fn render(
    source: &str,
    path: Option<&Path>,
    config: &Config,
    bin: &Path,
    generation: Arc<AtomicU64>,
    id: u64,
) -> Result<Rendered, String> {
    config.validate()?;
    if source.len() > 10_000_000 {
        return Err("Document exceeds the 10 MB source limit.".into());
    }
    if let Some((index, character)) = source
        .char_indices()
        .find(|(_, ch)| ch.is_control() && !['\n', '\r', '\t'].contains(ch))
    {
        let line = source[..index]
            .bytes()
            .filter(|byte| *byte == b'\n')
            .count()
            + 1;
        return Err(format!(
            "Unsupported control character U+{:04X} on line {line}. Remove it before publishing.",
            character as u32
        ));
    }
    let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let job = tmp.path();
    let json_bytes = run(
        &bin.join("pandoc.exe"),
        &[
            "--from=markdown+raw_attribute+tex_math_dollars+tex_math_single_backslash",
            "--to=json",
        ],
        Some(source.as_bytes()),
        job,
        &generation,
        id,
    )?;
    let mut ast: Value = serde_json::from_slice(&json_bytes).map_err(|e| e.to_string())?;
    let title = if config.title.is_empty() {
        meta_text(&ast["meta"]["title"])
    } else {
        config.title.clone()
    };
    let author = if config.author.is_empty() {
        meta_text(&ast["meta"]["author"])
    } else {
        config.author.clone()
    };
    let mut assets = Vec::new();
    let mut warnings = Vec::new();
    sanitize(
        &mut ast,
        path.and_then(Path::parent),
        job,
        &mut assets,
        &mut warnings,
    )?;
    // Metadata cannot supply includes, templates, raw Typst, or package imports.
    ast["meta"] = json!({});
    let (body, diagnostics) = run_with_diagnostics(
        &bin.join("pandoc.exe"),
        &["--from=json", "--to=typst", "--wrap=none"],
        Some(&serde_json::to_vec(&ast).unwrap()),
        job,
        &generation,
        id,
    )?;
    if diagnostics.contains("Could not convert TeX math") {
        warnings.push("Some mathematical notation could not be converted and is shown as literal TeX. Check the equations in the PDF.".into());
    }
    let typst = template(
        config,
        &title,
        &author,
        &String::from_utf8(body).map_err(|e| e.to_string())?,
    );
    fs::write(job.join("document.typ"), &typst).map_err(|e| e.to_string())?;
    run(
        &bin.join("typst.exe"),
        &["compile", "--root", ".", "document.typ", "document.pdf"],
        None,
        job,
        &generation,
        id,
    )?;
    let pdf =
        fs::read(job.join("document.pdf")).map_err(|e| format!("Compiler produced no PDF: {e}"))?;
    if !pdf.starts_with(b"%PDF-") {
        return Err("Compiler did not produce a valid PDF.".into());
    }
    warnings.sort();
    warnings.dedup();
    Ok(Rendered {
        pdf,
        typst,
        assets,
        warnings,
    })
}
pub fn template(c: &Config, title: &str, author: &str, body: &str) -> String {
    let (w, h) = c.dimensions();
    let mut t = format!(
        "#let c = json(bytes({}))\n",
        q(&serde_json::to_string(c).unwrap())
    );
    t.push_str(&format!(
        "#set document(title: {}, author: {})\n",
        q(title),
        q(author)
    ));
    t.push_str(&format!("#let pw = {w}pt\n#let ph = {h}pt\n"));
    t.push_str(include_str!("../resources/layout.typ"));
    if !title.is_empty() {
        let title=format!("#block(width: 100%, below: 16pt)[#text(font: (c.headingFont, \"Libertinus Serif\"), size: c.fontSize * 2.2pt, fill: rgb(c.headingColor), weight: \"bold\", {})\n{}]\n",q(title),if author.is_empty(){String::new()}else{format!("#parbreak()#v(4pt)#text(size: c.fontSize * 0.9pt, {})",q(author))});
        if c.full_width_title && c.columns > 1 {
            t.push_str(&format!("#place(top, scope: \"parent\", float: true, clearance: 16pt)[{title}#metadata(\"title-end\") <folio-title-end>]\n"));
        } else {
            t.push_str(&title);
        }
    }
    if c.toc {
        t.push_str("#outline()\n");
    }
    t.push_str(body);
    t
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn markdown_separator_compiles_through_the_publishing_pipeline() {
        let rendered = render(
            "# Separator specimen\n\nParagraph before the rule.\n\n---\n\nParagraph after the rule.\n",
            None,
            &Config::default(),
            &binaries(),
            Arc::new(AtomicU64::new(1)),
            1,
        )
        .unwrap_or_else(|error| panic!("Markdown separator failed to compile: {error}"));
        assert!(rendered.pdf.starts_with(b"%PDF-"));
        assert!(rendered.typst.contains("#divider()"));
    }
    #[test]
    fn obsolete_job_starts_no_converter() {
        let result = render(
            "# Test",
            None,
            &Config::default(),
            Path::new("missing-tools"),
            Arc::new(AtomicU64::new(2)),
            1,
        );
        assert!(matches!(result,Err(e) if e=="Render superseded"));
    }
    #[test]
    fn typst_settings_are_quoted_as_data() {
        let generated = template(
            &Config::default(),
            "A \"quoted\" #read(\"secret\") title",
            "A\\B",
            "",
        );
        assert!(generated.contains(r#"title: "A \"quoted\" #read(\"secret\") title""#));
        assert!(generated.contains(r#"author: "A\\B""#));
    }
}
