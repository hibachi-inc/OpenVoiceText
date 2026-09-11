# VoiceLatte (Tauri)

オープンソースのMac向け音声入力と高精度変換アプリ。UIと状態管理はTauri + React、音声認識は小さなネイティブブリッジに分離する。

- `src/`: 共通UI
- `src-tauri/`: Tauri本体、配布設定、サイドカー権限
- `native/macos/`: Apple Speech / SpeechAnalyzerブリッジ（Swift）
- `scripts/build-native.mjs`: 実行OS用ブリッジをTauri sidecar名へ配置

ブリッジは標準入力でJSON Linesを受け、標準出力にJSON Linesを返す。録音・逐次文字起こし・モデル確認/追加・整形・貼り付け・前面アプリ判定・修飾キー単体の長押しを実装している。

共通UIには、常駐HUD、履歴と長文詳細、辞書登録、金額表記の補正、アプリ種別ごとの整形プロンプト、通常/長押しショートカットがある。設定と履歴は端末内のWebViewストレージへ保存する。

## 開発

```bash
npm install
npm run test:text
npm run test:native
npm run tauri dev
```

macOSはSpeechAnalyzerを優先し、準備中の音声を最大15秒保持してSFSpeechRecognizerへ自動フォールバックする。

## ライセンス

MIT License（`LICENSE` 参照）。第三者コードの帰属は `THIRD-PARTY-NOTICES.md` 参照。
