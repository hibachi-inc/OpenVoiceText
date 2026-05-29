# OpenVoiceText-Pro — CLAUDE.md

## 概要

OpenVoiceText の有料版 Refiner XPC サービス。
OSS 版（hibachi-inc/OpenVoiceText）を git submodule で参照し、Refiner だけ Pro 版に差し替える。

## リポジトリ構成

```
OpenVoiceText-Pro/
├── OpenVoiceText/              ← git submodule（OSS版）
├── Sources/ProRefiner/         ← Pro Refiner XPC サービス
│   ├── main.swift              ← XPC エントリポイント
│   ├── ProRefinerService.swift ← refine() + translate() 実装
│   └── FoundationModelsRefiner.swift ← AI 整形 + 翻訳ロジック
├── ProResources/
│   └── Refiner-Info.plist
├── Package.swift               ← OSS の VoiceFlowProtocol に依存
└── Makefile                    ← OSS 側をビルドし、Refiner だけ差し替え
```

## ビルド

```bash
git submodule update --init
make run
```

## Pro 版の機能
- FoundationModels による AI 整形（カテゴリ別プロンプト）
- 多言語翻訳（NLLanguageRecognizer で入力言語判定 → ターゲット言語に翻訳）
- macOS 26+ 必須（FoundationModels）。非対応環境では passthrough

## XPC プロトコル
OSS 側の `VoiceFlowProtocol` で定義:
- `refine(text:category:reply:)` — AI 整形
- `translate(text:targetLanguage:reply:)` — 翻訳

バンドルID は `com.hibachi.voiceflow.refiner`（OSS 版と同じ）。
メインアプリは Refiner の実装を知らない。XPC バンドルを差し替えるだけで切り替わる。
