mod cloud;

use tauri::Manager;
use tauri::{LogicalPosition, LogicalSize};

#[tauri::command]
fn hud_resize(window: tauri::WebviewWindow, height: f64, bottom: f64) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let x = window.outer_position().map_err(|e| e.to_string())?.x as f64 / scale;
    window
        .set_size(LogicalSize::new(616.0, height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(x, bottom - height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 外部ブラウザで開く。許可リスト外のURLは拒否する。
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    const ALLOWED: [&str; 6] = [
        "https://aistudio.google.com/",
        "https://console.groq.com/",
        "https://github.com/hibachi-inc/OpenVoiceText",
        "https://x.com/tanakaisworking",
        "https://chatgpt.com/",
        "https://claude.ai/",
    ];
    if !ALLOWED.iter().any(|prefix| url.starts_with(prefix)) {
        return Err("cloud.invalid_url".into());
    }
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// フロントの warn/error ログをファイルに残す。レンダラが死んでも死因が追える。
/// 行長制限あり。保存失敗は呼び出し側で無視すること（再帰防止のためここではログしない）。
#[tauri::command]
fn append_log(app: tauri::AppHandle, level: String, tag: String, message: String) -> Result<(), String> {
    let level = match level.as_str() {
        "warn" => "warn",
        "error" => "error",
        _ => "info",
    };
    let tag: String = tag.chars().take(64).collect();
    let message: String = message.chars().take(1000).collect();
    cloud::diag_log(&app, format!("[{level}] {tag}: {message}"));
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(cloud::CloudState::default())
        .invoke_handler(tauri::generate_handler![
            hud_resize,
            open_url,
            append_log,
            cloud::prepare_capture,
            cloud::discard_capture,
            cloud::set_api_key,
            cloud::api_key_present,
            cloud::clear_api_key,
            cloud::list_provider_models,
            cloud::cloud_transcribe,
            cloud::cloud_transcribe_refine,
            cloud::cloud_refine,
        ])
        .setup(|app| {
            // panicしても死因が残るようにファイルへ記録する（GUIではstderrが捨てられるため）。
            let handle = app.handle().clone();
            std::panic::set_hook(Box::new(move |info| {
                cloud::diag_log(&handle, format!("PANIC: {info}"));
            }));
            cloud::clear_stale_captures(app.handle())?;
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
