<div align="center">

<img src="./assets/logo.png" width="120" alt="VoiceLatte logo">

# VoiceLatte

### Talk, and get clean text. Voice input for macOS.

[Download](https://github.com/hibachi-inc/OpenVoiceText/releases/latest/download/VoiceLatte.dmg) ·
[Features](#features) ·
[Privacy](#privacy) ·
[日本語](./README.md)

<br>

![License](https://img.shields.io/github/license/hibachi-inc/OpenVoiceText?style=flat-square)
![macOS](https://img.shields.io/badge/macOS-Tahoe_%26_later-black?style=flat-square&logo=apple)
![Version](https://img.shields.io/badge/version-0.4.9-blue?style=flat-square)

</div>

---

<p align="center">
  <video src="https://github.com/user-attachments/assets/aa8930ee-a219-4eea-9b18-37c88dd65abd" width="860" controls></video>
</p>

## Features

- **Just talk to type** — hold `Control` and speak. Hands stay on the keyboard. `Space` to confirm, `Esc` to cancel.
- **AI cleans up the rest** — removes fillers and shapes the text to fit the occasion.
- **Writes the way each app expects** — casual in chat, polite in email. Switches automatically to match what's open.
- **Keeps your terms intact** — registered vocabulary and amount formatting stay correct.
- **Always reviewable** — before and after kept together in history.
- **Your voice never leaves the Mac** — transcription finishes on-device.

## Privacy

- Transcription runs on-device by default.
- API keys live in the macOS Keychain — never in config files.
- Screen thumbnails are downscaled and purged after 24 hours, together with history cleanup.
- Password managers, auth apps, and crypto wallets are excluded from screen capture.

## Download

<p align="center">
  <a href="https://github.com/hibachi-inc/OpenVoiceText/releases/latest/download/VoiceLatte.dmg">
    <img src="https://img.shields.io/badge/Download_for_Mac-Apple_Silicon-black?style=for-the-badge&logo=apple" alt="Download for Mac">
  </a>
</p>

macOS Tahoe or later, Apple Silicon only. Intel Macs are not supported. Older versions and changelogs live in [Releases](https://github.com/hibachi-inc/OpenVoiceText/releases).

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

## Tech Stack

Tauri 2 (Rust) · React · TypeScript · Swift sidecar bridge (JSON Lines over stdio)

```
src/            shared UI (HUD, history, settings)
src-tauri/      Tauri core, distribution config, sidecar wiring
native/macos/   Apple Speech / SpeechAnalyzer bridge (Swift)
```

## Contribute

Bug reports, feature requests, and code contributions all go through GitHub — there is no contact form.

**No setup (recommended)**: in the app, open About → Report a bug / Request a feature → open with an AI button and follow the instructions. With GitHub connected, investigation to filing completes on the web.

**Local agents**: install the skill in Claude Code or Codex to go all the way to development.

```bash
npx skills add hibachi-inc/OpenVoiceText --skill voicelatte-contributor -g
```

After installing, invoke `$voicelatte-contributor` in your agent and it will walk you through report formats, evidence collection, and development steps.

## License

MIT — see [`LICENSE`](./LICENSE). Third-party attributions in [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md).
