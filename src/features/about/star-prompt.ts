// スター依頼の集計。完了した音声入力を数え、3回目に1度だけダイアログを出す。
const STAR_COUNT_KEY = "voicelatte.inputCount";

const STAR_SHOWN_KEY = "voicelatte.starPromptShown";

function readStarCount(): number {
  try { return Number(localStorage.getItem(STAR_COUNT_KEY)) || 0; } catch { return 0; }
}

export function starPromptShown(): boolean {
  try { return localStorage.getItem(STAR_SHOWN_KEY) === "1"; } catch { return true; }
}

export function markStarPromptShown() {
  try { localStorage.setItem(STAR_SHOWN_KEY, "1"); } catch { /* 保存できなければ出さない */ }
}

export function bumpStarCount(): number {
  const next = readStarCount() + 1;
  try { localStorage.setItem(STAR_COUNT_KEY, String(next)); } catch { /* 集計のみ */ }
  return next;
}
