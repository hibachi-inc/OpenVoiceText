# VoiceLatte (Tauri)

VoiceLatteのWindows / macOS共通アプリ基盤。UIと状態管理はTauri + React、音声認識はOS別の小さなネイティブブリッジに分離する。

- `src/`: 共通UI
- `src-tauri/`: Tauri本体、配布設定、サイドカー権限
- `native/macos/`: Apple Speech / SpeechAnalyzerブリッジ（Swift）
- `native/windows/`: Microsoft.Windows.AI.Speechブリッジ（C#）
- `scripts/build-native.mjs`: 実行OS用ブリッジをTauri sidecar名へ配置

ブリッジは標準入力でJSON Linesを受け、標準出力にJSON Linesを返す。録音・逐次文字起こし・モデル確認/追加・整形・貼り付け・前面アプリ判定・修飾キー単体の長押しを実装している。

共通UIには、常駐HUD、履歴と長文詳細、単語登録、金額表記の補正、アプリ種別ごとの整形プロンプト、通常/長押しショートカットがある。設定と履歴は端末内のWebViewストレージへ保存する。

## 開発

```bash
npm install
npm run test:text
npm run test:native
npm run tauri dev
```

macOSはSpeechAnalyzerを優先し、準備中の音声を最大15秒保持してSFSpeechRecognizerへ自動フォールバックする。

WindowsはWindows App SDK `2.2.2-Experimental9`のMicrosoft.Windows.AI.Speechを優先し、利用できない場合はSystem.Speechへ自動フォールバックする。Microsoft.Windows.AI.Speechは現時点でExperimental APIのため、Windows 11の対応ビルドと、`native/windows/Package.appxmanifest`の`systemAIModels` capabilityを使うMSIX配布が必要。
