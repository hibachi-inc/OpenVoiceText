mod cloud;

use std::sync::Mutex;
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

/// 匿名エラー収集の同意状態。Sentryガードは同意オンの間だけ保持する。
#[derive(Default)]
struct TelemetryState {
    sentry_guard: Mutex<Option<sentry::ClientInitGuard>>,
}

const SENTRY_DSN: &str = "https://8d9fe8f972b0b2aacf7720b1cd8c927b@o4511422658314240.ingest.us.sentry.io/4512074829529088";

// HOME混入（ビルドパス等）をマスクする。キー類はRust側のログに出さない設計のため対象外。
fn scrub_event(mut event: sentry::protocol::Event<'static>) -> Option<sentry::protocol::Event<'static>> {
    let home = std::env::var("HOME").unwrap_or_default();
    let scrub = |s: &mut String| {
        if !home.is_empty() {
            *s = s.replace(&home, "~");
        }
        if s.len() > 2000 {
            s.truncate(2000);
        }
    };
    if let Some(message) = event.message.as_mut() {
        scrub(message);
    }
    for value in event.exception.values.iter_mut() {
        if let Some(text) = value.value.as_mut() {
            scrub(text);
        }
    }
    for crumb in event.breadcrumbs.iter_mut() {
        if let Some(message) = crumb.message.as_mut() {
            scrub(message);
        }
        crumb.data.clear();
    }
    event.user.take();
    Some(event)
}

fn install_panic_file_log(app: &tauri::AppHandle) {
    // 既存フック（Sentry等）に繋いでファイル記録を残す。
    let previous = std::panic::take_hook();
    let handle = app.clone();
    std::panic::set_hook(Box::new(move |info| {
        cloud::diag_log(&handle, format!("PANIC: {info}"));
        previous(info);
    }));
}

/// 匿名エラー収集の同意切替。Sentryはオンの間だけ初期化する。
#[tauri::command]
fn set_telemetry_consent(app: tauri::AppHandle, state: tauri::State<TelemetryState>, enabled: bool) -> Result<(), String> {
    let mut guard = state.sentry_guard.lock().map_err(|e| e.to_string())?;
    if enabled && guard.is_none() {
        let before_send: std::sync::Arc<
            dyn Fn(sentry::protocol::Event<'static>) -> Option<sentry::protocol::Event<'static>> + Send + Sync,
        > = std::sync::Arc::new(scrub_event);
        let options = sentry::ClientOptions {
            dsn: SENTRY_DSN.parse().ok(),
            release: Some(env!("CARGO_PKG_VERSION").into()),
            environment: if cfg!(debug_assertions) {
                Some("development".into())
            } else {
                Some("production".into())
            },
            before_send: Some(before_send),
            ..Default::default()
        };
        *guard = Some(sentry::init(options));
        // Sentryがフックを置き換えるため、ファイル記録を繋ぎ直す。
        install_panic_file_log(&app);
    } else if !enabled {
        *guard = None;
    }
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
        .manage(TelemetryState::default())
        .invoke_handler(tauri::generate_handler![
            hud_resize,
            open_url,
            append_log,
            set_telemetry_consent,
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
            install_panic_file_log(app.handle());
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
