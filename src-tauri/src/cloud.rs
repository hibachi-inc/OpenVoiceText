use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
// 注：gemini-2.5-flash-lite は提供終了のため除外した（404 "no longer available"）。
// Gemma 26B/31B は音声非対応のため転写には使わない（model_supports_audio）。
// 将来2.5-flashも同様になったらここから外す。フォールバックが拾う。
// 画像添付時に付ける指示。画面の説明はさせず、誤認識の解決だけに使わせる。
const IMAGE_NOTE: &str = "\n\n[A screenshot of the user's screen is attached. Use text visible in it (names, terms, messages) only to resolve misrecognized words. Never describe or mention the screenshot.]";const GROQ_DEFAULT_MODEL: &str = "openai/gpt-oss-120b";
const GEMINI_MAX_AUDIO_BYTES: usize = 14_000_000;
const GROQ_MAX_AUDIO_BYTES: usize = 25_000_000;
// 短すぎる録音はGroqに蹴られる(4096Bでaudio_too_shortを確認)。16kHz/16bit/monoで約0.25秒分。
const MIN_AUDIO_BYTES: usize = 8000;

#[derive(Default)]
pub struct CloudState {
    captures: Mutex<HashMap<String, PathBuf>>,
    keys: Mutex<HashMap<String, String>>,
    sequence: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedCapture {
    capture_id: String,
    audio_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudResult {
    text: String,
    model: String,
    /// 結合ルートの場合のみ：整形前の文字起こし
    #[serde(skip_serializing_if = "Option::is_none")]
    raw: Option<String>,
    /// フォールバックで別モデルに切り替わった場合の、失敗したモデルと理由
    #[serde(skip_serializing_if = "Option::is_none")]
    fallback_from: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct CloudTranscript {
    text: String,
    model: String,
}

include!("cloud/common.rs");
include!("cloud/capture.rs");
include!("cloud/credentials.rs");
include!("cloud/models.rs");
include!("cloud/diagnostics.rs");
include!("cloud/groq.rs");
include!("cloud/gemini.rs");
include!("cloud/commands.rs");
include!("cloud/tests.rs");
