mod cloud;

use std::sync::Mutex;
use tauri::Manager;
use tauri::{Emitter, Listener};
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

/// メニューバー常駐トレイの文言。フロントの表示言語に合わせて作り直す。
#[derive(Clone, serde::Deserialize)]
struct TrayLabels {
    toggle_start: String,
    toggle_stop: String,
    toggle_confirm: String,
    settings: String,
    quit: String,
}

impl TrayLabels {
    fn japanese() -> Self {
        Self {
            toggle_start: "録音を開始".into(),
            toggle_stop: "録音を停止".into(),
            toggle_confirm: "AI整形版で確定".into(),
            settings: "設定を開く…".into(),
            quit: "VoiceLatteを終了".into(),
        }
    }
}

/// トレイの録音状態。choiceはAI整形後の選択肢待ちで、押すと整形版が確定する。
#[derive(Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum TrayStatus {
    Idle,
    Active,
    Choice,
}

fn toggle_text(labels: &TrayLabels, status: TrayStatus) -> &str {
    match status {
        TrayStatus::Idle => &labels.toggle_start,
        TrayStatus::Active => &labels.toggle_stop,
        TrayStatus::Choice => &labels.toggle_confirm,
    }
}

/// トレイ表示の切替用にハンドルを保持する。
struct TrayState {
    tray: tauri::tray::TrayIcon,
    toggle: tauri::menu::MenuItem<tauri::Wry>,
    labels: TrayLabels,
    status: TrayStatus,
}

fn tray_menu(
    app: &tauri::AppHandle,
    labels: &TrayLabels,
    status: TrayStatus,
) -> tauri::Result<(
    tauri::menu::Menu<tauri::Wry>,
    tauri::menu::MenuItem<tauri::Wry>,
)> {
    let toggle =
        tauri::menu::MenuItemBuilder::with_id("tray-toggle", toggle_text(labels, status))
            .build(app)?;
    let settings =
        tauri::menu::MenuItemBuilder::with_id("tray-settings", &labels.settings).build(app)?;
    let quit = tauri::menu::MenuItemBuilder::with_id("tray-quit", &labels.quit).build(app)?;
    let menu = tauri::menu::MenuBuilder::new(app)
        .items(&[
            &toggle,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &settings,
            &quit,
        ])
        .build()?;
    Ok((menu, toggle))
}

fn build_tray(app: &tauri::AppHandle, labels: &TrayLabels) -> tauri::Result<()> {
    let (menu, toggle) = tray_menu(app, labels, TrayStatus::Idle)?;
    let tray = tauri::tray::TrayIconBuilder::new()
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/tray-icon.png"
        ))?)
        .icon_as_template(true)
        .tooltip("VoiceLatte")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-toggle" => {
                let _ = app.emit("tray-toggle", ());
            }
            "tray-settings" => show_settings(app),
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    app.manage(std::sync::Mutex::new(Some(TrayState {
        tray,
        toggle,
        labels: labels.clone(),
        status: TrayStatus::Idle,
    })));
    Ok(())
}

fn show_settings(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 録音状態を牛アイコンの色で表す。待機中は白テンプレート、作業中は赤。
fn set_tray_recording_visual(tray: &tauri::tray::TrayIcon, recording: bool) {
    let bytes: &[u8] = if recording {
        include_bytes!("../icons/tray-icon-recording.png")
    } else {
        include_bytes!("../icons/tray-icon.png")
    };
    if let Ok(image) = tauri::image::Image::from_bytes(bytes) {
        let _ = tray.set_icon(Some(image));
        let _ = tray.set_icon_as_template(!recording);
    }
}

fn with_tray_state(app: &tauri::AppHandle, f: impl FnOnce(&mut TrayState)) {
    let Some(state) = app.try_state::<std::sync::Mutex<Option<TrayState>>>() else {
        return;
    };
    let Ok(mut guard) = state.lock() else { return };
    let Some(tray) = guard.as_mut() else { return };
    f(tray);
}

/// フロントからの録音状態通知をトレイ表示に反映する。
fn apply_tray_status(app: &tauri::AppHandle, status: TrayStatus) {
    with_tray_state(app, |tray| {
        tray.status = status;
        set_tray_recording_visual(&tray.tray, status != TrayStatus::Idle);
        let _ = tray
            .toggle
            .set_text(toggle_text(&tray.labels, tray.status));
    });
}

/// フロントの表示言語に合わせてトレイメニューを作り直す。
fn apply_tray_labels(app: &tauri::AppHandle, labels: TrayLabels) {
    with_tray_state(app, |tray| {
        tray.labels = labels;
        if let Ok((menu, toggle)) = tray_menu(app, &tray.labels, tray.status) {
            let _ = tray.tray.set_menu(Some(menu));
            tray.toggle = toggle;
        }
    });
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
            show_settings(app);
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
            // メニューバー常駐化: Dockに出さず、トレイアイコンを置く。
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            // フロント起動前のフォールバック文言で建てる。言語確定後に作り直す。
            // 構築に失敗しても常駐なしで起動を続ける（設定窓・ショートカットは生きる）。
            if let Err(error) = build_tray(app.handle(), &TrayLabels::japanese()) {
                cloud::diag_log(app.handle(), format!("tray disabled: {error}"));
            }
            // ×ボタンは終了ではなく非表示にする。終了はトレイメニューからのみ。
            if let Some(main) = app.get_webview_window("main") {
                let window = main.clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                });
            }
            // フロントからのトレイ連携: 録音状態と表示言語を受け取る。
            {
                let handle = app.handle().clone();
                app.listen("tray-phase", move |event| {
                    #[derive(serde::Deserialize)]
                    struct PhasePayload {
                        status: TrayStatus,
                    }
                    if let Ok(payload) =
                        serde_json::from_str::<PhasePayload>(event.payload())
                    {
                        apply_tray_status(&handle, payload.status);
                    }
                });
            }
            {
                let handle = app.handle().clone();
                app.listen("tray-labels", move |event| {
                    if let Ok(labels) = serde_json::from_str::<TrayLabels>(event.payload()) {
                        apply_tray_labels(&handle, labels);
                    }
                });
            }
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
