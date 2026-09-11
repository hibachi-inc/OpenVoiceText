<div align="center">

<img src="./assets/logo.png" width="120" alt="VoiceLatte ロゴ">

# VoiceLatte

## 無料で、有料級の音声入力体験を。

### 話すだけで、きちんとした文章になるMacの音声入力。

**OpenVoiceText は、VoiceLatteをみんなで育てるオープンソースプロジェクトです。**  
AIで一人でもかなり大きなものを作れるようになった今、次は**AIを使って、みんなでもっと大きなものを作る**ことに挑戦したいと思っています。

[Mac版をダウンロード](https://github.com/hibachi-inc/OpenVoiceText/releases/latest/download/VoiceLatte.dmg) ·
[開発に参加する](#一緒に作りませんか) ·
[機能](#機能) ·
[English](./README.en.md)

<br>

![License](https://img.shields.io/github/license/hibachi-inc/OpenVoiceText?style=flat-square)
![macOS](https://img.shields.io/badge/macOS-Tahoe_%26_later-black?style=flat-square&logo=apple)
![Release](https://img.shields.io/github/v/release/hibachi-inc/OpenVoiceText?style=flat-square)
![Contributions welcome](https://img.shields.io/badge/初めてのOSS参加-歓迎-brightgreen?style=flat-square)

</div>

---

<p align="center">
  <video src="https://github.com/user-attachments/assets/aa8930ee-a219-4eea-9b18-37c88dd65abd" width="860" controls></video>
</p>

## 無料で、有料級の音声入力体験を

VoiceLatteは、**高品質なAI音声入力を、できるだけ無料で使えるようにする**ことを目指しています。

きっかけは、Typelessの音声入力・文章変換精度に感動したことでした。

**「この体験を、Google AI Studioなどで提供されている無料枠のAPIやローカル処理を組み合わせて再現できないか？」**

そんな発想からVoiceLatteを作っています。

もちろん、有料のAPIキーや高性能なモデルを使うこともできます。  
ただ、それだけで高精度を実現するのではなく、**誰でも使える無料枠やローカル処理を活用しながら、どこまで有料サービス級の体験に近づけられるか**に挑戦したいと考えています。

高性能なAIを一部の人だけのものにせず、誰でも日常的に使える道具にする。  
その実験も含めて、OpenVoiceTextとしてオープンソースで開発しています。

## 一緒に作りませんか？

AIのおかげで、個人でもかなり大きなものを作れる時代になりました。

でも、せっかく作れる範囲が広がったなら、次は**一人で作れるものの限界を超えてみたい。**  
OpenVoiceTextでは、そんな人を大歓迎しています。

OSS経験は問いません。コードをすべて自分で書けなくても大丈夫です。  
ChatGPT、Codex、Claude CodeなどのAIを使いながら、実際に使われるプロダクトを一緒に育ててみませんか。

**一人のAI開発から、みんなで作るAI開発へ。**  
VoiceLatteをその実験の場所にしたいと思っています。

- **OSSへの参加が初めてでも歓迎**です。
- **Issue・PR・レビューは日本語でOK**です。
- **ChatGPT / Codex / Claude Codeなど、AIを使った開発も大歓迎**です。
- コードを書かなくても、**「ここが使いづらい」「こんな機能がほしい」**という提案だけで立派なContributionです。

### 🚀 まずは、このリポジトリをあなたのAIに投げてみてください

「参加してみたいけど、何をすればいいかわからない」という人は、まず普段使っているAIにこのリポジトリのURLと、下のプロンプトをそのまま渡してみてください。

**ワンクリックで試す：** [ChatGPT](https://chatgpt.com/?q=%E3%81%93%E3%81%AEOSS%E3%81%AB%E5%8F%82%E5%8A%A0%E3%81%97%E3%81%A6%E3%81%BF%E3%81%9F%E3%81%84%E3%81%A7%E3%81%99%E3%80%82%0A%E3%83%AA%E3%83%9D%E3%82%B8%E3%83%88%E3%83%AA%3A%20https%3A%2F%2Fgithub.com%2Fhibachi-inc%2FOpenVoiceText%0A%0A%E7%A7%81%E3%81%8C%E5%8F%82%E5%8A%A0%E3%81%99%E3%82%8B%E3%81%AA%E3%82%89%E3%80%81%E3%81%BE%E3%81%9A%E4%BD%95%E3%82%92%E3%81%97%E3%81%A6%E3%81%BF%E3%82%8B%E3%81%AE%E3%81%8C%E3%81%84%E3%81%84%E3%81%A8%E6%80%9D%E3%81%86%EF%BC%9F%0A%E3%83%AA%E3%83%9D%E3%82%B8%E3%83%88%E3%83%AA%E3%82%92%E8%AA%AD%E3%82%93%E3%81%A7%E3%80%81%E4%BB%8A%E3%81%AE%E8%AA%B2%E9%A1%8C%E3%81%AE%E4%B8%AD%E3%81%8B%E3%82%89%E5%8F%96%E3%82%8A%E7%B5%84%E3%81%BF%E3%82%84%E3%81%99%E3%81%8F%E3%80%81%E5%AE%9F%E9%9A%9B%E3%81%AB%E3%83%97%E3%83%AD%E3%82%B8%E3%82%A7%E3%82%AF%E3%83%88%E3%81%AE%E5%BD%B9%E3%81%AB%E7%AB%8B%E3%81%A1%E3%81%9D%E3%81%86%E3%81%AA%E3%82%82%E3%81%AE%E3%82%92%E6%8F%90%E6%A1%88%E3%81%97%E3%81%A6%E3%81%8F%E3%81%A0%E3%81%95%E3%81%84%E3%80%82) ｜ [Claude](https://claude.ai/new?q=%E3%81%93%E3%81%AEOSS%E3%81%AB%E5%8F%82%E5%8A%A0%E3%81%97%E3%81%A6%E3%81%BF%E3%81%9F%E3%81%84%E3%81%A7%E3%81%99%E3%80%82%0A%E3%83%AA%E3%83%9D%E3%82%B8%E3%83%88%E3%83%AA%3A%20https%3A%2F%2Fgithub.com%2Fhibachi-inc%2FOpenVoiceText%0A%0A%E7%A7%81%E3%81%8C%E5%8F%82%E5%8A%A0%E3%81%99%E3%82%8B%E3%81%AA%E3%82%89%E3%80%81%E3%81%BE%E3%81%9A%E4%BD%95%E3%82%92%E3%81%97%E3%81%A6%E3%81%BF%E3%82%8B%E3%81%AE%E3%81%8C%E3%81%84%E3%81%84%E3%81%A8%E6%80%9D%E3%81%86%EF%BC%9F%0A%E3%83%AA%E3%83%9D%E3%82%B8%E3%83%88%E3%83%AA%E3%82%92%E8%AA%AD%E3%82%93%E3%81%A7%E3%80%81%E4%BB%8A%E3%81%AE%E8%AA%B2%E9%A1%8C%E3%81%AE%E4%B8%AD%E3%81%8B%E3%82%89%E5%8F%96%E3%82%8A%E7%B5%84%E3%81%BF%E3%82%84%E3%81%99%E3%81%8F%E3%80%81%E5%AE%9F%E9%9A%9B%E3%81%AB%E3%83%97%E3%83%AD%E3%82%B8%E3%82%A7%E3%82%AF%E3%83%88%E3%81%AE%E5%BD%B9%E3%81%AB%E7%AB%8B%E3%81%A1%E3%81%9D%E3%81%86%E3%81%AA%E3%82%82%E3%81%AE%E3%82%92%E6%8F%90%E6%A1%88%E3%81%97%E3%81%A6%E3%81%8F%E3%81%A0%E3%81%95%E3%81%84%E3%80%82) ｜ [Perplexity](https://www.perplexity.ai/search?q=%E3%81%93%E3%81%AEOSS%E3%81%AB%E5%8F%82%E5%8A%A0%E3%81%97%E3%81%A6%E3%81%BF%E3%81%9F%E3%81%84%E3%81%A7%E3%81%99%E3%80%82%0A%E3%83%AA%E3%83%9D%E3%82%B8%E3%83%88%E3%83%AA%3A%20https%3A%2F%2Fgithub.com%2Fhibachi-inc%2FOpenVoiceText%0A%0A%E7%A7%81%E3%81%8C%E5%8F%82%E5%8A%A0%E3%81%99%E3%82%8B%E3%81%AA%E3%82%89%E3%80%81%E3%81%BE%E3%81%9A%E4%BD%95%E3%82%92%E3%81%97%E3%81%A6%E3%81%BF%E3%82%8B%E3%81%AE%E3%81%8C%E3%81%84%E3%81%84%E3%81%A8%E6%80%9D%E3%81%86%EF%BC%9F%0A%E3%83%AA%E3%83%9D%E3%82%B8%E3%83%88%E3%83%AA%E3%82%92%E8%AA%AD%E3%82%93%E3%81%A7%E3%80%81%E4%BB%8A%E3%81%AE%E8%AA%B2%E9%A1%8C%E3%81%AE%E4%B8%AD%E3%81%8B%E3%82%89%E5%8F%96%E3%82%8A%E7%B5%84%E3%81%BF%E3%82%84%E3%81%99%E3%81%8F%E3%80%81%E5%AE%9F%E9%9A%9B%E3%81%AB%E3%83%97%E3%83%AD%E3%82%B8%E3%82%A7%E3%82%AF%E3%83%88%E3%81%AE%E5%BD%B9%E3%81%AB%E7%AB%8B%E3%81%A1%E3%81%9D%E3%81%86%E3%81%AA%E3%82%82%E3%81%AE%E3%82%92%E6%8F%90%E6%A1%88%E3%81%97%E3%81%A6%E3%81%8F%E3%81%A0%E3%81%95%E3%81%84%E3%80%82)

```text
https://github.com/hibachi-inc/OpenVoiceText

このOSSに参加してみたいです。
私が参加するなら、まず何をしてみるのがいいと思う？
リポジトリを読んで、今の課題の中から取り組みやすく、実際にプロジェクトの役に立ちそうなものを提案してください。
```

最初からIssueやコードを理解している必要はありません。  
**「自分なら何ができそう？」とAIに相談するところから、Contributionを始めてみてください。**

気になるものが見つかったら、そのままAIに「じゃあこれを進めたい。次に何をすればいい？」と聞けばOKです。

### 🪟 Windows / Linux対応を一緒に作りたいです

現在のVoiceLatteは**macOS限定**です。参加できる人をもっと増やすためにも、できるだけ早くWindows / Linuxにも対応したいと考えています。

アプリ本体はTauri製なので、WindowsやLinuxでもアプリの土台自体は動かせます。ただし、音声認識・グローバルショートカット・アクセシビリティなど、**OSとつながる部分はまだmacOS向けの実装が中心**です。そのため、現状ではWindows / Linux上で起動できても、VoiceLatteとして必要な機能はまだ正常に動かないはずです。

特に**Windowsユーザー・Windows開発に詳しい皆さんのお力をお借りしたいです。**  
「Windowsで一度動かしてみる」「動かない箇所をIssueにする」「代替APIを調べる」といったところからでも大歓迎です。

Windows / Linux対応そのものを、みんなで進めるOSS開発の題材にできたらと思っています。

### 🤖 AIに頼んで、そのまま参加できます

GitHubと連携したAIやローカルのコーディングエージェントに、このリポジトリを渡して話しかけてみてください。

たとえば：

```text
このリポジトリを読んで、初心者でも取り組みやすい改善案を3つ考えて。
```

```text
このアプリに〇〇機能を追加したい。実装方法を調べて、必要ならIssueを作って。
```

```text
このIssueを調査して、修正案を作って。テストまで確認してPRにできる状態にして。
```

「何を作ればいいかわからない」状態からでも大丈夫です。  
まずはAIと一緒にリポジトリを読んで、小さな改善から参加してみてください。

👉 [Issuesを見る](https://github.com/hibachi-inc/OpenVoiceText/issues)

### AIエージェント向けContributor Skill

Claude CodeやCodexなどのローカルエージェントでは、Contributor Skillを入れると、報告の型・証跡の集め方・開発手順まで案内できます。

```bash
npx skills add hibachi-inc/OpenVoiceText --skill voicelatte-contributor -g
```

インストール後、エージェントで `$voicelatte-contributor` と呼び出してください。

---

## VoiceLatteとは

VoiceLatteは、**話した内容をそのまま入力するのではなく、AIで読みやすい文章に整えて入力する**Mac向け音声入力アプリです。

会話のように自然に話しても、チャットならチャットらしく、メールならメールらしい文章に整えて入力できます。

OpenVoiceTextはこのVoiceLatteを開発・公開するOSSプロジェクトです。

## 機能

- **話すだけで文字になる** — `Control`を押して話すだけ。手はキーボードから離さない。`Space`で確定、`Esc`で取り消し。
- **言い間違いはAIが整える** — 「えーっと」「あのー」を取り除き、場面に合った文体に直す。
- **相手に合わせて書き分ける** — チャットはくだけた文に、メールは丁寧文に。今開いている相手を見て自動で切り替わる。
- **専門用語もそのまま残る** — 登録した用語や金額表記を正しく保つ。
- **いつでも見返せる** — 整形前と整形後をセットで履歴に保存。
- **音声はMacの外に出ない** — 文字起こしは端末内で完結する。

## ダウンロード

<p align="center">
  <a href="https://github.com/hibachi-inc/OpenVoiceText/releases/latest/download/VoiceLatte.dmg">
    <img src="https://img.shields.io/badge/Mac版をダウンロード-Apple_Silicon-black?style=for-the-badge&logo=apple" alt="Mac版をダウンロード">
  </a>
</p>

macOS Tahoe以降・Apple Silicon専用。Intel Macには対応していません。過去版と更新履歴は[Releases](https://github.com/hibachi-inc/OpenVoiceText/releases)にあります。

## こんなContributionを歓迎しています

大きな機能開発だけがContributionではありません。

- バグを見つけてIssueを書く
- 「こうしたら使いやすそう」というアイデアを出す
- UIや文章を改善する
- ドキュメントを直す
- テストを追加する
- 新しい機能を実装する
- 既存Issueの原因をAIと一緒に調査する
- 他の人のPRを試してフィードバックする

**最初のContributionは小さいほど歓迎です。**  
このリポジトリをきっかけに、一緒にものを作ったことがある人が増えていくことを大切にしています。

## ソースから動かす

<details>
<summary>macOSでのセットアップ（Xcode + Rustが必要）</summary>

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

```text
src/            共通UI（HUD・履歴・設定）
src-tauri/      Tauri本体・配布設定・サイドカー配線
native/macos/   Apple Speech / SpeechAnalyzerブリッジ（Swift）
```

## プライバシー

- 文字起こしは既定で端末内完結。
- APIキーはmacOSキーチェーン保管。設定ファイルに書かない。
- 画面の縮小版は24時間で消去。履歴消去と連動。
- パスワード管理・認証・暗号資産系アプリは撮影対象外。

## バグ報告・機能要望

バグ報告・機能要望・コードの持ち込みはすべてGitHubで受け付けています。

アプリからは **「アプリについて」→「バグ報告／機能要望」→ AIボタン** で進めます。GitHub連携があれば、調査からIssue作成までWeb上で進められます。

もちろん、[GitHub Issues](https://github.com/hibachi-inc/OpenVoiceText/issues)へ直接投稿してもOKです。

## ライセンス

MIT（[`LICENSE`](./LICENSE)参照）。第三者コードの帰属は[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)参照。
