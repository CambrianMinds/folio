use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

pub struct Source {
    pub id: String,
    pub name: String,
    pub original: Option<PathBuf>,
    pub fingerprint: String,
    pub file: tempfile::NamedTempFile,
    pub count: usize,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub source_id: String,
    pub page_index: usize,
    pub rotation: u16,
}

// Jobs use files instead of command-line page lists, avoiding Windows' command length limit.
// stdout/stderr also use temporary files so verbose damaged PDFs cannot fill a pipe.
pub fn job(exe: &Path, value: Value, cancel: &AtomicBool) -> Result<Vec<u8>, String> {
    if cancel.load(Ordering::SeqCst) {
        return Err("Operation cancelled.".into());
    }
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let input = dir.path().join("job.json");
    fs::write(&input, serde_json::to_vec(&value).unwrap()).map_err(|e| e.to_string())?;
    let out = dir.path().join("stdout");
    let err = dir.path().join("stderr");
    let mut command = Command::new(exe);
    command
        .arg(format!("--job-json-file={}", input.display()))
        .stdin(Stdio::null())
        .stdout(fs::File::create(&out).map_err(|e| e.to_string())?)
        .stderr(fs::File::create(&err).map_err(|e| e.to_string())?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Cannot start bundled qpdf. {e}"))?;
    let start = Instant::now();
    let status = loop {
        if cancel.load(Ordering::SeqCst) || start.elapsed() > Duration::from_secs(600) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Operation cancelled or timed out. No output was committed.".into());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        thread::sleep(Duration::from_millis(25));
    };
    // Warnings are treated as actionable failures, including recovered/corrupt input.
    if !status.success() {
        let message = fs::read_to_string(err).unwrap_or_default();
        if message.to_lowercase().contains("password") {
            return Err("PASSWORD_REQUIRED".into());
        }
        return Err(format!(
            "PDF processing failed. {}",
            message.chars().take(1800).collect::<String>()
        ));
    }
    fs::read(out).map_err(|e| e.to_string())
}
pub fn count(exe: &Path, path: &Path, cancel: &AtomicBool) -> Result<usize, String> {
    let bytes = job(exe, json!({"inputFile":path,"showNpages":""}), cancel)?;
    String::from_utf8_lossy(&bytes)
        .trim()
        .parse()
        .map_err(|_| "Cannot read PDF page count.".into())
}
pub fn import(
    exe: &Path,
    path: &Path,
    password: Option<String>,
    cancel: &AtomicBool,
) -> Result<Source, String> {
    let original = path
        .canonicalize()
        .map_err(|e| format!("Cannot open {}. {e}", path.display()))?;
    let bytes = fs::read(&original).map_err(|e| e.to_string())?;
    // An immutable input snapshot ensures the preview and export use identical bytes.
    let snapshot = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
    fs::write(snapshot.path(), &bytes).map_err(|e| e.to_string())?;
    let mut inspect = json!({"inputFile":snapshot.path(),"json":"2","jsonKey":["encrypt"]});
    if let Some(p) = &password {
        inspect["password"] = json!(p);
    }
    let encryption: Value =
        serde_json::from_slice(&job(exe, inspect, cancel)?).map_err(|e| e.to_string())?;
    if encryption["encrypt"]["encrypted"] == true
        && encryption["encrypt"]["ownerpasswordmatched"] != true
        && (encryption["encrypt"]["capabilities"]["modifyassembly"] != true
            || encryption["encrypt"]["capabilities"]["extract"] != true)
    {
        return Err("This PDF restricts page assembly or extraction. Ask its owner for an unrestricted copy or owner password.".into());
    }
    let file = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
    let mut normalize = json!({"inputFile":snapshot.path(),"outputFile":file.path(),"decrypt":""});
    if let Some(p) = password {
        normalize["password"] = json!(p);
    }
    job(exe, normalize, cancel)?;
    job(exe, json!({"inputFile":file.path(),"check":""}), cancel)?;
    let count = count(exe, file.path(), cancel)?;
    if count == 0 {
        return Err("The PDF contains no pages.".into());
    }
    Ok(Source {
        id: file.path().to_string_lossy().into(),
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        original: Some(original),
        fingerprint: crate::storage::fingerprint(&bytes),
        file,
        count,
    })
}
pub fn validate_sources(sources: &[Arc<Source>]) -> Result<(), String> {
    for source in sources {
        if let Some(path) = &source.original {
            let bytes = fs::read(path).map_err(|_| {
                format!(
                    "Restore the source file {} before exporting.",
                    path.display()
                )
            })?;
            if crate::storage::fingerprint(&bytes) != source.fingerprint {
                return Err(format!("{} changed after import. Restore the original file or import its updated version.", source.name));
            }
        }
    }
    Ok(())
}
pub fn export(
    exe: &Path,
    sources: &[Arc<Source>],
    pages: &[Page],
    target: &Path,
    cancel: &AtomicBool,
) -> Result<(), String> {
    if pages.is_empty() {
        return Err("Select at least one page.".into());
    }
    let mut sequence = Vec::new();
    let mut rotations = Vec::new();
    for (index, page) in pages.iter().enumerate() {
        let source = sources
            .iter()
            .find(|s| s.id == page.source_id)
            .ok_or("A source document is unavailable.")?;
        if page.page_index >= source.count || ![0, 90, 180, 270].contains(&page.rotation) {
            return Err("Invalid page reference or rotation.".into());
        }
        sequence.push(json!({"file":source.file.path(),"range":(page.page_index+1).to_string()}));
        if page.rotation != 0 {
            rotations.push(format!("+{}:{}", page.rotation, index + 1));
        }
    }
    validate_sources(sources)?;
    job(
        exe,
        json!({"empty":"","outputFile":target,"pages":sequence,"rotate":rotations}),
        cancel,
    )?;
    job(exe, json!({"inputFile":target,"check":""}), cancel)?;
    if count(exe, target, cancel)? != pages.len() {
        return Err("Exported page count does not match the document.".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    fn fixture(path: &Path, label: &str, sizes: &[(u32, u32)]) {
        let mut objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            String::new(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),
        ];
        let mut kids = Vec::new();
        for (i, (w, h)) in sizes.iter().enumerate() {
            let page = objects.len() + 1;
            kids.push(format!("{page} 0 R"));
            objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",page+1));
            let content = format!(
                "BT /F1 24 Tf 40 60 Td ({label}{}) Tj ET\n20 20 80 30 re S\n",
                i + 1
            );
            objects.push(format!(
                "<< /Length {} >>\nstream\n{}endstream",
                content.len(),
                content
            ));
        }
        objects[1] = format!(
            "<< /Type /Pages /Kids [{}] /Count {} >>",
            kids.join(" "),
            sizes.len()
        );
        let mut pdf = b"%PDF-1.7\n".to_vec();
        let mut offsets = vec![0];
        for (i, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, object).as_bytes());
        }
        let xref = pdf.len();
        pdf.extend_from_slice(
            format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len()).as_bytes(),
        );
        for offset in offsets.iter().skip(1) {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                offsets.len()
            )
            .as_bytes(),
        );
        fs::write(path, pdf).unwrap();
    }
    fn inspect(exe: &Path, file: &Path) -> Value {
        serde_json::from_slice(
            &job(
                exe,
                json!({"inputFile":file,"json":"2","jsonStreamData":"inline","decodeLevel":"all"}),
                &AtomicBool::new(false),
            )
            .unwrap(),
        )
        .unwrap()
    }
    fn contents(pdf: &Value) -> Vec<String> {
        let objects = &pdf["qpdf"][1];
        pdf["pages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                p["contents"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|reference| {
                        let key = format!("obj:{}", reference.as_str().unwrap());
                        let data = objects[&key]["stream"]["data"].as_str().unwrap();
                        String::from_utf8(STANDARD.decode(data).unwrap()).unwrap()
                    })
                    .collect::<Vec<_>>()
                    .join("")
            })
            .collect()
    }
    #[test]
    fn engine_merge_insert_reorder_duplicate_rotate_extract_split_and_preserve_vectors() {
        let exe = crate::engine::binaries().join("qpdf/qpdf.exe");
        assert!(
            exe.exists(),
            "Run npm run prepare:binaries before testing the bundled qpdf engine."
        );
        let dir = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        let a = dir.path().join("Report with spaces.pdf");
        let b = dir.path().join("Appendix \u{03bb}.pdf");
        fixture(&a, "A", &[(612, 792), (595, 842), (792, 612)]);
        fixture(&b, "B", &[(420, 595), (595, 420)]);
        let before = fs::read(&a).unwrap();
        let sources = vec![
            Arc::new(import(&exe, &a, None, &cancel).unwrap()),
            Arc::new(import(&exe, &b, None, &cancel).unwrap()),
        ];
        let page = |s: usize, i, rotation| Page {
            source_id: sources[s].id.clone(),
            page_index: i,
            rotation,
        };
        let output = dir.path().join("result.pdf");
        let merged = vec![
            page(0, 0, 0),
            page(0, 1, 0),
            page(0, 2, 0),
            page(1, 0, 0),
            page(1, 1, 0),
        ];
        export(&exe, &sources, &merged, &output, &cancel).unwrap();
        assert_eq!(count(&exe, &output, &cancel).unwrap(), 5);
        let pages = vec![
            page(0, 2, 90),
            page(1, 0, 180),
            page(0, 0, 270),
            page(1, 1, 0),
            page(0, 0, 0),
        ];
        export(&exe, &sources, &pages, &output, &cancel).unwrap();
        let pdf = inspect(&exe, &output);
        let text = contents(&pdf);
        for (text, label) in text.iter().zip(["A3", "B1", "A1", "B2", "A1"]) {
            assert!(text.contains(label), "{text}");
            assert!(text.contains(" re S"));
        }
        for (index, angle) in [90, 180, 270, 0, 0].into_iter().enumerate() {
            let reference = pdf["pages"][index]["object"].as_str().unwrap();
            let dictionary = &pdf["qpdf"][1][format!("obj:{reference}")]["value"];
            assert_eq!(dictionary["/Rotate"].as_u64().unwrap_or(0), angle);
            let expected = match index {
                0 => json!([0, 0, 792, 612]),
                1 => json!([0, 0, 420, 595]),
                3 => json!([0, 0, 595, 420]),
                _ => json!([0, 0, 612, 792]),
            };
            assert_eq!(dictionary["/MediaBox"], expected);
            assert!(pdf["pages"][index]["images"].as_array().unwrap().is_empty());
        }
        for (i, part) in [pages[..2].to_vec(), pages[2..].to_vec()]
            .iter()
            .enumerate()
        {
            let path = dir.path().join(format!("Part-{i}.pdf"));
            export(&exe, &sources, part, &path, &cancel).unwrap();
            assert_eq!(count(&exe, &path, &cancel).unwrap(), part.len());
        }
        export(&exe, &sources, &pages[1..3], &output, &cancel).unwrap();
        assert_eq!(contents(&inspect(&exe, &output)).len(), 2);
        assert_eq!(fs::read(&a).unwrap(), before);
        fs::rename(&a, dir.path().join("moved.pdf")).unwrap();
        assert!(export(&exe, &sources, &pages, &output, &cancel)
            .unwrap_err()
            .contains("Restore"));
        fs::write(&a, b"changed").unwrap();
        assert!(export(&exe, &sources, &pages, &output, &cancel)
            .unwrap_err()
            .contains("changed"));
    }
    #[test]
    fn rejects_corruption_missing_sources_empty_invalid_and_cancelled_jobs() {
        let exe = crate::engine::binaries().join("qpdf/qpdf.exe");
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("broken.pdf");
        let cancel = AtomicBool::new(false);
        fs::write(&path, b"not a PDF").unwrap();
        assert!(import(&exe, &path, None, &cancel).is_err());
        assert!(import(&exe, &dir.path().join("missing.pdf"), None, &cancel).is_err());
        assert!(export(&exe, &[], &[], &path, &cancel).is_err());
        assert!(job(
            &exe,
            json!({"inputFile":path,"check":""}),
            &AtomicBool::new(true)
        )
        .is_err());
    }
    #[test]
    fn encrypted_inputs_require_password_and_respect_assembly_permissions() {
        let exe = crate::engine::binaries().join("qpdf/qpdf.exe");
        let dir = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        let input = dir.path().join("plain.pdf");
        fixture(&input, "A", &[(612, 792)]);
        let encrypted = dir.path().join("encrypted.pdf");
        job(&exe,json!({"inputFile":input,"outputFile":encrypted,"encrypt":{"userPassword":"reader","ownerPassword":"owner","256bit":{"assemble":"n","extract":"n"}}}),&cancel).unwrap();
        assert_eq!(
            import(&exe, &encrypted, None, &cancel).err().unwrap(),
            "PASSWORD_REQUIRED"
        );
        assert!(import(&exe, &encrypted, Some("reader".into()), &cancel)
            .err()
            .unwrap()
            .contains("restricts"));
        assert_eq!(
            import(&exe, &encrypted, Some("owner".into()), &cancel)
                .unwrap()
                .count,
            1
        );
    }
}
