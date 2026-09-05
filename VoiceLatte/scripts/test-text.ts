import assert from "node:assert/strict";
import { postProcessTranscript } from "../src/text-processing.ts";

assert.equal(
  postProcessTranscript("100,000円のお金が200,000円になった", []),
  "10万円のお金が20万円になった",
);
assert.equal(
  postProcessTranscript("Voice Latteを使う", [{ id: "1", phrase: "Voice Latte", replacement: "VoiceLatte" }]),
  "VoiceLatteを使う",
);
console.log("text processing: ok");
