import assert from "node:assert/strict";
import {
  DEFAULT_PROMPT_KEY,
  appPromptKey,
  buildRefinementPrompt,
  categoryPromptKey,
  migrateLegacyCustomPrompts,
  normalizeCustomPrompts,
  normalizeVocabularyEntries,
  parseVocabularyAliases,
  postProcessTranscript,
  resolveCustomPrompt,
  vocabularyHints,
} from "../src/text-processing.ts";
import { createTranslator, defaultRefinementPrompt, legacyDefaultPrompts, resolveSpeechLocale, resolveUiLanguage } from "../src/i18n.ts";

assert.equal(
  postProcessTranscript("100,000円のお金が200,000円になった", []),
  "10万円のお金が20万円になった",
);
assert.equal(
  postProcessTranscript("Voice Latteを使う", [{ id: "1", term: "VoiceLatte", aliases: ["Voice Latte"] }]),
  "VoiceLatteを使う",
);
assert.equal(
  postProcessTranscript("ぼいすらてを使う", [{ id: "1", term: "VoiceLatte", aliases: ["ボイスラテ"] }]),
  "VoiceLatteを使う",
);
assert.equal(
  postProcessTranscript("型番ＡＢＣと①を入力", [{ id: "1", term: "VoiceLatte", aliases: ["ぼいすらて"] }]),
  "型番ＡＢＣと①を入力",
);
assert.equal(
  postProcessTranscript("型番ＡＢＣを入力", [{ id: "1", term: "型番ABC", aliases: ["型番ＡＢＣ"] }]),
  "型番ABCを入力",
);
assert.deepEqual(
  normalizeVocabularyEntries([{ id: "old", phrase: "Voice Latte", replacement: "VoiceLatte" }]),
  [{ id: "old", term: "VoiceLatte", aliases: ["Voice Latte"] }],
);
assert.deepEqual(
  normalizeVocabularyEntries([{ id: "old-width", phrase: "型番ＡＢＣ", replacement: "型番ABC" }]),
  [{ id: "old-width", term: "型番ABC", aliases: ["型番ＡＢＣ"] }],
);
assert.deepEqual(parseVocabularyAliases("ボイスラテ、Voice Latte, VoiceLatte", "VoiceLatte"), ["ボイスラテ", "Voice Latte"]);
assert.deepEqual(parseVocabularyAliases("型番ＡＢＣ", "型番ABC"), ["型番ＡＢＣ"]);
assert.deepEqual(
  vocabularyHints([{ id: "1", term: "VoiceLatte", aliases: ["ボイスラテ", "Voice Latte"] }]),
  ["VoiceLatte", "ボイスラテ", "Voice Latte"],
);
assert.equal(vocabularyHints(Array.from({ length: 105 }, (_, index) => ({ id: String(index), term: `語${index}`, aliases: [] }))).length, 100);
assert.match(
  buildRefinementPrompt("句読点を整える", [{ id: "1", term: "VoiceLatte", aliases: ["ボイスラテ"] }]),
  /ボイスラテ → VoiceLatte/,
);
assert.match(
  buildRefinementPrompt("Keep wording", [{ id: "1", term: "VoiceLatte", aliases: ["Voice Latte"] }], "en-US"),
  /Custom vocabulary/,
);
assert.match(buildRefinementPrompt("箇条書きにする", [], "ja-JP"), /フォーマッタ/);
assert.match(buildRefinementPrompt("箇条書きにする", [], "ja-JP"), /\[個別の整形方針\]/);
assert.deepEqual(normalizeCustomPrompts({ default: "短く", invalid: 42 }), { default: "短く" });
const jaPrompts = legacyDefaultPrompts("ja");
const enPrompts = legacyDefaultPrompts("en");
const builtInPrompts = {
  defaultPrompt: [jaPrompts.defaultPrompt, enPrompts.defaultPrompt],
  chatPrompt: [jaPrompts.chatPrompt, enPrompts.chatPrompt],
  codePrompt: [jaPrompts.codePrompt, enPrompts.codePrompt],
};
assert.deepEqual(
  migrateLegacyCustomPrompts({
    defaultPrompt: jaPrompts.defaultPrompt,
    chatPrompt: "短いチャット文にする",
    codePrompt: jaPrompts.codePrompt,
  }, builtInPrompts),
  { [categoryPromptKey("chat")]: "短いチャット文にする" },
);
assert.deepEqual(
  migrateLegacyCustomPrompts({
    customPrompts: { [DEFAULT_PROMPT_KEY]: "既存設定" },
    defaultPrompt: "旧設定",
  }, builtInPrompts),
  { [DEFAULT_PROMPT_KEY]: "既存設定" },
);
const customPrompts = {
  [DEFAULT_PROMPT_KEY]: "全体",
  [categoryPromptKey("chat")]: "チャット",
  [appPromptKey("chatgpt.com")]: "ChatGPT",
};
assert.equal(resolveCustomPrompt(customPrompts, { promptKey: "chatgpt.com", appName: "Safari", category: "chat" }), "ChatGPT");
assert.equal(resolveCustomPrompt(customPrompts, { appName: "Slack", category: "chat" }), "チャット");
assert.equal(resolveCustomPrompt(customPrompts, { appName: "Notes", category: "notes" }), "全体");
assert.equal(createTranslator("en")("nav.general"), "Preferences");
assert.match(legacyDefaultPrompts("en").defaultPrompt, /Do not paraphrase/);
assert.match(defaultRefinementPrompt("ja"), /意味や話者の意図を変えず/);
assert.match(defaultRefinementPrompt("en"), /speech-recognition errors/);
assert.equal(resolveUiLanguage("system", "ja-JP"), "ja");
assert.equal(resolveUiLanguage("system", "fr-FR"), "en");
assert.equal(resolveSpeechLocale("system", ["de-DE", "en-US"]), "de-DE");
assert.equal(resolveSpeechLocale("ja-JP", ["en-US"]), "ja-JP");
console.log("text processing: ok");
