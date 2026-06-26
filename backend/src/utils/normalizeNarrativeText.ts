/**
 * Prose shown on risk detail must not end mid-sentence.
 * Drops only a trailing incomplete fragment; never applies a word cap.
 */
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;
const COMPLETE_SENTENCE_END = /[.!?]["')\]]*\s*$/;

export function endsCompleteSentence(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return COMPLETE_SENTENCE_END.test(t);
}

function splitSentences(text: string): string[] {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return [];
  return cleaned
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeNarrativeText(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return cleaned;
  if (endsCompleteSentence(cleaned)) return cleaned;

  const sentences = splitSentences(cleaned);
  if (sentences.length > 1) {
    const complete = sentences.slice(0, -1).join(" ").trim();
    if (complete) return complete;
  }

  return cleaned;
}
