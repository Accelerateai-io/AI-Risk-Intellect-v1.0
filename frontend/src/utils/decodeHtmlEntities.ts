export function decodeDisplayTitle(
  value: string | null | undefined,
  fallback = "",
): string {
  if (value == null) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return decodeHtmlEntities(trimmed);
}

function decodeNumericEntity(code: string, radix: 10 | 16): string {
  const value = Number.parseInt(code, radix);
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) {
    return "";
  }
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201D",
  ldquo: "\u201C",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
};

function decodeHtmlEntitiesOnce(text: string): string {
  let result = text.replace(/&#(\d+);/g, (_match, code: string) => {
    const decoded = decodeNumericEntity(code, 10);
    return decoded || _match;
  });

  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) => {
    const decoded = decodeNumericEntity(code, 16);
    return decoded || _match;
  });

  result = result.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name: string) => {
    const decoded = NAMED_HTML_ENTITIES[name.toLowerCase()];
    return decoded ?? match;
  });

  return result;
}

export function decodeHtmlEntities(text: string): string {
  if (!text) return text;

  let result = text;
  let previous = "";

  while (result !== previous) {
    previous = result;
    result = decodeHtmlEntitiesOnce(result);
  }

  return result;
}
