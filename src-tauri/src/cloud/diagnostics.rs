/// 試行診断をファイルに残す（open起動ではstderrが捨てられるため）。
/// ~/Library/Application Support/com.hibachi.voicelatte/diagnostics.log。
/// 1MB超で切り詰める。失敗しても無視する。
fn diag_log(app: &AppHandle, line: String) {
    use std::io::Write;
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("diagnostics.log");
    let append = std::fs::metadata(&path).map(|m| m.len() < 1_000_000).unwrap_or(true);
    let mut opts = std::fs::OpenOptions::new();
    opts.create(true);
    if append {
        opts.append(true);
    } else {
        opts.write(true).truncate(true);
    }
    if let Ok(mut file) = opts.open(path) {
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "{secs} {line}");
    }
}

fn diag_gemini_line(
    model: &str,
    audio_bytes: usize,
    image: Option<&str>,
    image_mime: &str,
    json_output: bool,
    status: &str,
    elapsed_ms: u128,
) -> String {
    let image_desc = image
        .map(|i| format!("{}B/{}", i.len(), image_mime))
        .unwrap_or_else(|| "-".into());
    format!("gemini model={model} audio={audio_bytes} image={image_desc} json={json_output} status={status} {elapsed_ms}ms")
}
