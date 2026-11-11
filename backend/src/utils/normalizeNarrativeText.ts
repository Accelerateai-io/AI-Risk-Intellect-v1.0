/**
 * Prose shown on risk detail must not end mid-sentence.
 * Drops only a trailing incomplete fragment; never applies a word cap.
 */

// Abbreviations whose trailing period must NOT end a sentence (B-5). Keep in
// sync with python/app/risk_processing/description_utils.py.
const ABBREVIATIONS = [
  "u.s.a", "u.s", "u.k", "e.g", "i.e", "et al", "etc", "vs",
  "fig", "figs", "no", "nos", "vol", "vols", "pp", "cf", "al",
  "dr", "mr", "mrs", "ms", "prof", "sr", "jr", "st",
  "inc", "ltd", "co", "corp", "dept", "approx", "eq", "sec", "ref",
];

// Sentinel that temporarily stands in for an abbreviation's period while we
// split on sentence boundaries, then is swapped back to a ".". A private-use
// code point is used (never appears in real article prose) INSTEAD of a NUL
// byte — a NUL made git treat this source file as binary so it no longer
// diffed as text. (B-5 review)
const PLACEHOLDER = "";
const PROTECT_ABBREV = new RegExp(
  "\\b(?:" +
    ABBREVIATIONS.map((a) => a.replace(/\./g, "\\.")).join("|") +
    ")\\.",
  "gi",
);
const PROTECT_INITIAL = /\b[A-Z]\./g; // initials: J., U., S.
const PROTECT_DECIMAL = /\d\.\d/g; // 3.14
// Only break when the next token starts a new sentence (capital / digit / quote).
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=["'(\[]?[A-Z0-9])/;
const COMPLETE_SENTENCE_END = /[.!?]["')\]]*\s*$/;

export function endsCompleteSentence(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return COMPLETE_SENTENCE_END.test(t);
}

function protectAbbreviations(text: string): string {
  const repl = (m: string) => m.replace(/\./g, PLACEHOLDER);
  return text
    .replace(PROTECT_ABBREV, repl)
    .replace(PROTECT_INITIAL, repl)
    .replace(PROTECT_DECIMAL, repl);
}

export function splitSentences(text: string): string[] {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return [];
  return protectAbbreviations(cleaned)
    .split(SENTENCE_SPLIT)
    .map((s) => s.split(PLACEHOLDER).join(".").trim())
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
