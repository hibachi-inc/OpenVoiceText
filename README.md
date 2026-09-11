<div align="center">

<img src="./assets/logo.png" width="120" alt="VoiceLatte ロゴ">

# VoiceLatte

### Macのためのプッシュトーク音声入力。端末内で文字起こし、AIで整形。

[ダウンロード](https://github.com/hibachi-inc/OpenVoiceText/releases/latest/download/VoiceLatte.dmg) ·
[機能](#-機能) ·
[プライバシー](#-プライバシー) ·
[English](./README.en.md)

<br>

![License](https://img.shields.io/github/license/hibachi-inc/OpenVoiceText?style=flat-square)
![macOS](https://img.shields.io/badge/macOS-Tahoe_%26_later-black?style=flat-square&logo=apple)
![Version](https://img.shields.io/badge/version-0.4.8-blue?style=flat-square)

</div>

---

<p align="center">
  <video src="https://github.com/user-attachments/assets/aa8930ee-a219-4eea-9b18-37c88dd65abd" width="860" controls></video>
</p>

## ✨ 機能

- 🎙 **プッシュトーク＆長押し** — `Control`を押して話す、長押しで話し続ける。フローティングHUDで`Space`確定・`Esc`取消。
- 🧠 **端末内文字起こしが優先** — Apple SpeechAnalyzerを第一に、SFSpeechRecognizerへ自動縮退。音声をMacの外に出さない。
- ✍️ **画面を見て整形するAI** — 入力先アプリのスクショを参考にGemini / Groqが整形。撮れない相手だけアクセシビリティ文言で大体する。
- 🪟 **アプリ別プロンプト** — チャット・メール・コード・ターミナル・メモ・ブラウザで整形方針を自動切替。
- 📚 **単語登録と表記補正** — 用語集と金額表記の自動補正を毎回適用。
- 🕘 **証跡つき履歴** — 整形前・整形後・入力先画面の縮小版をセットで保存（縮小版は1日で自動消去）。

## 🔒 プライバシー

- 文字起こしは既定で端末内完結。
- APIキーはmacOSキーチェーン保管。設定ファイルに書かない。
- 画面の縮小版は24時間で消去。履歴消去と連動。
- パスワード管理・認証・暗号資産系アプリは撮影対象外。

## 🚀 ダウンロード

<p align="center">
  <a href="https://github.com/hibachi-inc/OpenVoiceText/releases/latest/download/VoiceLatte.dmg">
    <img src="https://img.shields.io/badge/Mac版をダウンロード-Apple_Silicon-black?style=for-the-badge&logo=apple" alt="Mac版をダウンロード">
  </a>
</p>

macOS Tahoe以降・Apple Silicon専用。Intel Macには対応していません。過去版や更新履歴は[Releases](https://github.com/hibachi-inc/OpenVoiceText/releases)からどうぞ。

<details>
<summary>ソースからビルド（macOS、Xcode + Rustが必要）</summary>

```bash
npm install
npm run test:text
npm run test:native
npm run tauri dev
```

初回起動時のオンボーディングでマイク・アクセシビリティ・画面収録の権限を案内します。

</details>

## 🛠 技術構成

Tauri 2（Rust）· React · TypeScript · Swift製サイドカーブリッジ（JSON Lines / stdio）

```
src/            共通UI（HUD・履歴・設定）
src-tauri/      Tauri本体・配布設定・サイドカー配線
native/macos/   Apple Speech / SpeechAnalyzerブリッジ（Swift）
```

## 🤝 貢献する

バグ報告・機能要望・コードの持ち込みはすべてGitHubで受け付けています。お問い合わせフォームはありません。Claude CodeやCodexなどのAIエージェントに接続して出すのがおすすめです。

```bash
npx skills add hibachi-inc/OpenVoiceText --skill voicelatte-contributor -g
```

インストール後にエージェントで `$voicelatte-contributor` と呼び出すと、報告の型・証跡の集め方・開発手順を案内します。

## 📄 ライセンス

MIT（[`LICENSE`](./LICENSE)参照）。第三者コードの帰属は[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)参照。
