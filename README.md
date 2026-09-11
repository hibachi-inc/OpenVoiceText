<div align="center">

<img src="./assets/logo.png" width="120" alt="VoiceLatte ロゴ">

# VoiceLatte

### 話すだけで、きちんとした文章になるMacの音声入力。

[ダウンロード](https://github.com/hibachi-inc/OpenVoiceText/releases/latest/download/VoiceLatte.dmg) ·
[機能](#機能) ·
[プライバシー](#プライバシー) ·
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

## 機能

- **話すだけで文字になる** — `Control`を押して話すだけ。手はキーボードから離さない。`Space`で確定、`Esc`で取り消し。
- **言い間違いはAIが整える** — 「えーっと」「あのー」を取り除き、場面に合った文体に直す。
- **相手に合わせて書き分ける** — チャットはくだけた文に、メールは丁寧文に。今開いている相手を見て自動で切り替わる。
- **専門用語もそのまま残る** — 登録した用語や金額表記を正しく保つ。
- **いつでも見返せる** — 整形前と整形後をセットで履歴に保存。
- **音声はMacの外に出ない** — 文字起こしは端末内で完結する。

## プライバシー

- 文字起こしは既定で端末内完結。
- APIキーはmacOSキーチェーン保管。設定ファイルに書かない。
- 画面の縮小版は24時間で消去。履歴消去と連動。
- パスワード管理・認証・暗号資産系アプリは撮影対象外。

## ダウンロード

<p align="center">
  <a href="https://github.com/hibachi-inc/OpenVoiceText/releases/latest/download/VoiceLatte.dmg">
    <img src="https://img.shields.io/badge/Mac版をダウンロード-Apple_Silicon-black?style=for-the-badge&logo=apple" alt="Mac版をダウンロード">
  </a>
</p>

macOS Tahoe以降・Apple Silicon専用。Intel Macには対応していません。過去版と更新履歴は[Releases](https://github.com/hibachi-inc/OpenVoiceText/releases)にあります。

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

## 技術構成

Tauri 2（Rust）· React · TypeScript · Swift製サイドカーブリッジ（JSON Lines / stdio）

```
src/            共通UI（HUD・履歴・設定）
src-tauri/      Tauri本体・配布設定・サイドカー配線
native/macos/   Apple Speech / SpeechAnalyzerブリッジ（Swift）
```

## 貢献する

バグ報告・機能要望・コードの持ち込みはすべてGitHubで受け付けています。お問い合わせフォームはありません。

**セットアップなし（おすすめ）**：アプリの「アプリについて」→「バグ報告／機能要望」→ AIボタンで開き、指示どおり進めます。GitHub連携があれば調査から起票までWebで完結します。

**ローカルエージェント**：Claude CodeやCodexにスキルを入れると開発まで一気通貫です。

```bash
npx skills add hibachi-inc/OpenVoiceText --skill voicelatte-contributor -g
```

インストール後にエージェントで `$voicelatte-contributor` と呼び出すと、報告の型・証跡の集め方・開発手順を案内します。

## ライセンス

MIT（[`LICENSE`](./LICENSE)参照）。第三者コードの帰属は[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)参照。
