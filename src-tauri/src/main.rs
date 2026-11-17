#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use base64::{engine::general_purpose::STANDARD, Engine};
use folio::{
    config::Config,
    engine::{self, Rendered},
    storage,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Manager, State};

#[derive(Default)]
struct Session {
    generation: Arc<AtomicU64>,
    fit_generation: Arc<AtomicU64>,
    nlp_generation: Arc<AtomicU64>,
    previews: Mutex<HashMap<u64, Rendered>>,
    documents: Mutex<HashMap<String, String>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    path: String,
    source: String,
    config: Config,
    warning: Option<String>,
}
fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let p = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}
fn resource_bin(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let installed = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/bin");
    if installed.join("pandoc.exe").exists() {
        Ok(installed)
    } else if cfg!(debug_assertions) {
        Ok(engine::binaries())
    } else {
        Err("Bundled publishing tools are missing. Reinstall Folio.".into())
    }
}
fn dialog_save(name: &str, extension: &str, directory: Option<&str>) -> Option<PathBuf> {
    let mut d = rfd::FileDialog::new()
        .set_file_name(name)
        .add_filter(extension, &[extension]);
    if let Some(p) = directory {
        d = d.set_directory(p);
    }
    d.save_file()
}
#[tauri::command]
async fn open_document(
    state: State<'_, Session>,
    path: Option<String>,
) -> Result<Option<Document>, String> {
    let p = tauri::async_runtime::spawn_blocking(move || {
        path.map(PathBuf::from).or_else(|| {
            rfd::FileDialog::new()
                .add_filter("Markdown", &["md", "markdown"])
                .pick_file()
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(p) = p else { return Ok(None) };
    if !p
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
    {
        return Err("Choose a .md or .markdown document.".into());
    }
    let p = p.canonicalize().map_err(|e| e.to_string())?;
    if fs::metadata(&p).map_err(|e| e.to_string())?.len() > 10_000_000 {
        return Err("Document exceeds 10 MB.".into());
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    let source = String::from_utf8(bytes.clone()).map_err(|_| "Markdown must be UTF-8 encoded.")?;
    let (config, warning) = match storage::load_layout(&p) {
        Ok(c) => (c, None),
        Err(e) => (
            Config::default(),
            Some(format!("Layout could not be loaded; using Essay. {e}")),
        ),
    };
    let path = p.to_string_lossy().to_string();
    state
        .documents
        .lock()
        .unwrap()
        .insert(path.clone(), storage::fingerprint(&bytes));
    Ok(Some(Document {
        path,
        source,
        config,
        warning,
    }))
}
#[tauri::command]
async fn save_document(
    state: State<'_, Session>,
    path: Option<String>,
    source: String,
    config: Config,
    save_as: bool,
) -> Result<Option<String>, String> {
    config.validate()?;
    let p = if save_as || path.is_none() {
        let name = path
            .as_ref()
            .and_then(|s| Path::new(s).file_name())
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or("Untitled.md".into());
        let picked = tauri::async_runtime::spawn_blocking(move || dialog_save(&name, "md", None))
            .await
            .map_err(|e| e.to_string())?;
        let Some(p) = picked else { return Ok(None) };
        p
    } else {
        let p = PathBuf::from(path.unwrap());
        let known = state
            .documents
            .lock()
            .unwrap()
            .get(&p.to_string_lossy().to_string())
            .cloned()
            .ok_or("Reopen this document before saving.")?;
        let current = fs::read(&p).map_err(|e| e.to_string())?;
        if storage::fingerprint(&current) != known {
            return Err("This file changed outside Folio. Use Save As to preserve your edits, or reload it.".into());
        }
        p
    };
    // Persist layout first; don't rewrite unmodified source during formatting-only saves.
    storage::atomic_write(
        &storage::sidecar(&p),
        &serde_json::to_vec_pretty(&config).unwrap(),
    )?;
    if fs::read(&p).ok().as_deref() != Some(source.as_bytes()) {
        storage::atomic_write(&p, source.as_bytes())?;
    }
    let name = p.to_string_lossy().to_string();
    state
        .documents
        .lock()
        .unwrap()
        .insert(name.clone(), storage::fingerprint(source.as_bytes()));
    Ok(Some(name))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Preview {
    id: u64,
    pdf: String,
    warnings: Vec<String>,
}
#[tauri::command]
fn supersede(state: State<Session>, id: u64) {
    state.generation.fetch_max(id, Ordering::SeqCst);
}
#[tauri::command]
async fn render_document(
    app: tauri::AppHandle,
    state: State<'_, Session>,
    id: u64,
    source: String,
    path: Option<String>,
    config: Config,
) -> Result<Preview, String> {
    state.generation.fetch_max(id, Ordering::SeqCst);
    let generation = state.generation.clone();
    let bin = resource_bin(&app)?;
    let output = tauri::async_runtime::spawn_blocking(move || {
        engine::render(
            &source,
            path.as_deref().map(Path::new),
            &config,
            &bin,
            generation,
            id,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    if state.generation.load(Ordering::SeqCst) != id {
        return Err("Render superseded".into());
    }
    let preview = Preview {
        id,
        pdf: STANDARD.encode(&output.pdf),
        warnings: output.warnings.clone(),
    };
    let mut previews = state.previews.lock().unwrap();
    previews.insert(id, output);
    // Retain a few successful snapshots while PDF.js swaps the visible document.
    while previews.len() > 3 {
        if let Some(old) = previews.keys().min().copied() {
            previews.remove(&old);
        }
    }
    Ok(preview)
}
#[tauri::command]
async fn export_document(
    state: State<'_, Session>,
    id: u64,
    kind: String,
    name: String,
    directory: Option<String>,
) -> Result<Option<String>, String> {
    let ext = match kind.as_str() {
        "pdf" => "pdf",
        "typst" => "typ",
        _ => return Err("Unsupported export type".into()),
    };
    let p =
        tauri::async_runtime::spawn_blocking(move || dialog_save(&name, ext, directory.as_deref()))
            .await
            .map_err(|e| e.to_string())?;
    let Some(p) = p else { return Ok(None) };
    let previews = state.previews.lock().unwrap();
    let doc = previews
        .get(&id)
        .ok_or("Refresh the preview before exporting.")?;
    if kind == "pdf" {
        storage::atomic_write(&p, &doc.pdf)?;
    } else {
        // Assets are exported in a uniquely named adjacent folder, avoiding collisions.
        let folder = format!(
            "{}-assets-{}",
            p.file_stem().unwrap_or_default().to_string_lossy(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );
        let assets = p.parent().unwrap().join(&folder);
        fs::create_dir(&assets).map_err(|e| e.to_string())?;
        let mut typst = doc.typst.clone();
        for (name, data) in &doc.assets {
            storage::atomic_write(&assets.join(name), data)?;
            typst = typst.replace(&format!("\"{name}\""), &format!("\"{folder}/{name}\""));
        }
        storage::atomic_write(&p, typst.as_bytes())?;
    }
    Ok(Some(p.to_string_lossy().into()))
}
#[tauri::command]
async fn print_document(state: State<'_, Session>, id: u64) -> Result<(), String> {
    let pdf = state
        .previews
        .lock()
        .unwrap()
        .get(&id)
        .ok_or("Render the document before printing.")?
        .pdf
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dir = std::env::temp_dir().join("Folio-print");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let p = dir.join(format!(
            "Folio-{}.pdf",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        storage::atomic_write(&p, &pdf)?;
        #[cfg(windows)]
        {
            let status = std::process::Command::new("explorer.exe")
                .arg(&p)
                .status()
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("Could not open your PDF application.".into());
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Preferences {
    recent: Vec<String>,
    presets: HashMap<String, Config>,
    layout: Value,
    export_directory: Option<String>,
    variations: HashMap<String, HashMap<String, Config>>,
    model_path: Option<String>,
    templates: HashMap<String, Value>,
}
#[tauri::command]
fn load_preferences(app: tauri::AppHandle) -> Result<Value, String> {
    let p = config_dir(&app)?.join("preferences.json");
    let prefs = if p.exists() {
        serde_json::from_slice::<Preferences>(&fs::read(p).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Invalid preferences: {e}"))?
    } else {
        Preferences::default()
    };
    serde_json::to_value(prefs).map_err(|e| e.to_string())
}
#[tauri::command]
fn save_preferences(app: tauri::AppHandle, preferences: Preferences) -> Result<(), String> {
    if preferences.presets.len() > 100 || preferences.recent.len() > 20 {
        return Err("Too many saved presets or recent files".into());
    }
    for c in preferences.presets.values() {
        c.validate()?;
    }
    if preferences.variations.len() > 100 {
        return Err("Keep variations for at most 100 documents.".into());
    }
    for collection in preferences.variations.values() {
        if collection.len() > 20 {
            return Err("Keep at most 20 variations per document.".into());
        }
        for (name, c) in collection {
            if name.len() > 160 {
                return Err("Variation name is too long.".into());
            }
            c.validate()?;
        }
    }
    if preferences.templates.len() > 100 {
        return Err("Keep at most 100 external templates.".into());
    }
    for value in preferences.templates.values() {
        validate_template(value)?;
    }
    storage::atomic_write(
        &config_dir(&app)?.join("preferences.json"),
        &serde_json::to_vec_pretty(&preferences).unwrap(),
    )
}
#[tauri::command]
async fn fonts(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let _ = app;
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut families: Vec<String> = db
            .faces()
            .flat_map(|f| f.families.iter().map(|(n, _)| n.clone()))
            .collect();
        families.sort();
        families.dedup();
        families
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
fn sample() -> Value {
    json!({"source":include_str!("../../samples/Welcome.md")})
}
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid link")?;
    if !["http", "https"].contains(&parsed.scheme()) {
        return Err("Only HTTP and HTTPS links can be opened.".into());
    }
    std::process::Command::new("explorer.exe")
        .arg(parsed.as_str())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn cancel_fit(state: State<Session>, id: u64) {
    state.fit_generation.fetch_max(id, Ordering::SeqCst);
    state.nlp_generation.fetch_max(id, Ordering::SeqCst);
}
#[tauri::command]
async fn render_fit(
    app: tauri::AppHandle,
    state: State<'_, Session>,
    id: u64,
    source: String,
    path: Option<String>,
    config: Config,
) -> Result<Preview, String> {
    state.fit_generation.fetch_max(id, Ordering::SeqCst);
    let generation = state.fit_generation.clone();
    let bin = resource_bin(&app)?;
    let output = tauri::async_runtime::spawn_blocking(move || {
        engine::render(
            &source,
            path.as_deref().map(Path::new),
            &config,
            &bin,
            generation,
            id,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    if state.fit_generation.load(Ordering::SeqCst) != id {
        return Err("Render superseded".into());
    }
    Ok(Preview {
        id,
        pdf: STANDARD.encode(&output.pdf),
        warnings: output.warnings,
    })
}
#[tauri::command]
async fn choose_model() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .add_filter("Local language model", &["gguf"])
            .pick_file()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
async fn interpret_layout(
    app: tauri::AppHandle,
    state: State<'_, Session>,
    id: u64,
    request: String,
    config: Config,
    fonts: Vec<String>,
    model_path: String,
) -> Result<Value, String> {
    state.nlp_generation.fetch_max(id, Ordering::SeqCst);
    let generation = state.nlp_generation.clone();
    let executable = resource_bin(&app)?.join("cpu/llama-completion.exe");
    tauri::async_runtime::spawn_blocking(move || {
        folio::nlp::interpret(
            &executable,
            Path::new(&model_path),
            &request,
            &config,
            &fonts,
            generation,
            id,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
fn validate_template(value: &Value) -> Result<(), String> {
    let object = value.as_object().ok_or("Template must be a JSON object.")?;
    for key in object.keys() {
        if ![
            "format",
            "version",
            "name",
            "requirements",
            "notes",
            "clarification",
            "changes",
        ]
        .contains(&key.as_str())
        {
            return Err(format!("Unknown template field: {key}"));
        }
    }
    if value["format"] != "folio.layout-template" || value["version"] != 1 {
        return Err("Unsupported template format or version.".into());
    }
    let name = value["name"]
        .as_str()
        .ok_or("Template name must be text.")?;
    if name.trim().is_empty() || name.chars().count() > 80 {
        return Err("Template name must contain 1–80 characters.".into());
    }
    for (key, max) in [
        ("requirements", 4000),
        ("notes", 2000),
        ("clarification", 1000),
    ] {
        if let Some(text) = value.get(key) {
            if text.as_str().is_none_or(|s| s.chars().count() > max) {
                return Err(format!("Invalid {key} field."));
            }
        }
    }
    let changes = value["changes"]
        .as_object()
        .ok_or("Template changes must be an object.")?;
    let mut defaults = serde_json::to_value(Config::default()).unwrap();
    for (key, new_value) in changes {
        if ["schemaVersion", "preset"].contains(&key.as_str()) || defaults.get(key).is_none() {
            return Err(format!("Unsupported layout setting: {key}"));
        }
        defaults
            .as_object_mut()
            .unwrap()
            .insert(key.clone(), new_value.clone());
    }
    let _: Config =
        serde_json::from_value(defaults).map_err(|e| format!("Invalid template setting: {e}"))?;
    Ok(())
}
#[tauri::command]
async fn copy_text(text: String) -> Result<(), String> {
    if text.len() > 200000 {
        return Err("Clipboard text is too long.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        arboard::Clipboard::new()
            .and_then(|mut c| c.set_text(text))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn read_clipboard_text() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let text = arboard::Clipboard::new()
            .and_then(|mut c| c.get_text())
            .map_err(|e| e.to_string())?;
        if text.len() > 200000 {
            return Err("Clipboard text exceeds 200 KB.".into());
        }
        Ok(text)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn import_template() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Folio JSON template", &["json"])
            .pick_file()
        else {
            return Ok(None);
        };
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 200000 {
            return Err("Template exceeds 200 KB.".into());
        }
        Ok(Some(fs::read_to_string(path).map_err(|e| e.to_string())?))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn export_template(text: String, name: String) -> Result<Option<String>, String> {
    if text.len() > 200000 {
        return Err("Template exceeds 200 KB.".into());
    }
    let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    validate_template(&value)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = dialog_save(&name, "json", None) else {
            return Ok(None);
        };
        storage::atomic_write(&path, text.as_bytes())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
mod organizer_commands;
use organizer_commands::*;

fn main() {
    tauri::Builder::default()
        .manage(Session::default())
        .manage(OrganizerSession::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_zoom(1.0)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            organizer_pick,
            organizer_import,
            organizer_compose,
            organizer_release,
            organizer_cancel,
            organizer_export,
            open_document,
            save_document,
            render_document,
            supersede,
            export_document,
            print_document,
            load_preferences,
            save_preferences,
            fonts,
            sample,
            open_link,
            render_fit,
            cancel_fit,
            choose_model,
            interpret_layout,
            copy_text,
            read_clipboard_text,
            import_template,
            export_template
        ])
        .run(tauri::generate_context!())
        .expect("Folio could not start");
}
