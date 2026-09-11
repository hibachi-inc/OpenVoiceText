const GEMINI_MODELS: [&str; 5] = [
    "gemini-2.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemma-4-26b-a4b-it",
    "gemma-4-31b-it",
];

/// Qwen同士の連鎖用。混雑時の安定のため明示Qwenの次にもう片方を試す。
const GROQ_QWEN_MODELS: [&str; 2] = ["qwen/qwen3.6-27b", "qwen/qwen3.8-27b"];

/// Groq整形の試行順。明示Qwenだけペアでもう片方に繋ぐ。
/// それ以外（デフォルト含む）は単発で、失敗時はローカル整形に委ねる。
fn groq_refine_chain(explicit: Option<String>) -> Vec<String> {
    let first = explicit
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| GROQ_DEFAULT_MODEL.to_string());
    let mut models = vec![first.clone()];
    if first.to_lowercase().contains("qwen") {
        for alt in GROQ_QWEN_MODELS {
            if alt != first {
                models.push(alt.to_string());
            }
        }
    }
    models
}

/// モデル能力規則（集約）。モデル別の振る舞い差異はここに集める。
/// - 画像添付可否: model_supports_vision（Geminiは全対応、Groqは既知IDのみ）
/// - 添付時のテキスト省略: image_will_attach（画像と画面テキストの重複排除。
///   stream側の添付条件と一致させること）
/// - 音声入力可否: model_supports_audio（provider別。未知はfalse）
/// - 一覧表示可否: model_transcription_eligible / model_refinement_eligible
///   （UIの一覧フィルタはこの返却値に従う。ID文字列判定をUIに書かないこと）
/// - 思考設定: gemini_generation_config 内の世代分岐
///   （2.5系=thinkingBudget:0、3.x系=thinkingLevel:minimal、世代不明lite系=省略、
///   その他エイリアス=budget:0試行。拒否時は400フォールバックで次へ進む）
/// - 推論量: groq_reasoning_effort（GPT-OSS=low、Qwen=none、その他=省略。
///   他系列にlow等を送ると400になる）
/// - 連鎖組み立て: gemini_chain（明示モデル先頭＋重複除去）
/// 整形モデルが画像文脈を受けられるか。Groqはカタログ方式のため既知IDで判定する。
fn model_supports_vision(provider: &str, model: &str) -> bool {
    match provider {
        "gemini" => true,
        "groq" => matches!(model, "qwen/qwen3.6-27b" | "qwen/qwen3.8-27b"),
        _ => false,
    }
}

/// 添付画像のMIME型を検証する。WebPはGeminiのみ対応のためそれ以外はJPEGに倒す。
fn sanitize_image_mime(mime: Option<String>) -> String {
    match mime.as_deref() {
        Some("image/webp") => "image/webp".to_string(),
        _ => "image/jpeg".to_string(),
    }
}

/// Gemini失敗時に次モデルへ進めるか。400も対象にする。
/// モデルごとの受付差異があり別モデルで通ることがあるため。
/// フォールバック発生時は呼び出し側に記録が残る。
fn is_fallback_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::BAD_REQUEST
        || status == reqwest::StatusCode::NOT_FOUND
        || status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    id: String,
    vision: bool,
    audio: bool,
    transcription_eligible: bool,
    refinement_eligible: bool,
}

#[tauri::command]
pub async fn list_provider_models(
    provider: String,
    state: State<'_, CloudState>,
) -> Result<Vec<ModelInfo>, String> {
    validate_provider(&provider)?;
    let key = resolve_key(&state, &provider)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| "cloud.connect".to_string())?;
    let ids = match provider.as_str() {
        "groq" => list_groq_models(&client, &key).await?,
        "gemini" => list_gemini_models(&client, &key).await?,
        _ => return Err("cloud.invalid_provider".into()),
    };
    Ok(ids
        .into_iter()
        .map(|id| {
            let vision = model_supports_vision(&provider, &id);
            let audio = model_supports_audio(&provider, &id);
            let transcription_eligible = model_transcription_eligible(&provider, &id);
            let refinement_eligible = model_refinement_eligible(&provider, &id);
            ModelInfo {
                id,
                vision,
                audio,
                transcription_eligible,
                refinement_eligible,
            }
        })
        .collect())
}

/// 整形に使えない音声・画像・管理系モデルを除く。
fn is_refine_candidate(id: &str) -> bool {
    let id = id.to_lowercase();
    for blocked in [
        "whisper",
        "tts",
        "orpheus",
        "guard",
        "compound",
        "moderation",
        "embed",
    ] {
        if id.contains(blocked) {
            return false;
        }
    }
    true
}

fn groq_model_ids(body: &Value) -> Vec<String> {
    let mut ids: Vec<String> = body
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id")?.as_str())
                .filter(|id| is_refine_candidate(id))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids.dedup();
    ids
}

fn gemini_model_ids(body: &Value) -> Vec<String> {
    let mut ids: Vec<String> = body
        .get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    item.get("supportedGenerationMethods")
                        .and_then(Value::as_array)
                        .is_some_and(|methods| {
                            methods
                                .iter()
                                .any(|m| m.as_str() == Some("generateContent"))
                        })
                })
                .filter_map(|item| item.get("name")?.as_str())
                .filter_map(|name| name.strip_prefix("models/"))
                .filter(|id| is_refine_candidate(id))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids.dedup();
    ids
}

async fn list_groq_models(client: &reqwest::Client, key: &str) -> Result<Vec<String>, String> {
    let response = client
        .get("https://api.groq.com/openai/v1/models")
        .bearer_auth(key)
        .send()
        .await
        .map_err(|_| "cloud.groq_connect".to_string())?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("cloud.groq_key".into());
    }
    if !status.is_success() {
        return Err(format!("cloud.groq_failed:{}", status.as_u16()));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| "cloud.response".to_string())?;
    Ok(groq_model_ids(&body))
}

async fn list_gemini_models(client: &reqwest::Client, key: &str) -> Result<Vec<String>, String> {
    let response = client
        .get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200")
        .header("x-goog-api-key", key)
        .send()
        .await
        .map_err(|_| "cloud.gemini_connect".to_string())?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED
        || status == reqwest::StatusCode::FORBIDDEN
        || status == reqwest::StatusCode::BAD_REQUEST
    {
        return Err("cloud.gemini_key".into());
    }
    if !status.is_success() {
        return Err(format!("cloud.gemini_failed:{}", status.as_u16()));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| "cloud.response".to_string())?;
    Ok(gemini_model_ids(&body))
}

/// 明示モデルを先頭にしたGeminiチェーン。重複は除く。
fn gemini_chain(explicit: Option<String>) -> Vec<String> {
    let mut models = Vec::new();
    if let Some(m) = explicit
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
    {
        models.push(m);
    }
    for m in GEMINI_MODELS {
        if models.iter().all(|x| x != m) {
            models.push(m.to_string());
        }
    }
    models
}

/// 画像添付が見込まれるか。見込まれる場合は画面テキストを送らない。
/// stream側の添付条件（サイズ＋vision）と一致させること。
/// 画像つきの判断材料が二重になると順序なし・鮮度違いの重複で精度が落ちるため。
fn image_will_attach(provider: &str, explicit_model: Option<&str>, image: &Option<String>) -> bool {
    let ok = image
        .as_deref()
        .map(|s| !s.is_empty() && s.len() <= 1_400_000)
        .unwrap_or(false);
    if !ok {
        return false;
    }
    match provider {
        "gemini" => true,
        "groq" => {
            let m = explicit_model.unwrap_or(GROQ_DEFAULT_MODEL);
            model_supports_vision("groq", m)
        }
        _ => false,
    }
}

/// Geminiの動的フォールバック対象（flash系テキストモデル）。
/// UI側の一覧フィルタと同規則。変えたら両方直すこと。
fn is_gemini_flash_text_model(id: &str) -> bool {
    let lower = id.to_lowercase();
    lower.contains("flash") && !lower.contains("image") && is_refine_candidate(id)
}

/// 音声入力に対応するモデルか。「このモデル自身が音声入力を受け取れる」の意味。
/// 未知モデルはfalse（安全側）。転写・結合経路では非対応を候補から外す。
fn model_supports_audio(provider: &str, id: &str) -> bool {
    let lower = id.to_lowercase();
    match provider {
        "gemini" => lower.contains("flash") && !lower.contains("image"),
        "groq" => lower.contains("whisper"),
        _ => false,
    }
}

/// 整形に使えるモデルか（UIの一覧表示用）。
fn model_refinement_eligible(provider: &str, id: &str) -> bool {
    match provider {
        "gemini" => {
            let lower = id.to_lowercase();
            (lower.contains("flash") || lower.contains("gemma"))
                && !lower.contains("image")
                && is_refine_candidate(id)
        }
        "groq" => is_refine_candidate(id),
        _ => false,
    }
}

/// 転写モデル選択に使えるモデルか（UIの一覧表示用）。
fn model_transcription_eligible(provider: &str, id: &str) -> bool {
    model_supports_audio(provider, id) && is_refine_candidate(id)
}

/// 動的フォールバックの候補か。一覧からflash系だけ拾う。
fn is_dynamic_fallback_candidate(id: &str, tried: &[String]) -> bool {
    is_gemini_flash_text_model(id) && !tried.iter().any(|t| t == id)
}

/// 静的チェーンが尽きたら一覧からflash系を追加で拾う（最大3）。
/// 無料枠の混雑503などに備える。取得失敗時は空。
async fn gemini_dynamic_fallbacks(
    client: &reqwest::Client,
    key: &str,
    tried: &[String],
) -> Vec<String> {
    match list_gemini_models(client, key).await {
        Ok(ids) => ids
            .into_iter()
            .filter(|id| is_dynamic_fallback_candidate(id, tried))
            .take(3)
            .collect(),
        Err(_) => Vec::new(),
    }
}
