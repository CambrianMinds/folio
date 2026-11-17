use crate::config::Config;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
pub fn fingerprint(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn sidecar(path: &Path) -> PathBuf {
    path.with_extension("folio.json")
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid output path")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    temp.persist(path)
        .map_err(|e| format!("Could not save {}: {e}", path.display()))?;
    Ok(())
}
pub fn load_layout(path: &Path) -> Result<Config, String> {
    let layout = sidecar(path);
    if layout.exists() {
        Config::from_json(&fs::read_to_string(&layout).map_err(|e| e.to_string())?)
    } else {
        Ok(Config::default())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configuration_roundtrip_preserves_source() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("Unicode – notes.md");
        let source = b"# Untouched\r\n\r\nExactly two spaces.  \r\n";
        atomic_write(&path, source).unwrap();
        let mut c = Config::default();
        c.columns = 2;
        c.rule = true;
        atomic_write(&sidecar(&path), &serde_json::to_vec_pretty(&c).unwrap()).unwrap();
        assert_eq!(load_layout(&path).unwrap(), c);
        assert_eq!(fs::read(&path).unwrap(), source);
        atomic_write(&sidecar(&path), b"{}").unwrap();
        assert_eq!(load_layout(&path).unwrap(), Config::default());
    }
}
