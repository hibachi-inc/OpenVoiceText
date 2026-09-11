pub fn clear_stale_captures(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let directory = capture_directory(app)?;
    if directory.exists() {
        for entry in fs::read_dir(&directory)? {
            let path = entry?.path();
            if path.extension().is_some_and(|extension| extension == "wav") {
                let _ = fs::remove_file(path);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn prepare_capture(
    app: AppHandle,
    state: State<'_, CloudState>,
) -> Result<PreparedCapture, String> {
    let directory = capture_directory(&app).map_err(|_| "cloud.capture_prepare")?;
    fs::create_dir_all(&directory).map_err(|_| "cloud.capture_prepare")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "cloud.capture_prepare")?;
    }

    let capture_id = format!(
        "{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "cloud.capture_prepare")?
            .as_micros(),
        state.sequence.fetch_add(1, Ordering::Relaxed),
    );
    let path = directory.join(format!("{capture_id}.wav"));
    fs::File::create(&path).map_err(|_| "cloud.capture_prepare")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|_| "cloud.capture_prepare")?;
    }
    state
        .captures
        .lock()
        .map_err(|_| "cloud.capture_prepare")?
        .insert(capture_id.clone(), path.clone());
    Ok(PreparedCapture {
        capture_id,
        audio_path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn discard_capture(capture_id: String, state: State<'_, CloudState>) -> Result<(), String> {
    if let Some(path) = state
        .captures
        .lock()
        .map_err(|_| "cloud.capture_discard")?
        .remove(&capture_id)
    {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

fn capture_directory(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(app.path().app_cache_dir()?.join("cloud-captures"))
}

struct TempAudio(PathBuf);

impl Drop for TempAudio {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
