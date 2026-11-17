use super::*;
use folio::organizer::{self, Page, Source};
use std::sync::atomic::AtomicBool;

#[derive(Default)]
pub struct OrganizerSession {
    sources: Mutex<HashMap<String, Arc<Source>>>,
    cancel: Arc<AtomicBool>,
    busy: Arc<AtomicBool>,
}
struct Operation(Arc<AtomicBool>);
impl Drop for Operation {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl OrganizerSession {
    fn begin(&self) -> Result<Operation, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "Wait for the current PDF operation to finish.")?;
        self.cancel.store(false, Ordering::SeqCst);
        Ok(Operation(self.busy.clone()))
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    id: String,
    name: String,
    count: usize,
    pdf: String,
}
fn response(source: &Source) -> Result<Imported, String> {
    Ok(Imported {
        id: source.id.clone(),
        name: source.name.clone(),
        count: source.count,
        pdf: STANDARD.encode(fs::read(source.file.path()).map_err(|e| e.to_string())?),
    })
}
#[tauri::command]
pub async fn organizer_pick() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .add_filter("PDF documents", &["pdf"])
            .pick_files()
            .unwrap_or_default()
            .iter()
            .map(|p| p.to_string_lossy().into())
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn organizer_import(
    app: tauri::AppHandle,
    state: State<'_, OrganizerSession>,
    path: String,
    password: Option<String>,
) -> Result<Imported, String> {
    let _operation = state.begin()?;
    let exe = resource_bin(&app)?.join("qpdf/qpdf.exe");
    let cancel = state.cancel.clone();
    let source = tauri::async_runtime::spawn_blocking(move || {
        organizer::import(&exe, Path::new(&path), password, &cancel)
    })
    .await
    .map_err(|e| e.to_string())??;
    let result = response(&source)?;
    state
        .sources
        .lock()
        .unwrap()
        .insert(source.id.clone(), Arc::new(source));
    Ok(result)
}
#[tauri::command]
pub async fn organizer_compose(
    app: tauri::AppHandle,
    session: State<'_, Session>,
    state: State<'_, OrganizerSession>,
    id: u64,
    name: String,
) -> Result<Imported, String> {
    let _operation = state.begin()?;
    if session.generation.load(Ordering::SeqCst) != id {
        return Err("Wait for a successful current Compose preview.".into());
    }
    let bytes = session
        .previews
        .lock()
        .unwrap()
        .get(&id)
        .ok_or("Refresh Compose before sending.")?
        .pdf
        .clone();
    let exe = resource_bin(&app)?.join("qpdf/qpdf.exe");
    let cancel = state.cancel.clone();
    let source = tauri::async_runtime::spawn_blocking(move || {
        let file = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
        fs::write(file.path(), bytes).map_err(|e| e.to_string())?;
        let count = organizer::count(&exe, file.path(), &cancel)?;
        Ok::<_, String>(Source {
            id: file.path().to_string_lossy().into(),
            name,
            original: None,
            fingerprint: String::new(),
            file,
            count,
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    let result = response(&source)?;
    state
        .sources
        .lock()
        .unwrap()
        .insert(source.id.clone(), Arc::new(source));
    Ok(result)
}
#[tauri::command]
pub fn organizer_release(state: State<OrganizerSession>, ids: Vec<String>) {
    let mut sources = state.sources.lock().unwrap();
    for id in ids {
        sources.remove(&id);
    }
}
#[tauri::command]
pub fn organizer_cancel(state: State<OrganizerSession>) {
    state.cancel.store(true, Ordering::SeqCst);
}
#[tauri::command]
pub async fn organizer_export(
    app: tauri::AppHandle,
    state: State<'_, OrganizerSession>,
    documents: Vec<Vec<Page>>,
) -> Result<Option<String>, String> {
    let _operation = state.begin()?;
    if documents.is_empty() || documents.iter().any(Vec::is_empty) {
        return Err("Select at least one page for each output.".into());
    }
    let sources: Vec<Arc<Source>> = {
        let all = state.sources.lock().unwrap();
        let mut ids: Vec<String> = documents
            .iter()
            .flatten()
            .map(|p| p.source_id.clone())
            .collect();
        ids.sort();
        ids.dedup();
        ids.iter()
            .map(|id| {
                all.get(id)
                    .cloned()
                    .ok_or("A source is unavailable.".to_string())
            })
            .collect::<Result<_, _>>()?
    };
    let exe = resource_bin(&app)?.join("qpdf/qpdf.exe");
    let cancel = state.cancel.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let batch = documents.len() > 1;
        let target = if batch {
            rfd::FileDialog::new().pick_folder()
        } else {
            dialog_save("Organized.pdf", "pdf", None)
        };
        let Some(target) = target else {
            return Ok(None);
        };
        if !batch {
            let parent = target
                .parent()
                .ok_or("Invalid output directory.")?
                .canonicalize()
                .map_err(|e| e.to_string())?;
            let resolved = parent.join(target.file_name().ok_or("Invalid filename.")?);
            let canonical = target.canonicalize().unwrap_or(resolved);
            if sources
                .iter()
                .any(|s| s.original.as_ref() == Some(&canonical))
            {
                return Err(
                    "Choose a different destination to preserve the imported source PDF.".into(),
                );
            }
            if target.exists()
                && rfd::MessageDialog::new()
                    .set_title("Replace exported PDF?")
                    .set_description(format!("Replace {}?", target.display()))
                    .set_buttons(rfd::MessageButtons::YesNo)
                    .show()
                    != rfd::MessageDialogResult::Yes
            {
                return Ok(None);
            }
            let temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
            organizer::export(&exe, &sources, &documents[0], temp.path(), &cancel)?;
            if cancel.load(Ordering::SeqCst) {
                return Err("Export cancelled.".into());
            }
            temp.as_file().sync_all().map_err(|e| e.to_string())?;
            temp.persist(&target)
                .map_err(|e| format!("Cannot save {}. {e}", target.display()))?;
        } else {
            // Stage every part before publishing a uniquely named batch folder.
            let staging = tempfile::tempdir_in(&target).map_err(|e| e.to_string())?;
            for (index, pages) in documents.iter().enumerate() {
                organizer::export(
                    &exe,
                    &sources,
                    pages,
                    &staging.path().join(format!("Part-{:03}.pdf", index + 1)),
                    &cancel,
                )?;
            }
            if cancel.load(Ordering::SeqCst) {
                return Err("Export cancelled.".into());
            }
            let suffix = staging
                .path()
                .file_name()
                .unwrap()
                .to_string_lossy()
                .replace('.', "");
            let output = target.join(format!("Folio-split-{suffix}"));
            fs::rename(staging.path(), &output)
                .map_err(|e| format!("Cannot save split PDFs. {e}"))?;
            return Ok(Some(output.to_string_lossy().into()));
        }
        Ok(Some(target.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}
