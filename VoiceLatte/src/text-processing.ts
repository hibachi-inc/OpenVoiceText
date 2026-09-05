export type VocabularyEntry = { id: string; phrase: string; replacement: string };

export function postProcessTranscript(text: string, entries: VocabularyEntry[]) {
  let result = text;
  for (const entry of [...entries].sort((a, b) => b.phrase.length - a.phrase.length)) {
    if (entry.phrase) result = result.split(entry.phrase).join(entry.replacement || entry.phrase);
  }
  return result
    .replace(/(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)円/g, (match, raw: string) => {
      const value = Number(raw.split(",").join(""));
      return value >= 10_000 && value % 10_000 === 0 ? `${value / 10_000}万円` : match;
    })
    .replace(/(?:^|(?<=[\s、。，．！？!?\n]))(?:えーっと|えーと|えっと|あのー)(?=$|[\s、。，．！？!?\n])/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}
