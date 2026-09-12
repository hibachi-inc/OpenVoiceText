// 除外リストの重複検査：TS側とSwift側のDayflow流用リストが一致すること。
// 使い方: node scripts/check-sensitive-lists.mjs
import { readFileSync } from "node:fs";

function stringsBetween(src, start, end) {
  const from = src.indexOf(start) + start.length;
  const body = src.slice(from, src.indexOf(end, from));
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const ts = readFileSync(new URL("../src/screen-policy.ts", import.meta.url), "utf8");
const swift = readFileSync(new URL("../native/macos/Sources/VoiceLatteSpeechBridge/AppContext.swift", import.meta.url), "utf8");

const pairs = [
  ["TS bundle", stringsBetween(ts, "SCREEN_CAPTURE_BLOCKED_BUNDLE_HINTS = [", "];"),
   "Swift bundle", stringsBetween(swift, "sensitiveBundleHints = [", "]")],
  ["TS name", stringsBetween(ts, "SCREEN_CAPTURE_BLOCKED_NAME_HINTS = [", "];"),
   "Swift name", stringsBetween(swift, "sensitiveNameHints = [", "]")],
];

let failed = false;
for (const [aName, a, bName, b] of pairs) {
  const missing = b.filter((x) => !a.includes(x));
  const extra = a.filter((x) => !b.includes(x));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`${aName} vs ${bName} mismatch:\n  missing: ${missing.join(", ")}\n  extra: ${extra.join(", ")}`);
  } else {
    console.log(`${aName} vs ${bName}: OK (${a.length} hints)`);
  }
}
process.exit(failed ? 1 : 0);
