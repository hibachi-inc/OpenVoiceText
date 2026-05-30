# OpenVoiceText — CLAUDE.md

## プロジェクト概要

macOS ネイティブ音声入力アプリ。XPC プロセス分離アーキテクチャ。

## リポジトリ構成

| リポジトリ | 公開 | 内容 |
|---|---|---|
| `hibachi-inc/OpenVoiceText` | PUBLIC (MIT) | メインアプリ + STT XPC + SimpleRefiner XPC |
| `hibachi-inc/OpenVoiceText-Pro` | PRIVATE | Pro Refiner XPC（FoundationModels 整形 + 翻訳） |

### OSS 版（このリポ）に含まれるもの
- VoiceFlowApp: メインプロセス（UI、HUD、ホットキー、Settings、履歴）
- VoiceFlowSTT: 音声認識 XPC サービス（SFSpeechRecognizer）
- VoiceFlowRefiner: **SimpleRefiner**（passthrough + 軽い整形のみ）
- VoiceFlowProtocol: XPC プロトコル定義（STT + Refiner）

### Pro 版（別リポ）に含まれるもの
- ProRefiner: FoundationModels による AI 整形 + 多言語翻訳
- 翻訳 Settings UI
- このリポを git submodule で参照

### 有料機能の境界
- **XPC プロトコル（RefinerServiceProtocol）が契約**
- `refine(text:category:reply:)` と `translate(text:targetLanguage:reply:)` を実装する XPC サービスを差し替えるだけ
- メインアプリは Refiner の実装詳細を知らない
- **StoreKit 2 IAP** で Pro アンロック（`ProUpgradeManager`）
- `#if PROFEATURES` ビルドフラグで Pro 機能の UI/ロジックを条件コンパイル

## ビルド

```bash
make run          # 開発用（ad-hoc署名）
make bundle-mas   # MAS用（App Sandbox + entitlements）
make bundle-dmg   # 直販用（Hardened Runtime + entitlements）
make dmg          # DMGビルド（Developer ID署名）
make notarize     # DMG公証
make release      # 公証 → タグ → GitHub Release
swift test        # テスト実行（69件）
```

### ビルド構成

| 構成 | Sandbox | 署名 | Sparkle | StoreKit |
|---|---|---|---|---|
| `bundle` | なし | ad-hoc | なし | あり |
| `bundle-mas` | あり | MAS entitlements | なし（MAS配信） | あり |
| `bundle-dmg` | なし | Hardened Runtime | あり（Pro リポで統合） | なし |

### Entitlements

| ファイル | 対象 | 内容 |
|---|---|---|
| `App-MAS.entitlements` | メインアプリ（MAS） | Sandbox + audio-input + network.client |
| `App-DMG.entitlements` | メインアプリ（DMG） | Hardened Runtime + audio/mic + Sparkle mach-lookup |
| `STT-XPC.entitlements` | STT XPC（MAS） | Sandbox + audio-input + microphone |
| `STT-XPC-DMG.entitlements` | STT XPC（DMG） | audio-input + microphone |
| `Refiner-XPC.entitlements` | Refiner XPC（MAS） | Sandbox のみ |

## アーキテクチャ

```
VoiceFlowApp (メインプロセス)
├── UI: FloatingHUD, MainWindow (Settings/Hotkey/Pro/Translation/History/About)
├── Core: RecordingStateMachine, RecordingCoordinator, AppContext
├── Injector: ClipboardInjector / AccessibilityInjector (#if DIRECT)
├── Store: PreferencesStore (UserDefaults), HistoryStore (SwiftData), ProUpgradeManager (StoreKit 2)
├── XPC Clients: STTXPCClient, RefinerXPCClient (with timeout)
│
├── VoiceFlowSTT.xpc — SFSpeechRecognizer + AVAudioEngine
└── VoiceFlowRefiner.xpc — SimpleRefiner (OSS) / ProRefiner (有料)
```

## ホットキー
- Carbon Hot Key API (RegisterEventHotKey) — Input Monitoring 権限不要、Sandbox 互換
- 通常録音: デフォルト ⌥Space
- 翻訳: 言語ごとにショートカット（⌃E→English, ⌃J→Japanese 等）— Pro 版のみ

## テスト（69件、4スイート）
- RecordingStateMachine: 全遷移パス + no-op + sessionID
- AppContext: 全7カテゴリ分類 + nil bundleID
- RecordingCoordinator: DI で全依存をモック化、フロー検証、連続セッション、cancelパス、safetyTimer、disconnect中
- SimpleRefiner: 日英フィラー除去、境界検出、空入力

## デバッグログ

`~/Library/Logs/OpenVoiceText/coordinator.log` に `RecordingCoordinator` の状態遷移ログを常時出力。

```bash
cat ~/Library/Logs/OpenVoiceText/coordinator.log    # ログ確認
tail -f ~/Library/Logs/OpenVoiceText/coordinator.log # リアルタイム監視
```

記録内容: `handleToggle`（状態 + stopTask/cancelTask の有無）、`stopRecording`、`cancelRecording` の呼び出し。
1MB 超過時に自動トランケート。実装は `Sources/VoiceFlowApp/Core/FileLogger.swift`。

## SPM + Hardened Runtime の注意点

SPM ビルドでは Info.plist がバイナリに埋め込まれない。Developer ID 署名 + Hardened Runtime の場合、TCC が `NSSpeechRecognitionUsageDescription` 等を見つけられずクラッシュする。Makefile の `EMBED_PLIST` フラグ（`-Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist`）で解決済み。

## 既知の設計判断

- **Task のライフサイクル管理**: `stopTask`・`cancelTask` 等の Task プロパティは、完了時に必ず `defer { xxxTask = nil }` で nil に戻す。ガード（`guard stopTask == nil`）と組み合わせて二重実行を防止する。nil 戻しを忘れると2回目以降が永久ブロックされるバグになる
- **AccessibilityInjector**: TIS API（`TISCopyCurrentKeyboardInputSource` 等）はメインスレッド必須。`usleep` でメインスレッドをブロックしないよう、`DispatchQueue.main.asyncAfter` チェーンで遅延処理。pasteboard への書き込みは同期（asyncAfter にすると一文字しかペーストされないバグが出る）
- **disconnect() の forceReset()**: 状態マシンの正規遷移（`.reset` イベント）では `.recording` → `.idle` に戻れないため、`forceReset()` で直接 `.idle` に設定。`disconnect()` は全 in-flight タスクもキャンセルする
