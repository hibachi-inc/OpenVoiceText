mod cloud;

use tauri::Manager;

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
            cloud::prepare_capture,
            cloud::discard_capture,
            cloud::set_api_key,
            cloud::api_key_present,
            cloud::clear_api_key,
            cloud::cloud_transcribe,
            cloud::cloud_refine,
        ])
        .setup(|app| {
            cloud::clear_stale_captures(app.handle())?;
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
