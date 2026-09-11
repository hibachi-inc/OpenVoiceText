<div align="center">

<img src="./assets/logo.png" width="120" alt="VoiceLatte logo">

# VoiceLatte

### Push-to-talk voice input for macOS. Transcribe on-device, refine with AI.

[Download](https://github.com/hibachi-inc/OpenVoiceText/releases) ·
[Features](#-features) ·
[Privacy](#-privacy) ·
[日本語](./README.md)

<br>

![License](https://img.shields.io/github/license/hibachi-inc/OpenVoiceText?style=flat-square)
![macOS](https://img.shields.io/badge/macOS-Tahoe_%26_later-black?style=flat-square&logo=apple)
![Version](https://img.shields.io/badge/version-0.4.6-blue?style=flat-square)

</div>

---

<p align="center">
  <video src="https://github.com/hibachi-inc/OpenVoiceText/releases/download/v0.4.6/demo.mp4" width="860" controls></video>
</p>

## ✨ Features

- 🎙 **Push-to-talk & hold-to-talk** — tap `Control` to record, hold it to keep talking. Confirm with `Space`, cancel with `Esc`, right from the floating HUD.
- 🧠 **On-device transcription first** — Apple SpeechAnalyzer with automatic fallback to SFSpeechRecognizer. Your voice never has to leave the Mac.
- ✍️ **AI refinement that knows your screen** — Gemini / Groq polish the transcript using a screenshot of the app you're typing into. Apps that can't be captured fall back to accessibility text.
- 🪟 **Per-app prompts** — different refinement styles for chat, email, code, terminal, notes, and browser, switched automatically by the frontmost app.
- 📚 **Vocabulary & formatting** — your terms, plus automatic fixes like amount notation, applied on every pass.
- 🕘 **History with receipts** — every result keeps its raw text, refined text, and a thumbnail of the screen it came from (thumbnails auto-delete after 1 day).

## 🔒 Privacy

- Transcription runs on-device by default.
- API keys live in the macOS Keychain — never in config files.
- Screen thumbnails are downscaled and purged after 24 hours, together with history cleanup.
- Password managers, auth apps, and crypto wallets are excluded from screen capture.

## 🚀 Download

Prebuilt binaries will be attached to [Releases](https://github.com/hibachi-inc/OpenVoiceText/releases). Until then, build from source:

<details>
<summary>Build from source (macOS, Xcode + Rust required)</summary>

```bash
npm install
npm run test:text
npm run test:native
npm run tauri dev
```

On first launch, the onboarding walks through microphone, accessibility, and screen-recording permissions.

</details>

## 🛠 Tech Stack

Tauri 2 (Rust) · React · TypeScript · Swift sidecar bridge (JSON Lines over stdio)

```
src/            shared UI (HUD, history, settings)
src-tauri/      Tauri core, distribution config, sidecar wiring
native/macos/   Apple Speech / SpeechAnalyzer bridge (Swift)
```

## 📄 License

MIT — see [`LICENSE`](./LICENSE). Third-party attributions in [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md).
