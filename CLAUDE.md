# OpenVoiceText-Pro — CLAUDE.md

## 概要

macOS 音声入力アプリ。OSS 版（OpenVoiceText）と Pro 版（voicelatte / MAS配布予定）の2構成。
OSS 版を git submodule で参照し、Refiner XPC サービスだけ Pro 版に差し替える。

## ブランド

| 配布チャネル | 名前 | リポジトリ |
|---|---|---|
| GitHub（OSS） | **OpenVoiceText** | `hibachi-inc/OpenVoiceText`（PUBLIC, MIT） |
| Mac App Store | **voicelatte** | `hibachi-inc/OpenVoiceText-Pro`（PRIVATE） |

Reki ブランドファミリー（Reki note の姉妹プロダクト）。アイコンは共通（voicelatte アイコン）。

## リポジトリ構成

```
OpenVoiceText-Pro/                          ← このリポ（PRIVATE）
├── OpenVoiceText/                          ← git submodule（OSS版）
│   ├── Sources/VoiceFlowApp/               ← メインアプリ
│   │   ├── App/                            ← AppDelegate, GlobalHotkey, VoiceFlowApp
│   │   ├── Core/                           ← RecordingStateMachine, RecordingCoordinator, AppContext, FileLogger
│   │   ├── Injector/                       ← ClipboardInjector / AccessibilityInjector (#if DIRECT)
│   │   ├── Store/                          ← PreferencesStore, HistoryStore, ProUpgradeManager
│   │   ├── UI/                             ← FloatingHUD, FloatingHUDView, MainWindow (Settings各種)
│   │   └── XPC/                            ← STTXPCClient, RefinerXPCClient, XPCTimeout
│   ├── Sources/VoiceFlowSTT/               ← 音声認識 XPC サービス
│   ├── Sources/VoiceFlowRefiner/           ← SimpleRefiner XPC（OSS版、passthrough）
│   ├── Sources/VoiceFlowProtocol/          ← 共有 XPC プロトコル定義
│   ├── Tests/VoiceFlowTests/               ← 69テスト（4スイート）
│   ├── Resources/                          ← Info.plist, Entitlements, AppIcon.icns
│   ├── Makefile                            ← OSS版ビルド（build/bundle/dmg/release）
│   └── CLAUDE.md                           ← OSS版の詳細（設計判断・注意点はここ）
├── Sources/ProRefiner/                     ← Pro Refiner XPC サービス
│   ├── main.swift
│   ├── ProRefinerService.swift             ← refine() + translate()
│   └── FoundationModelsRefiner.swift       ← AI 整形 + 翻訳ロジック
├── ProResources/Refiner-Info.plist
├── Package.swift                           ← OSS の VoiceFlowProtocol に依存
└── Makefile                                ← Pro版ビルド（PROFEATURES フラグ付き）
```

## ビルド

```bash
git submodule update --init

# OSS版（SimpleRefiner）
cd OpenVoiceText && make run

# Pro版（ProRefiner + PROFEATURES）
cd .. && make run

# テスト
cd OpenVoiceText && swift test

# OSS版リリース（→ /voicelatte-release スキル参照）
cd OpenVoiceText && make release
```

## ビルド注意事項

- **XPCサービスを変更したら `swift package clean` が必須**。XPCバイナリはキャッシュが強く、インクリメンタルビルドでは反映されないことがある。特に RefinerService / STTService のプロトコル変更・ロジック変更時はクリーンビルドしないと古いXPCが使われ続ける。

## アーキテクチャ

```
VoiceFlowApp（メインプロセス）
├── UI: FloatingHUD, MainWindow
├── Core: RecordingStateMachine → RecordingCoordinator → AppContext
├── Injector: ClipboardInjector（MAS） / AccessibilityInjector（DIRECT）
├── Store: PreferencesStore, HistoryStore, ProUpgradeManager
├── XPC Clients: STTXPCClient, RefinerXPCClient（withXPCTimeout）
│
├── VoiceFlowSTT.xpc — SFSpeechRecognizer + AVAudioEngine
└── VoiceFlowRefiner.xpc
    ├── SimpleRefiner（OSS: passthrough + フィラー除去）
    └── ProRefiner（Pro: FoundationModels AI整形 + 翻訳）
```

XPC バンドルを差し替えるだけで OSS/Pro が切り替わる。メインアプリは Refiner の実装を知らない。

## Pro 版の機能

- FoundationModels による AI 整形（カテゴリ別プロンプト）
- 多言語翻訳（NLLanguageRecognizer → ターゲット言語）
- macOS 26+ 必須。非対応環境では passthrough
- `#if PROFEATURES` で条件コンパイル
- StoreKit 2 IAP（`ProUpgradeManager`）

## 署名・配布

| 項目 | 値 |
|------|-----|
| Developer ID 証明書 | `Developer ID Application: HIBACHI inc. (TYX92DB6TA)` |
| MAS署名（App） | `3rd Party Mac Developer Application: HIBACHI inc. (TYX92DB6TA)` |
| MAS署名（Installer） | `3rd Party Mac Developer Installer: HIBACHI inc. (TYX92DB6TA)` |
| 公証プロファイル | `rekinote-notarize`（Keychain 保存済み） |
| メインバンドルID | `com.hibachi.voicelatte` |
| STT XPC | `com.hibachi.voicelatte.stt` |
| Refiner XPC | `com.hibachi.voicelatte.refiner` |
| Provisioning Profile | `ProResources/embedded.provisionprofile` |

## App Store Connect

| 項目 | 値 |
|------|-----|
| App Apple ID | `6776692293` |
| バンドルID | `com.hibachi.voicelatte` |
| SKU | `voicelatte` |
| IAP Product ID | `com.hibachi.voicelatte.pro`（非消耗型） |
| ASC API Key ID | `WZQ52NQR67` |
| ASC Issuer ID | `8df6663b-5f13-482b-8b9c-0e5ca7dce4c2` |
| API Key (.p8) | `~/.private_keys/AuthKey_WZQ52NQR67.p8` |

### MASアップロード

```bash
make upload \
  ASC_API_KEY=WZQ52NQR67 \
  ASC_API_ISSUER=8df6663b-5f13-482b-8b9c-0e5ca7dce4c2 \
  ASC_APP_APPLE_ID=6776692293
```

### DMG自動更新（Sparkle）

| 項目 | 値 |
|------|-----|
| Sparkle バージョン | 2.9.2（`.build/Sparkle/` に自動DL） |
| EdDSA公開鍵 | `ProResources/Info.plist` の `SUPublicEDKey` |
| EdDSA秘密鍵 | macOS Keychain（`make sparkle-keys` で生成済み） |
| Appcast URL | `https://raw.githubusercontent.com/hibachi-inc/voicelatte-releases/main/appcast.xml` |
| Release リポ | `hibachi-inc/voicelatte-releases`（Public） |

## デバッグ

```bash
# 状態遷移ログ（常時出力、1MB自動トランケート）
tail -f ~/Library/Logs/OpenVoiceText/coordinator.log

# クラッシュレポート
ls -lt ~/Library/Logs/DiagnosticReports/ | grep -i "VoiceFlow" | head -5
```

## 重要な注意点

OSS版の `OpenVoiceText/CLAUDE.md` に詳細な設計判断・罠が記載されている。開発前に必ず読むこと:
- Task ライフサイクル管理（`defer { xxxTask = nil }` 必須）
- AccessibilityInjector のスレッド制約
- SPM + Hardened Runtime の Info.plist 埋め込み
- disconnect() の forceReset()
