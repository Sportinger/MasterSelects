//! Session-owned bounded repository transport. File locks survive path aliases and release on disconnect.
use super::Session;
use crate::protocol::Response;
use base64::{engine::general_purpose::STANDARD, Engine};
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs::{self, File, OpenOptions}, io::{Read, Seek, SeekFrom, Write}, path::{Path, PathBuf}};
use serde_json::{json, Value};
const CHUNK: usize = 256 * 1024;
struct Lease { root: PathBuf, file: File }
struct Upload { lease: String, target: PathBuf, temporary: PathBuf, file: File, offset: u64, replace: bool }
impl Drop for Upload { fn drop(&mut self) { let _ = fs::remove_file(&self.temporary); } }
#[derive(Default)]
pub(super) struct RepositorySession { leases: HashMap<String, Lease>, uploads: HashMap<String, Upload> }
fn fail(message: &str) -> std::io::Error { std::io::Error::new(std::io::ErrorKind::Other, message) }
fn sync_directory(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)] { let _ = path; Ok(()) } // Windows publication uses write-through MoveFileEx below.
    #[cfg(not(windows))] { File::open(path)?.sync_all() }
}
fn publish_file(source: &Path, target: &Path, replace: bool) -> std::io::Result<()> {
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        // No REPLACE_EXISTING flag: immutable destinations can never be overwritten.
        if replace && target.exists() { fs::remove_file(target)?; }
        let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 { return Err(std::io::Error::last_os_error()); }
        Ok(())
    }
    #[cfg(not(windows))] {
        if replace { fs::rename(source,target)?; } else { fs::hard_link(source,target)?; }
        sync_directory(target.parent().unwrap())
    }
}
fn repository_write_path(path: &str) -> bool {
    if path == "project.msrepo.json" || path == "archive-manifest.json" { return true; }
    ["segments", "commits", "artifacts", "artifact-manifests", "views", "imports", "transport", "backup-sources"]
        .iter().any(|namespace| path.starts_with(&format!(".masterselects/{}/", namespace)))
}
fn scoped(root: &Path, path: &str, create: bool) -> std::io::Result<PathBuf> {
    if path.is_empty() || path.split('/').any(|p| p.is_empty() || p == "." || p == ".." || p.contains('\\') || p.contains(':')) { return Err(fail("Invalid repository path")); }
    let mut current = root.to_path_buf(); let parts: Vec<_> = path.split('/').collect();
    for (index, part) in parts.iter().enumerate() {
        current.push(part);
        if let Ok(metadata) = fs::symlink_metadata(&current) {
            if metadata.file_type().is_symlink() { return Err(fail("Repository symlinks are prohibited")); }
            let canonical = fs::canonicalize(&current)?;
            if !canonical.starts_with(root) { return Err(fail("Repository path escapes root")); }
            current = canonical;
        } else if index + 1 < parts.len() {
            if create { fs::create_dir(&current)?; sync_directory(current.parent().unwrap())?; }
            else { return Err(std::io::Error::from(std::io::ErrorKind::NotFound)); }
        }
    }
    Ok(current)
}
fn page(root: &Path, base: &str, prefix: &str, cursor: &str, limit: usize, items: &mut Vec<String>) -> std::io::Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?; let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(".repository-") { continue; }
        let path = format!("{}{}", base, name); let kind = entry.file_type()?;
        if kind.is_symlink() { continue; }
        if kind.is_dir() { if prefix.starts_with(&(path.clone()+"/")) || path.starts_with(prefix) { page(&entry.path(), &(path+"/"), prefix, cursor, limit, items)?; } }
        else if path.starts_with(prefix) && path.as_str() > cursor { let index = items.partition_point(|item| item < &path); items.insert(index, path); if items.len() > limit + 1 { items.pop(); } }
    }
    Ok(())
}
fn head(root: &Path) -> std::io::Result<Option<Value>> {
    let directory = root.join(".masterselects/commits"); if !directory.exists() { return Ok(None); }
    let mut latest = None; let mut sequence = 0;
    for entry in fs::read_dir(directory)? {
        let entry = entry?; if !entry.file_type()?.is_file() || entry.metadata()?.len() > 1024 * 1024 { continue; }
        let bytes = fs::read(entry.path())?;
        if let Ok(manifest) = serde_json::from_slice::<Value>(&bytes) {
            if manifest["format"] != "masterselects-commit" { continue; }
            let next = manifest["lastOperation"].as_u64().ok_or_else(|| fail("Corrupt commit sequence"))?;
            let identity = json!({"commitId":manifest["commitId"],"hash":format!("sha256:{:x}",Sha256::digest(&bytes))});
            if next == sequence && latest.as_ref().map(|item| item != &identity).unwrap_or(false) { return Err(fail("Divergent complete commit heads")); }
            if next >= sequence { sequence = next; latest = Some(identity); }
        }
    }
    Ok(latest)
}
impl Session {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn handle_repository(&mut self, id: &str, action: &str, root: &str, path: Option<&str>, lease: Option<&str>, upload: Option<&str>, data: Option<&str>, offset: Option<u64>, length: Option<usize>, limit: Option<usize>, cursor: Option<&str>, replace: bool, publish: bool, expected: Option<Value>) -> Response {
        let result = self.repository_io(action, root, path, lease, upload, data, offset, length, limit, cursor, replace, publish, expected);
        match result { Ok(value) => Response::ok(id, value), Err(error) => Response::error(id, "REPOSITORY_IO", error.to_string()) }
    }
    #[allow(clippy::too_many_arguments)]
    fn repository_io(&mut self, action: &str, root: &str, path: Option<&str>, lease: Option<&str>, upload: Option<&str>, data: Option<&str>, offset: Option<u64>, length: Option<usize>, limit: Option<usize>, cursor: Option<&str>, replace: bool, publish: bool, expected: Option<Value>) -> std::io::Result<Value> {
        let supplied = Path::new(root);
        if !supplied.is_absolute() || !self.state.is_path_allowed(supplied) { return Err(fail("Repository root is not granted")); }
        let root = fs::canonicalize(supplied)?;
        if !root.is_dir() || !self.state.is_path_allowed(&root) { return Err(fail("Canonical repository root is not granted")); }
        if action == "info" { return Ok(json!({"repository_protocol":1,"canonical_root":root,"chunk_bytes":CHUNK,"durability":"fsync"})); }
        if action == "acquire" {
            let internal=root.join(".masterselects"); if !internal.exists() { fs::create_dir(&internal)?; sync_directory(&root)?; }
            let file = OpenOptions::new().read(true).write(true).create(true).open(internal.join(".repository-owner"))?;
            if file.try_lock_exclusive().is_err() { return Ok(json!({"lease":null})); }
            let token = uuid::Uuid::new_v4().to_string(); self.repository.leases.insert(token.clone(), Lease { root, file }); return Ok(json!({"lease":token}));
        }
        if ["assert","release","begin","chunk","finish","abort","remove"].contains(&action) {
            let owner = self.repository.leases.get(lease.unwrap_or("")).ok_or_else(|| fail("Repository owner lost"))?;
            if owner.root != root { return Err(fail("Lease belongs to another root")); }
            let _ = owner.file.metadata()?;
        }
        match action {
            "assert" => Ok(json!({"owned":true})),
            "release" => { let token = lease.unwrap(); self.repository.uploads.retain(|_, u| u.lease != token); self.repository.leases.remove(token); Ok(json!({"released":true})) },
            "list" => { let prefix = path.unwrap_or(""); if !prefix.is_empty() { match scoped(&root, prefix.trim_end_matches('/'), false) { Ok(_)=>{}, Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(json!({"paths":[],"nextCursor":null})), Err(e)=>return Err(e) } } let count = limit.unwrap_or(128).clamp(1,1024); let mut items = Vec::new(); page(&root,"",prefix,cursor.unwrap_or(""),count,&mut items)?; let next = if items.len() > count { items.pop(); items.last().cloned() } else { None }; Ok(json!({"paths":items,"nextCursor":next})) },
            "stat" => { let target = match scoped(&root,path.unwrap_or(""),false) { Ok(target)=>target, Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(json!({"length":null})), Err(e)=>return Err(e) }; match fs::metadata(target) { Ok(m) => Ok(json!({"length":m.len()})), Err(e) if e.kind()==std::io::ErrorKind::NotFound => Ok(json!({"length":null})), Err(e)=>Err(e) } },
            "read" => { let target = scoped(&root,path.unwrap_or(""),false)?; let mut file = File::open(target)?; file.seek(SeekFrom::Start(offset.unwrap_or(0)))?; let count = length.unwrap_or(CHUNK); if count > CHUNK { return Err(fail("Read exceeds chunk limit")); } let mut bytes = vec![0;count]; let mut used=0; while used<count { let read=file.read(&mut bytes[used..])?; if read==0 { break; } used+=read; } bytes.truncate(used); Ok(json!({"data":STANDARD.encode(bytes)})) },
            "begin" => { if self.repository.uploads.len() >= 8 { return Err(fail("Upload backpressure limit")); } let relative=path.unwrap_or(""); if !repository_write_path(relative) { return Err(fail("Repository writes cannot mutate original source paths")); } if replace && !(relative.starts_with(".masterselects/views/") && relative.split('/').count() == 5 && (relative.ends_with("/a.json") || relative.ends_with("/b.json"))) { return Err(fail("Only inactive view slots can be replaced")); } let target=scoped(&root,relative,true)?; if target.exists() && !replace { return Err(fail("Immutable destination already exists")); } let token=uuid::Uuid::new_v4().to_string(); let temporary=target.parent().unwrap().join(format!(".repository-upload-{}",token)); let file=OpenOptions::new().write(true).create_new(true).open(&temporary)?; self.repository.uploads.insert(token.clone(),Upload {lease:lease.unwrap().into(),target,temporary,file,offset:0,replace}); Ok(json!({"upload":token})) },
            "chunk" => { let current=self.repository.uploads.get_mut(upload.unwrap_or("")).ok_or_else(||fail("Unknown upload"))?; if current.lease!=lease.unwrap() { return Err(fail("Upload owner mismatch")); } let encoded=data.unwrap_or(""); if encoded.len() > ((CHUNK+2)/3)*4 { return Err(fail("Chunk exceeds limit")); } let bytes=STANDARD.decode(encoded).map_err(|_|fail("Invalid chunk encoding"))?; if bytes.len()>CHUNK || offset!=Some(current.offset) {return Err(fail("Chunk offset or size mismatch"));} current.file.write_all(&bytes)?; current.offset+=bytes.len() as u64; Ok(json!({"offset":current.offset})) },
            "abort" => { if let Some(current)=self.repository.uploads.get(upload.unwrap_or("")) { if current.lease!=lease.unwrap() {return Err(fail("Upload owner mismatch"));} } self.repository.uploads.remove(upload.unwrap_or("")); Ok(json!({"aborted":true})) },
            "finish" => {
                let token=upload.unwrap_or(""); let current=self.repository.uploads.get(token).ok_or_else(||fail("Unknown upload"))?;
                if current.lease!=lease.unwrap() {return Err(fail("Upload owner mismatch"));}
                current.file.sync_all()?;
                if publish {
                    if current.replace || current.target.parent()!=Some(root.join(".masterselects/commits").as_path()) { return Err(fail("Invalid commit target")); }
                    if head(&root)? != expected { return Err(fail("Expected commit head changed")); }
                    if current.offset>1024*1024 {return Err(fail("Commit exceeds manifest limit"));} let bytes=fs::read(&current.temporary)?;
                    let manifest:Value=serde_json::from_slice(&bytes).map_err(|_|fail("Invalid commit manifest"))?;
                    if manifest["previous"]!=expected.clone().unwrap_or(Value::Null) {return Err(fail("Manifest previous does not match publication barrier"));}
                }
                publish_file(&current.temporary,&current.target,current.replace)?;
                self.repository.uploads.remove(token); Ok(json!({"completed":true,"durability":"fsync"}))
            },
            "remove" => { let relative=path.unwrap_or(""); if !(relative.starts_with(".masterselects/artifacts/") || relative.starts_with(".masterselects/artifact-manifests/")) { return Err(fail("Published segments, commits and source originals cannot be removed")); } let target=scoped(&root,relative,false)?; fs::remove_file(&target)?; sync_directory(target.parent().unwrap())?; Ok(json!({"removed":true})) },
            _ => Err(fail("Unsupported repository action")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::AppState;
    use std::sync::Arc;
    #[test]
    fn canonical_aliases_share_the_operating_system_lease() {
        let root=std::env::temp_dir().join(format!("ms-repository-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap(); let state=Arc::new(AppState::new(None)); state.grant_path(root.clone());
        let mut first=Session::new(state.clone()); let mut second=Session::new(state);
        let path=root.to_str().unwrap();
        let one=first.repository_io("acquire",path,None,None,None,None,None,None,None,None,false,false,None).unwrap();
        let alias=root.join(".");
        let two=second.repository_io("acquire",alias.to_str().unwrap(),None,None,None,None,None,None,None,None,false,false,None).unwrap();
        assert!(two["lease"].is_null());
        first.repository_io("release",path,None,one["lease"].as_str(),None,None,None,None,None,None,false,false,None).unwrap();
        let three=second.repository_io("acquire",path,None,None,None,None,None,None,None,None,false,false,None).unwrap();
        assert!(three["lease"].is_string()); drop(first); drop(second); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn repository_paths_reject_escape_and_legacy_mutation() {
        let root=std::env::temp_dir().join(format!("ms-repository-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap(); fs::create_dir(root.join(".masterselects")).unwrap();
        assert!(scoped(&root,"../outside",true).is_err()); assert!(scoped(&root,"a/../../outside",true).is_err());
        let state=AppState::new(None);
        assert!(state.is_repository_protected_path(&root));
        assert!(state.is_repository_protected_path(&root.join(".masterselects/commits/new.json")));
        assert!(!state.is_repository_protected_path(&root.join("media/new.mov")));
        fs::remove_dir_all(root).unwrap();
    }
}
