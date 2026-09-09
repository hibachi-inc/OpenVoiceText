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
