// 撮影対象外（Dayflow方式：パスワード・認証・暗号資産系）。
// 除外リストは Dayflow (MIT, (c) 2025 Jerry Liu,
// https://github.com/JerryZLiu/Dayflow) の選定を流用。
// bundleID・アプリ名の部分一致（小文字化して比較）。
// Swift側（AppContext.swift）にも同一リストがある。変更時は両方を更新し、
// scripts/check-sensitive-lists.mjs で一致を確認すること。
export const SCREEN_CAPTURE_BLOCKED_BUNDLE_HINTS = [
  "1password",
  "authy",
  "bitwarden",
  "dashlane",
  "enpass",
  "keeper",
  "keepass",
  "keychainaccess",
  "lastpass",
  "ledger",
  "nordpass",
  "passwords",
  "protonpass",
  "secrets",
  "trezor",
  "yubico",
];
export const SCREEN_CAPTURE_BLOCKED_NAME_HINTS = [
  "1password",
  "authy",
  "bitwarden",
  "dashlane",
  "enpass",
  "keeper",
  "keepassxc",
  "keychain access",
  "lastpass",
  "ledger live",
  "nordpass",
  "passwords",
  "proton pass",
  "secrets",
  "trezor suite",
  "yubico authenticator",
];

// 撮影対象外の判定（ターミナルは除外しない。CLI入力が増えているため）。
export function isScreenCaptureAllowed(context: { bundleID?: string; appName?: string }): boolean {
  const id = (context.bundleID ?? "").toLowerCase();
  if (id && SCREEN_CAPTURE_BLOCKED_BUNDLE_HINTS.some((hint) => id.includes(hint))) return false;
  const name = (context.appName ?? "").toLowerCase();
  if (name && SCREEN_CAPTURE_BLOCKED_NAME_HINTS.some((hint) => name.includes(hint))) return false;
  return true;
}
