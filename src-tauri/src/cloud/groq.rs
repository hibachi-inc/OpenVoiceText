struct GroqError {
    message: String,
    fallback: bool,
}

/// モデル別のreasoning設定。GPT-OSS以外にlow等を送ると400になる。
/// Qwen系はinstructモード（none）が整形向きで速くて安い。
fn groq_reasoning_effort(model: &str) -> Option<&'static str> {
    let lower = model.trim().to_lowercase();
    if lower.starts_with("openai/gpt-oss") {
        Some("low")
    } else if lower.contains("qwen") {
        Some("none")
    } else {
        None
    }
}

async fn stream_groq_refinement(
    client: &reqwest::Client,
    key: &str,
    model: &str,
    input: &str,
    image: Option<&str>,
    app: &AppHandle,
) -> Result<String, GroqError> {
    // 画像は対応モデルのときだけ添付する。非対応に送ると400になる。
    // Groq向けはJPEG固定（WebPの受付が未確認のため）。
    let usable_image = image
        .filter(|s| !s.is_empty() && s.len() <= 1_400_000)
        .filter(|_| model_supports_vision("groq", model));
    let content = match usable_image {
        Some(img) => json!([
            { "type": "text", "text": format!("{input}{IMAGE_NOTE}") },
            { "type": "image_url", "image_url": { "url": format!("data:image/jpeg;base64,{img}") } }
        ]),
        None => json!(input),
    };
    let mut body = json!({
        "model": model,
        "messages": [{ "role": "user", "content": content }],
        "include_reasoning": false,
        "temperature": 0.2,
        "stream": true
    });
    if let Some(effort) = groq_reasoning_effort(model) {
        body["reasoning_effort"] = json!(effort);
    }
    let started = std::time::Instant::now();
    let response = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .bearer_auth(key)
        .json(&body)
        .send()
        .await;
    diag_log(
        app,
        format!(
            "groq model={} image={} status={} {}ms",
            model,
            image
                .map(|i| format!("{}B", i.len()))
                .unwrap_or_else(|| "-".into()),
            match &response {
                Ok(r) => r.status().to_string(),
                Err(_) => "connect-fail".into(),
            },
            started.elapsed().as_millis(),
        ),
    );
    let response = response.map_err(|_| GroqError {
        message: "cloud.groq_connect".into(),
        fallback: true,
    })?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(GroqError {
            message: "cloud.groq_key".into(),
            fallback: false,
        });
    }
    if !status.is_success() {
        // 鍵系以外は次モデルへ進める（Qwen同士の混雑回避を含む）。
        let fallback =
            status != reqwest::StatusCode::UNAUTHORIZED && status != reqwest::StatusCode::FORBIDDEN;
        return Err(GroqError {
            message: format!("cloud.groq_failed:{}", status.as_u16()),
            fallback,
        });
    }

    let mut response = response;
    let mut pending = Vec::new();
    let mut text = String::new();
    // チャンクが一定時間来なければ停滞とみなして打ち切る（次モデルへ）。
    // 整形のみのGroq経路は15秒。
    loop {
        let chunk = match tokio::time::timeout(std::time::Duration::from_secs(15), response.chunk())
            .await
        {
            Ok(Ok(chunk)) => chunk,
            Ok(Err(_)) | Err(_) => {
                return Err(GroqError {
                    message: "cloud.stream_stopped".into(),
                    fallback: text.is_empty(),
                })
            }
        };
        let Some(chunk) = chunk else { break };
        pending.extend_from_slice(&chunk);
        while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
            let line = pending.drain(..=newline).collect::<Vec<_>>();
            append_groq_sse_line(&line, model, &mut text, app);
        }
    }
    if !pending.is_empty() {
        append_groq_sse_line(&pending, model, &mut text, app);
    }
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(GroqError {
            message: "cloud.no_speech".into(),
            fallback: true,
        });
    }
    Ok(text)
}

fn append_groq_sse_line(line: &[u8], model: &str, output: &mut String, app: &AppHandle) {
    if let Some(chunk) = groq_sse_chunk(line) {
        output.push_str(&chunk);
        let _ = app.emit(
            "cloud-transcript",
            CloudTranscript {
                text: output.clone(),
                model: model.into(),
            },
        );
    }
}

fn groq_sse_chunk(line: &[u8]) -> Option<String> {
    let line = std::str::from_utf8(line).ok()?;
    let data = line.trim().strip_prefix("data:")?.trim();
    if data == "[DONE]" {
        return None;
    }
    serde_json::from_str::<Value>(data)
        .ok()?
        .pointer("/choices/0/delta/content")?
        .as_str()
        .map(str::to_string)
}

async fn groq_transcribe(
    client: &reqwest::Client,
    key: &str,
    audio: Vec<u8>,
    locale: &str,
    vocabulary: Vec<String>,
) -> Result<CloudResult, String> {
    if audio.len() < MIN_AUDIO_BYTES {
        return Err(format!("cloud.audio_empty:{}", audio.len()));
    }
    if audio.len() > GROQ_MAX_AUDIO_BYTES {
        return Err("cloud.audio_too_long".into());
    }
    let audio_len = audio.len();
    let file = reqwest::multipart::Part::bytes(audio)
        .file_name("recording.wav")
        .mime_str("audio/wav")
        .map_err(|_| "cloud.audio_format".to_string())?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", file)
        .text("model", "whisper-large-v3-turbo")
        .text("response_format", "json")
        .text("temperature", "0");
    if let Some(language) = locale
        .split(['-', '_'])
        .next()
        .filter(|value| value.len() == 2)
    {
        form = form.text("language", language.to_string());
    }
    if !vocabulary.is_empty() {
        form = form.text(
            "prompt",
            vocabulary.join(", ").chars().take(300).collect::<String>(),
        );
    }
    let response = client
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
        .bearer_auth(key)
        .multipart(form)
        .send()
        .await
        .map_err(|_| "cloud.groq_connect".to_string())?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("cloud.groq_key".into());
    }
    if !response.status().is_success() {
        let status = response.status();
        // 400の実理由(Groqの本文)を切り詰めて残す。ログと画面の両方に出る。
        let detail: String = response
            .text()
            .await
            .unwrap_or_default()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(200)
            .collect();
        return Err(format!(
            "cloud.groq_failed:{} {} (audio {} bytes)",
            status.as_u16(),
            detail,
            audio_len
        ));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| "cloud.response".to_string())?;
    let text = body
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        return Err("cloud.no_speech".into());
    }
    Ok(CloudResult {
        text,
        model: "whisper-large-v3-turbo".into(),
        raw: None,
        fallback_from: None,
    })
}
