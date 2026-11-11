/**
 * Align primary and secondary labels with the harm described in the record.
 *
 * This runs after the assessor's domain and category corrections. It only
 * changes a label when one mechanism is present and the other is not.
 * A mixed record is left as the assessor classified it. Publication rules
 * are not decided here.
 */

const TECHNICAL_PRIMARY = "Technical Risks";
const SECURITY_SECONDARY = "Security Risk";
const PERFORMANCE_SECONDARY = "Technical/Performance Risk";

const SECURITY_MECHANISMS: RegExp[] = [
  /prompt injection/i,
  /cyber ?attacks?/i,
  /system compromise/i,
  /compromis(?:e|ed|ing) the (?:system|model|pipeline|agent)/i,
  /unauthorized (?:access|actions?)/i,
  /insider threat/i,
  /jailbreak/i,
  /(?:credential|api key|secret)s? (?:exposure|leak)/i,
  /exposure of (?:credentials|secrets|api keys)/i,
  /harmful actions/i,
  /data exposure/i,
];

const CAPTCHA_WORD = /\bcaptchas?\b/i;
const CAPTCHA_VERB_OR_SOLVING =
  /\b(?:bypass(?:es|ed|ing)?|defeat(?:s|ed|ing)?|evad(?:e|es|ed|ing)|evasion|circumvent(?:s|ed|ing)?|accuracy|success rates?|solv(?:e|es|ed|ing)|new[- ]class|perturbations?|arms race|detectors?)\b/i;
const CAPTCHA_ATTACK_OUTCOME =
  /\b(?:unauthorized access|account takeover|credential abuse|credential stuffing|stolen credentials)\b/i;

const PERFORMANCE_MECHANISMS: RegExp[] = [
  /hallucinat/i,
  /inaccurat/i,
  /inconsistent responses?/i,
  /performance degradation/i,
  /output quality/i,
  /accuracy (?:drop|fell|falling)/i,
  /percent drop/i,
];

export type ClassificationAlignment = {
  primary: string;
  secondary: string;
  reason: string;
};

function mechanismText(risk: Record<string, unknown>): string {
  return ["risk_title", "description", "attack_vector", "stated_implication"]
    .map((field) => String(risk[field] ?? ""))
    .join(" ");
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function captchaTopic(recordText: string, sourceText: string): boolean {
  const blob = `${recordText}\n${sourceText}`;
  return CAPTCHA_WORD.test(blob) && CAPTCHA_VERB_OR_SOLVING.test(blob);
}

/** A CAPTCHA security label requires the attack outcome in the source itself. */
function sourceCaptchaAttack(sourceText: string, recordText: string): boolean {
  return (
    CAPTCHA_ATTACK_OUTCOME.test(sourceText) &&
    CAPTCHA_WORD.test(`${sourceText}\n${recordText}`)
  );
}

/**
 * Return a corrected primary and secondary when the stated mechanism
 * contradicts the current secondary. Null means leave the labels alone.
 *
 * CAPTCHA solver results are performance. Bypass, evasion, or defeat in the
 * extracted record does not count unless the source reports an attack outcome.
 */
export function alignSecondaryClassification(
  risk: Record<string, unknown>,
  sourceText = "",
): ClassificationAlignment | null {
  const text = mechanismText(risk);
  const attack = sourceCaptchaAttack(sourceText, text);
  const captchaWithoutAttack = captchaTopic(text, sourceText) && !attack;
  let security = hasAny(captchaWithoutAttack ? sourceText : text, SECURITY_MECHANISMS);
  let performance = hasAny(text, PERFORMANCE_MECHANISMS);
  if (captchaWithoutAttack) performance = true;
  if (attack) {
    security = true;
    performance = false;
  }
  if (security === performance) return null;

  const secondary = String(risk.secondary_risks ?? "").trim();
  if (security && secondary === PERFORMANCE_SECONDARY) {
    return {
      primary: TECHNICAL_PRIMARY,
      secondary: SECURITY_SECONDARY,
      reason:
        "The described mechanism is system compromise or unauthorized action, which is Security Risk rather than an output-quality failure.",
    };
  }
  if (performance && secondary === SECURITY_SECONDARY) {
    return {
      primary: TECHNICAL_PRIMARY,
      secondary: PERFORMANCE_SECONDARY,
      reason:
        "The described mechanism is output quality, which is Technical/Performance Risk rather than a security compromise.",
    };
  }
  return null;
}
