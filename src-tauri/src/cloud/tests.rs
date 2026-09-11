#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gemini_fallback_chain_is_stable() {
        // 安い順：2.5 Lite → 2.5 → 3.5 Lite → 3.5。
        assert_eq!(
            GEMINI_MODELS,
            [
                "gemini-2.5-flash",
                "gemini-3.5-flash-lite",
                "gemini-3.5-flash",
                "gemma-4-26b-a4b-it",
                "gemma-4-31b-it",
            ]
        );
    }

    #[test]
    fn gemini_chain_puts_explicit_model_first() {
        assert_eq!(
            gemini_chain(None),
            [
                "gemini-2.5-flash",
                "gemini-3.5-flash-lite",
                "gemini-3.5-flash",
                "gemma-4-26b-a4b-it",
                "gemma-4-31b-it",
            ]
        );
        assert_eq!(
            gemini_chain(Some("custom-model".into())),
            [
                "custom-model",
                "gemini-2.5-flash",
                "gemini-3.5-flash-lite",
                "gemini-3.5-flash",
                "gemma-4-26b-a4b-it",
                "gemma-4-31b-it",
            ]
        );
        assert_eq!(
            gemini_chain(Some("gemini-2.5-flash".into())),
            [
                "gemini-2.5-flash",
                "gemini-3.5-flash-lite",
                "gemini-3.5-flash",
                "gemma-4-26b-a4b-it",
                "gemma-4-31b-it",
            ]
        );
    }

    #[test]
    fn dynamic_fallback_picks_untried_flash_models() {
        let tried = vec!["gemini-flash-latest".to_string()];
        assert!(is_dynamic_fallback_candidate(
            "gemini-flash-lite-latest",
            &tried
        ));
        assert!(is_dynamic_fallback_candidate("gemini-2.5-flash", &tried));
        // Tried, non-flash, and image models are excluded.
        assert!(!is_dynamic_fallback_candidate(
            "gemini-flash-latest",
            &tried
        ));
        assert!(!is_dynamic_fallback_candidate("gemini-2.5-pro", &tried));
        assert!(!is_dynamic_fallback_candidate(
            "gemini-3.1-flash-image-preview",
            &tried
        ));
        assert!(!is_dynamic_fallback_candidate(
            "whisper-large-v3-turbo",
            &tried
        ));
    }

    #[test]
    fn groq_refine_chain_pairs_qwen_models() {
        // 明示Qwenはもう片方へ繋ぐ。デフォルトと非Qwenは単発。
        assert_eq!(
            groq_refine_chain(Some("qwen/qwen3.8-27b".into())),
            ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b"]
        );
        assert_eq!(
            groq_refine_chain(Some("qwen/qwen3.6-27b".into())),
            ["qwen/qwen3.6-27b", "qwen/qwen3.8-27b"]
        );
        assert_eq!(
            groq_refine_chain(Some("openai/gpt-oss-120b".into())),
            ["openai/gpt-oss-120b"]
        );
        assert_eq!(groq_refine_chain(None), ["openai/gpt-oss-120b"]);
    }

    #[test]
    fn diag_line_contains_attempt_details() {
        let line = diag_gemini_line("m", 100, Some("abcd"), "image/jpeg", true, "200", 12);
        assert!(line.contains("model=m"));
        assert!(line.contains("json=true"));
        assert!(line.contains("12ms"));
        let plain = diag_gemini_line("m", 0, None, "image/jpeg", false, "503", 3);
        assert!(plain.contains("image=-"));
    }

    #[test]
    fn image_attach_supersedes_screen_text() {
        let big = Some("x".repeat(100));
        let huge = Some("x".repeat(1_400_001));
        assert!(image_will_attach("gemini", None, &big));
        assert!(!image_will_attach("gemini", None, &None));
        assert!(!image_will_attach("gemini", None, &huge));
        assert!(!image_will_attach("gemini", None, &Some(String::new())));
        // Groqはvision対応モデルのときだけ省く。
        assert!(image_will_attach("groq", Some("qwen/qwen3.6-27b"), &big));
        assert!(!image_will_attach(
            "groq",
            Some("openai/gpt-oss-120b"),
            &big
        ));
        assert!(!image_will_attach("groq", None, &big));
        assert!(!image_will_attach("local", None, &big));
    }

    #[test]
    fn gemini_flash_text_model_rule() {
        assert!(is_gemini_flash_text_model("gemini-2.5-flash"));
        assert!(is_gemini_flash_text_model("gemini-3.5-flash-lite"));
        assert!(!is_gemini_flash_text_model("gemini-2.5-pro"));
        assert!(!is_gemini_flash_text_model(
            "gemini-3.1-flash-image-preview"
        ));
        assert!(!is_gemini_flash_text_model("whisper-large-v3-turbo"));
    }

    #[test]
    fn vision_capability_matches_known_catalog() {
        assert!(model_supports_vision("gemini", "gemini-flash-latest"));
        assert!(model_supports_vision("groq", "qwen/qwen3.6-27b"));
        assert!(model_supports_vision("groq", "qwen/qwen3.8-27b"));
        assert!(!model_supports_vision("groq", "openai/gpt-oss-120b"));
        assert!(!model_supports_vision("groq", "llama-3.3-70b-versatile"));
        assert!(!model_supports_vision("local", "anything"));
    }

    #[test]
    fn combined_output_parses_json_and_falls_back_to_plain_text() {
        let (raw, refined) =
            parse_combined_output(r#"{"transcript": "hello", "refined": "Hello."}"#);
        assert_eq!(raw.as_deref(), Some("hello"));
        assert_eq!(refined, "Hello.");
        let fenced = "```json\n{\"transcript\": \"a\", \"refined\": \"b\"}\n```";
        let (raw, refined) = parse_combined_output(fenced);
        assert_eq!(raw.as_deref(), Some("a"));
        assert_eq!(refined, "b");
        let (raw, refined) = parse_combined_output("just text");
        assert!(raw.is_none());
        assert_eq!(refined, "just text");
    }

    #[test]
    fn gemini_json_mode_sets_mime_type_and_schema() {
        let plain = gemini_generation_config(false, "gemini-flash-latest");
        assert!(plain.get("responseMimeType").is_none());
        assert!(plain.get("responseSchema").is_none());
        assert!(plain.get("thinkingConfig").is_some());
        let enforced = gemini_generation_config(true, "gemini-flash-latest");
        assert_eq!(enforced["responseMimeType"], json!("application/json"));
        let required = enforced["responseSchema"]["required"].as_array().unwrap();
        assert!(required.contains(&json!("transcript")));
        assert!(required.contains(&json!("refined")));
    }

    #[test]
    fn gemma_models_skip_thinking_and_audio() {
        // Gemma 26B/31B は思考パラメータも音声入力も非対応。
        let gen = gemini_generation_config(false, "gemma-4-31b-it");
        assert!(gen.get("thinkingConfig").is_none());
        assert!(!model_supports_audio("gemini", "gemma-4-26b-a4b-it"));
        assert!(!model_supports_audio("gemini", "gemma-4-31b-it"));
        assert!(model_supports_audio("gemini", "gemini-2.5-flash"));
        assert!(model_supports_audio("gemini", "gemini-3.5-flash"));
        assert!(model_supports_audio("groq", "whisper-large-v3-turbo"));
        assert!(!model_supports_audio("groq", "openai/gpt-oss-120b"));
        assert!(!model_supports_audio("unknown", "anything"));
    }

    #[test]
    fn model_eligibility_matches_task() {
        assert!(model_transcription_eligible("gemini", "gemini-2.5-flash"));
        assert!(!model_transcription_eligible("gemini", "gemma-4-31b-it"));
        assert!(model_refinement_eligible("gemini", "gemma-4-31b-it"));
        assert!(model_refinement_eligible("gemini", "gemini-2.5-flash"));
        assert!(!model_refinement_eligible(
            "gemini",
            "gemini-3.1-flash-image-preview"
        ));
        assert!(model_refinement_eligible("groq", "openai/gpt-oss-120b"));
        assert!(!model_refinement_eligible("groq", "whisper-large-v3-turbo"));
    }

    #[test]
    fn gemini_thinking_config_matches_generation() {
        // 2.5系はthinkingBudget:0、3.x系はthinkingLevel:minimal、
        // 世代不明のlite系は省略、その他は従来通りbudget:0。
        let lite25 = gemini_generation_config(false, "gemini-2.5-flash-lite");
        assert_eq!(lite25["thinkingConfig"]["thinkingBudget"], json!(0));
        let full25 = gemini_generation_config(false, "gemini-2.5-flash");
        assert_eq!(full25["thinkingConfig"]["thinkingBudget"], json!(0));
        let lite35 = gemini_generation_config(false, "gemini-3.5-flash-lite");
        assert_eq!(lite35["thinkingConfig"]["thinkingLevel"], json!("minimal"));
        assert!(lite35["thinkingConfig"].get("thinkingBudget").is_none());
        let full35 = gemini_generation_config(false, "gemini-3.5-flash");
        assert_eq!(full35["thinkingConfig"]["thinkingLevel"], json!("minimal"));
        let alias_lite = gemini_generation_config(false, "gemini-flash-lite-latest");
        assert!(alias_lite.get("thinkingConfig").is_none());
        let alias = gemini_generation_config(false, "gemini-flash-latest");
        assert_eq!(alias["thinkingConfig"]["thinkingBudget"], json!(0));
    }

    #[test]
    fn gemini_fallback_covers_bad_request_but_not_key_errors() {
        use reqwest::StatusCode;
        assert!(is_fallback_status(StatusCode::BAD_REQUEST));
        assert!(is_fallback_status(StatusCode::NOT_FOUND));
        assert!(is_fallback_status(StatusCode::TOO_MANY_REQUESTS));
        assert!(is_fallback_status(StatusCode::INTERNAL_SERVER_ERROR));
        assert!(!is_fallback_status(StatusCode::UNAUTHORIZED));
        assert!(!is_fallback_status(StatusCode::FORBIDDEN));
        assert!(!is_fallback_status(StatusCode::OK));
    }

    #[test]
    fn groq_reasoning_effort_matches_model_family() {
        // low/medium/highはGPT-OSS専用。Qwenにlowを送ると400になる。
        assert_eq!(groq_reasoning_effort("openai/gpt-oss-120b"), Some("low"));
        assert_eq!(groq_reasoning_effort("openai/gpt-oss-20b"), Some("low"));
        assert_eq!(groq_reasoning_effort("qwen/qwen3.6-27b"), Some("none"));
        assert_eq!(groq_reasoning_effort("qwen/qwen3.8-27b"), Some("none"));
        assert_eq!(groq_reasoning_effort("llama-3.3-70b-versatile"), None);
    }

    #[test]
    fn provider_model_lists_filter_to_usable_text_models() {
        let groq = groq_model_ids(&json!({ "data": [
            { "id": "llama-3.3-70b-versatile" },
            { "id": "openai/gpt-oss-120b" },
            { "id": "whisper-large-v3-turbo" },
            { "id": "canopylabs/orpheus-v1-english" },
            { "id": "meta-llama/llama-prompt-guard-2-86m" },
            { "id": "groq/compound" },
        ] }));
        assert_eq!(groq, ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]);
        let gemini = gemini_model_ids(&json!({ "models": [
            { "name": "models/gemini-flash-latest", "supportedGenerationMethods": ["generateContent"] },
            { "name": "models/embedding-001", "supportedGenerationMethods": ["embedContent"] },
            { "name": "models/gemini-flash-lite-latest", "supportedGenerationMethods": ["generateContent"] },
        ] }));
        assert_eq!(gemini, ["gemini-flash-latest", "gemini-flash-lite-latest"]);
        assert!(gemini_model_ids(&json!({})).is_empty());
    }

    #[test]
    fn groq_default_model_and_stream_parser_are_stable() {
        assert_eq!(GROQ_DEFAULT_MODEL, "openai/gpt-oss-120b");
        assert_eq!(
            groq_sse_chunk(r#"data: {"choices":[{"delta":{"content":"整形済み"}}]}"#.as_bytes()),
            Some("整形済み".into())
        );
        assert_eq!(groq_sse_chunk(b"data: [DONE]"), None);
    }

    #[test]
    fn screen_context_keeps_the_recent_tail() {
        assert_eq!(tail_chars("前の会話と直近の会話", 5), "直近の会話");
    }

    #[test]
    fn api_key_mask_only_exposes_the_last_four_characters() {
        assert_eq!(mask_api_key("secret-key-1234"), "••••••••1234");
        assert_eq!(mask_api_key("abc"), "••••••••");
    }
}
