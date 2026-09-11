# 開発手順

## 構成

- `src/` — 共通UI（HUD・履歴・設定。React + TypeScript）
- `src-tauri/` — Tauri本体（Rust）・配布設定・サイドカー配線
- `native/macos/` — Apple Speech / SpeechAnalyzerブリッジ（Swift。JSON Linesをstdioで返す）
- `scripts/` — ネイティブビルド・テスト用スクリプト

## コマンド

```bash
npm install
npm run test:text      # テキスト処理の単体テスト
npm run test:native    # ブリッジの結合テスト（ビルド含む）
npx tsc --noEmit       # 型チェック
npm run tauri dev      # 開発起動
bash voicelatte-dev.command  # デバッグビルド＋起動（常用）
```

## 注意

- リポジトリのディレクトリを移動・改名したら `native/macos/.build` を消し、`src-tauri` で `cargo clean` する（Swift/Rustのキャッシュが絶対パスを掴んで壊れる）。
- 設定と履歴は端末内のWebViewストレージ。調査で開くときは読み取り専用にする。
- コミット文は英語・命令形（例: `fix: ...`）。起動確認までが1単位。
- 修正後は関連する最小のテストを実行し、結果をPR本文に書く。テストがなければ無いと書く。
