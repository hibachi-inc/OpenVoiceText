#[tauri::command]
pub async fn cloud_transcribe(
    app: AppHandle,
    state: State<'_, CloudState>,
    capture_id: String,
    provider: String,
    prompt: String,
    locale: String,
    vocabulary: Vec<String>,
    screen_context: String,
    model: Option<String>,
) -> Result<CloudResult, String> {
    let path = state
        .captures
        .lock()
        .map_err(|_| "cloud.capture_read")?
        .remove(&capture_id)
        .ok_or_else(|| "cloud.capture_missing".to_string())?;
    let _guard = TempAudio(path.clone());
    let audio = fs::read(&path).map_err(|_| "cloud.capture_read".to_string())?;
    let key = resolve_key(&state, &provider)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|_| "cloud.connect".to_string())?;

    match provider.as_str() {
        "groq" => groq_transcribe(&client, &key, audio, &locale, vocabulary).await,
        "gemini" => {
            gemini_transcribe(
                &client,
                &key,
                audio,
                &prompt,
                &locale,
                &screen_context,
                model,
                &app,
            )
            .await
        }
        _ => Err("cloud.invalid_provider".into()),
    }
}

/// Gemini専用の一本化ルート：音声の文字起こしとAI整形を1回の呼び出しで行う。
/// 音声・画面画像・整形プロンプトを同時に投げ、整形済みテキストを返す。
/// 明示モデルがなければ内蔵チェーン（Flash→Flash-Lite）でフォールバックする。
#[tauri::command]
pub async fn cloud_transcribe_refine(
    app: AppHandle,
    state: State<'_, CloudState>,
    capture_id: String,
    prompt: String,
    locale: String,
    screen_context: String,
    model: Option<String>,
    image: Option<String>,
    image_mime: Option<String>,
) -> Result<CloudResult, String> {
    let path = state
        .captures
        .lock()
        .map_err(|_| "cloud.capture_read")?
        .remove(&capture_id)
        .ok_or_else(|| "cloud.capture_missing".to_string())?;
    let _guard = TempAudio(path.clone());
    let audio = fs::read(&path).map_err(|_| "cloud.capture_read".to_string())?;
    if audio.len() < MIN_AUDIO_BYTES {
        return Err(format!("cloud.audio_empty:{}", audio.len()));
    }
    if audio.len() > GEMINI_MAX_AUDIO_BYTES {
        return Err("cloud.audio_too_long".into());
    }
    let key = resolve_key(&state, "gemini")?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|_| "cloud.connect".to_string())?;
    // 画像添付が見込まれる場合は画面テキストを送らない（重複・矛盾の元）。
    let screen_context = if image_will_attach("gemini", model.as_deref(), &image) {
        String::new()
    } else {
        screen_context
    };
    let audio = BASE64.encode(audio);
    let instruction = format!(
        "Transcribe the attached audio in {locale}, then apply the refinement instruction below to the transcript. Return ONLY a JSON object like {{\"transcript\": \"...\", \"refined\": \"...\"}} holding the raw transcript and the refined text. Do not add explanations.\n\n{prompt}"
    );
    let screen_context = tail_chars(screen_context.trim(), 10_000);
    let explicit: Option<String> = model
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    let mut models = Vec::new();
    if let Some(m) = explicit {
        models.push(m);
    }
    for m in GEMINI_MODELS {
        if models.iter().all(|x| x != m) {
            models.push(m.to_string());
        }
    }
    // 音声非対応モデルは結合ルートで試さない（フロントでも弾くが保険）。
    models.retain(|m| model_supports_audio("gemini", m));
    let mut last_error = "cloud.gemini_failed".to_string();
    let mut fell_back_from: Option<String> = None;
    let mut dynamic_done = false;
    let mut i = 0;
    while i < models.len() {
        let model = models[i].clone();
        match stream_gemini_model(
            &client,
            &key,
            &model,
            Some(&audio),
            &instruction,
            &screen_context,
            image.as_deref(),
            &sanitize_image_mime(image_mime.clone()),
            true,
            &app,
        )
        .await
        {
            Ok(text) => {
                let (transcript, refined) = parse_combined_output(&text);
                return Ok(CloudResult {
                    text: refined,
                    model,
                    raw: transcript,
                    fallback_from: fell_back_from,
                });
            }
            Err(error) if error.fallback => {
                if fell_back_from.is_none() {
                    fell_back_from = Some(format!("{model}: {}", error.message));
                }
                last_error = error.message;
                i += 1;
                if i >= models.len() && !dynamic_done {
                    dynamic_done = true;
                    models.extend(gemini_dynamic_fallbacks(&client, &key, &models).await);
                }
            }
            Err(error) => return Err(error.message),
        }
    }
    Err(last_error)
}

#[tauri::command]
pub async fn cloud_refine(
    app: AppHandle,
    state: State<'_, CloudState>,
    provider: String,
    text: String,
    prompt: String,
    screen_context: String,
    model: Option<String>,
    image: Option<String>,
    image_mime: Option<String>,
) -> Result<CloudResult, String> {
    if text.trim().is_empty() {
        return Err("cloud.no_speech".into());
    }
    let key = resolve_key(&state, &provider)?;
    // 整形は小ペイロードのため短めにし、停滞時の切り替えを速くする（転写は音声のため60秒維持）。
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "cloud.connect".to_string())?;
    // 画像添付が見込まれる場合は画面テキストを送らない（重複・矛盾の元）。
    // 履歴への保存は呼び出し側で行うため確認用途には残る。
    let screen_context = if image_will_attach(&provider, model.as_deref(), &image) {
        String::new()
    } else {
        screen_context
    };
    let input = refinement_input(&prompt, &text, &screen_context);
    // 設定画面で明示指定があれば先頭に足す。失敗時は内蔵チェーンに委ね、呼び出し側はlocalへさらに委ねる。
    // 内蔵候補との重複は除く。
    let explicit: Option<String> = model
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    match provider.as_str() {
        "groq" => {
            let mut last_error = "cloud.groq_failed".to_string();
            let mut fell_back_from: Option<String> = None;
            let mut models = groq_refine_chain(explicit.clone());
            let mut i = 0;
            while i < models.len() {
                let model = models[i].clone();
                match stream_groq_refinement(&client, &key, &model, &input, image.as_deref(), &app)
                    .await
                {
                    Ok(text) => {
                        return Ok(CloudResult {
                            text,
                            model,
                            raw: None,
                            fallback_from: fell_back_from,
                        })
                    }
                    Err(error) if error.fallback => {
                        if fell_back_from.is_none() {
                            fell_back_from = Some(format!("{model}: {}", error.message));
                        }
                        last_error = error.message;
                        i += 1;
                    }
                    Err(error) => return Err(error.message),
                }
            }
            Err(last_error)
        }
        "gemini" => {
            let mut last_error = "cloud.gemini_failed".to_string();
            let mut fell_back_from: Option<String> = None;
            let mut models = gemini_chain(explicit.clone());
            let mut dynamic_done = false;
            let mut i = 0;
            while i < models.len() {
                let model = models[i].clone();
                match stream_gemini_model(
                    &client,
                    &key,
                    &model,
                    None,
                    &input,
                    "",
                    image.as_deref(),
                    &sanitize_image_mime(image_mime.clone()),
                    false,
                    &app,
                )
                .await
                {
                    Ok(text) => {
                        return Ok(CloudResult {
                            text,
                            model,
                            raw: None,
                            fallback_from: fell_back_from,
                        })
                    }
                    Err(error) if error.fallback => {
                        if fell_back_from.is_none() {
                            fell_back_from = Some(format!("{model}: {}", error.message));
                        }
                        last_error = error.message;
                        i += 1;
                        if i >= models.len() && !dynamic_done {
                            dynamic_done = true;
                            models.extend(gemini_dynamic_fallbacks(&client, &key, &models).await);
                        }
                    }
                    Err(error) => return Err(error.message),
                }
            }
            Err(last_error)
        }
        _ => Err("cloud.invalid_provider".into()),
    }
}
