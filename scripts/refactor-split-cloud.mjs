import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const path = "src-tauri/src/cloud.rs";
const source = readFileSync(path, "utf8");
const lines = source.match(/.*(?:\n|$)/g).filter(Boolean);

// Track Rust brace depth while ignoring quoted strings and comments. This only
// needs to identify complete top-level items; the source itself is not rewritten.
let depth = 0;
let blockComment = 0;
let inString = false;
let inRaw = null;
let escaped = false;
const depthAtStart = [];
for (const line of lines) {
  depthAtStart.push(depth);
  let lineComment = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const n = line[i + 1];
    if (lineComment) continue;
    if (blockComment > 0) {
      if (c === "/" && n === "*") { blockComment++; i++; continue; }
      if (c === "*" && n === "/") { blockComment--; i++; continue; }
      continue;
    }
    if (inRaw !== null) {
      if (c === '"') {
        const suffix = "#".repeat(inRaw);
        if (line.slice(i + 1, i + 1 + inRaw) === suffix) {
          i += inRaw;
          inRaw = null;
        }
      }
      continue;
    }
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === "/" && n === "/") { lineComment = true; i++; continue; }
    if (c === "/" && n === "*") { blockComment++; i++; continue; }
    if (c === "r") {
      const m = line.slice(i).match(/^r(#+)?"/);
      if (m) { inRaw = (m[1] ?? "").length; i += m[0].length - 1; continue; }
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
  }
}

function declAt(i) {
  if (depthAtStart[i] !== 0) return null;
  const s = lines[i].trim();
  let m;
  if ((m = s.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/))) return { kind: "fn", name: m[1] };
  if ((m = s.match(/^(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z0-9_]+)/))) return { kind: "struct", name: m[1] };
  if ((m = s.match(/^(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z0-9_]+)/))) return { kind: "enum", name: m[1] };
  if ((m = s.match(/^(?:pub(?:\([^)]*\))?\s+)?const\s+([A-Za-z0-9_]+)/))) return { kind: "const", name: m[1] };
  if ((m = s.match(/^impl(?:<[^>]+>)?\s+(.+?)\s*\{/))) return { kind: "impl", name: m[1] };
  if ((m = s.match(/^mod\s+([A-Za-z0-9_]+)\s*\{/))) return { kind: "mod", name: m[1] };
  return null;
}

const items = [];
for (let i = 0; i < lines.length; i++) {
  const decl = declAt(i);
  if (!decl) continue;
  let start = i;
  // Attach top-level attributes and doc/comments immediately above the item.
  let j = i - 1;
  while (j >= 0 && depthAtStart[j] === 0) {
    const t = lines[j].trim();
    if (t === "" || t.startsWith("//") || t.startsWith("#[")) { start = j; j--; continue; }
    break;
  }
  let end = i;
  if (decl.kind === "const") {
    while (end < lines.length - 1 && !lines.slice(i, end + 1).join("").includes(";")) end++;
  } else {
    // Find first line that returns to top-level after this item has opened a brace.
    let opened = false;
    for (let k = i; k < lines.length; k++) {
      if (lines[k].includes("{")) opened = true;
      if (opened && k + 1 < depthAtStart.length && depthAtStart[k + 1] === 0) { end = k; break; }
      end = k;
    }
  }
  items.push({ ...decl, start, end });
  i = end;
}

const credentialNames = new Set([
  "set_api_key", "api_key_present", "api_key_present_impl", "clear_api_key",
  "without_keychain_ui", "credential", "validate_provider", "resolve_key", "mask_api_key",
]);
const captureNames = new Set([
  "clear_stale_captures", "prepare_capture", "discard_capture", "capture_directory",
]);
const modelNames = new Set([
  "groq_refine_chain", "model_supports_vision", "sanitize_image_mime", "is_fallback_status",
  "list_provider_models", "is_refine_candidate", "groq_model_ids", "gemini_model_ids",
  "list_groq_models", "list_gemini_models", "gemini_chain", "image_will_attach",
  "is_gemini_flash_text_model", "model_supports_audio", "model_refinement_eligible",
  "model_transcription_eligible", "is_dynamic_fallback_candidate", "gemini_dynamic_fallbacks",
]);
const commandNames = new Set(["cloud_transcribe", "cloud_transcribe_refine", "cloud_refine"]);
const commonNames = new Set(["refinement_input"]);

function category(item) {
  const { kind, name } = item;
  if (kind === "mod" && name === "tests") return "tests";
  if (name === "TempAudio" || (kind === "impl" && name.includes("TempAudio")) || captureNames.has(name)) return "capture";
  if (name === "KEYCHAIN_SERVICE" || name === "KEY_READ_FAILURE" || credentialNames.has(name)) return "credentials";
  if (name === "ModelInfo" || ["GEMINI_MODELS", "GROQ_DEFAULT_MODEL", "GROQ_QWEN_MODELS"].includes(name) || modelNames.has(name)) return "models";
  if (commandNames.has(name)) return "commands";
  if (name.startsWith("diag_")) return "diagnostics";
  if (name === "GroqError" || name.startsWith("groq_") || name.startsWith("stream_groq") || name.startsWith("append_groq")) return "groq";
  if (name === "GeminiError" || name === "CombinedOutput" || name.startsWith("gemini_") || name.startsWith("stream_gemini") || name.startsWith("append_sse") || name === "parse_combined_output" || name === "tail_chars") return "gemini";
  if (commonNames.has(name)) return "common";
  return null;
}

const selected = items.map((item) => ({ ...item, category: category(item) })).filter((x) => x.category);
const byCategory = new Map();
for (const item of selected) {
  if (!byCategory.has(item.category)) byCategory.set(item.category, []);
  byCategory.get(item.category).push(item);
}

mkdirSync("src-tauri/src/cloud", { recursive: true });
for (const [cat, group] of byCategory) {
  const body = group.map((item) => lines.slice(item.start, item.end + 1).join("").trim()).join("\n\n") + "\n";
  writeFileSync(`src-tauri/src/cloud/${cat}.rs`, body);
}

// Remove selected spans from bottom to top. Preserve shared imports/types/constants in cloud.rs.
let next = source;
const offsets = [];
let offset = 0;
for (let i = 0; i < lines.length; i++) { offsets[i] = offset; offset += lines[i].length; }
for (const item of selected.sort((a, b) => b.start - a.start)) {
  const start = offsets[item.start];
  const end = item.end + 1 < offsets.length ? offsets[item.end + 1] : source.length;
  next = next.slice(0, start) + next.slice(end);
}
const includeOrder = ["common", "capture", "credentials", "models", "diagnostics", "groq", "gemini", "commands", "tests"]
  .filter((cat) => byCategory.has(cat));
next = next.trimEnd() + "\n\n" + includeOrder.map((cat) => `include!(\"cloud/${cat}.rs\");`).join("\n") + "\n";
writeFileSync(path, next.replace(/\n{3,}/g, "\n\n"));

console.log(`Split ${selected.length} top-level Rust items into ${includeOrder.length} files:`);
for (const cat of includeOrder) console.log(`  ${cat}: ${byCategory.get(cat).map((x) => x.name).join(", ")}`);
console.log("Kept in cloud.rs:", items.filter((x) => !category(x)).map((x) => x.name).join(", "));
