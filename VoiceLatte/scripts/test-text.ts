import assert from "node:assert/strict";
import {
  buildRefinementPrompt,
  normalizeVocabularyEntries,
  parseVocabularyAliases,
  postProcessTranscript,
  vocabularyHints,
} from "../src/text-processing.ts";
import { createTranslator, defaultPrompts, resolveSpeechLocale, resolveUiLanguage } from "../src/i18n.ts";

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
assert.equal(createTranslator("en")("nav.general"), "Preferences");
assert.match(defaultPrompts("en").defaultPrompt, /Do not paraphrase/);
assert.equal(resolveUiLanguage("system", "ja-JP"), "ja");
assert.equal(resolveUiLanguage("system", "fr-FR"), "en");
assert.equal(resolveSpeechLocale("system", ["de-DE", "en-US"]), "de-DE");
assert.equal(resolveSpeechLocale("ja-JP", ["en-US"]), "ja-JP");
console.log("text processing: ok");
