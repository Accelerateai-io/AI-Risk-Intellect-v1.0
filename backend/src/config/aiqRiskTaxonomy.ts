/**
 * AI-Q Risk Domain & Taxonomy definitions (scoring backbone).
 * Source: `AI-Q Risk Domain and Taxonomy Definitions` document.
 *
 * Each entry maps an AI-Q domain to the canonical `risk_mappings.domains` value
 * used in the database catalog.
 */

export const CATALOG_DOMAINS = [
  "Discrimination and Toxicity",
  "Privacy and Security",
  "Misinformation",
  "Malicious Actors and Misuse",
  "Human-Computer Interaction",
  "Socioeconomic and Environmental",
  "AI System Safety, Failures, and Limitations",
] as const;

export type TaxonomyDomain = (typeof CATALOG_DOMAINS)[number];

export type AiqDomainDefinition = {
  /** Canonical value stored on `risks.domains` / `risk_mappings.domains`. */
  catalogDomain: TaxonomyDomain;
  /** Label from the AI-Q document. */
  aiqName: string;
  summary: string;
  description: string;
  coveragePoints: string[];
  keywords: string[];
};

/** AI-Q seven-domain definitions, aligned to catalog domain names. */
export const AIQ_RISK_DOMAIN_DEFINITIONS: readonly AiqDomainDefinition[] = [
  {
    catalogDomain: "Privacy and Security",
    aiqName: "Privacy & Security",
    summary:
      "Exposure of sensitive data and attacks on the system, its data, or infrastructure.",
    description:
      "Privacy and Security cover the risk that an AI system exposes sensitive data or is compromised through vulnerabilities and adversarial attack. It spans the confidentiality of data the system ingests, stores, or can infer, and the integrity of the model, its pipeline, and the infrastructure around it.",
    coveragePoints: [
      "Leakage or unauthorized inference of personal, regulated, or confidential data such as PII, PHI, financial records, and secrets.",
      "Model and pipeline vulnerabilities, including prompt injection, model extraction, data poisoning, and jailbreaks.",
      "Access control, data residency, retention, and the security of integrations and third-party components.",
    ],
    keywords: [
      "privacy",
      "security",
      "data breach",
      "pii",
      "phi",
      "leak",
      "unauthorized",
      "vulnerability",
      "exploit",
      "encryption",
      "credentials",
      "secrets",
      "prompt injection",
      "jailbreak",
      "data poisoning",
      "model extraction",
      "access control",
      "adversarial attack",
      "cyberattack",
    ],
  },
  {
    catalogDomain: "AI System Safety, Failures, and Limitations",
    aiqName: "AI System Safety",
    summary:
      "Unreliable, inaccurate, or out-of-bounds behavior, up to loss of control.",
    description:
      "AI System Safety covers the risk that a system behaves unreliably, inaccurately, or outside its intended bounds, up to and including loss of control. It captures failures that can cause physical, health, financial, or operational harm.",
    coveragePoints: [
      "Accuracy failures, hallucination, and output quality that misleads decisions.",
      "Performance degradation, model drift, and brittleness under conditions not seen in training.",
      "Unsafe autonomous behavior, dangerous capabilities, and inadequate fallback or recovery.",
      "Opaque or black-box models whose outputs cannot be traced or justified.",
      "Missing model documentation, data provenance, or decision records.",
      "Inability to meet disclosure expectations such as those in the EU AI Act.",
    ],
    keywords: [
      "system failure",
      "hallucination",
      "inaccurate",
      "unreliable",
      "model drift",
      "brittleness",
      "loss of control",
      "unsafe",
      "autonomous",
      "fallback",
      "transparency",
      "explainability",
      "black box",
      "provenance",
      "documentation",
      "disclosure",
      "robustness",
      "limitation",
      "unintended consequences",
    ],
  },
  {
    catalogDomain: "Discrimination and Toxicity",
    aiqName: "Fairness & Non-discrimination",
    summary:
      "Biased or discriminatory outcomes and exposure to toxic content.",
    description:
      "Fairness and Non-discrimination covers the risk that a system produces biased, discriminatory, or harmful outcomes across individuals or groups. It includes both unequal treatment and exposure to harmful or toxic content.",
    coveragePoints: [
      "Disparate performance or treatment across protected or vulnerable groups.",
      "Bias inherited from training data or introduced through design and deployment choices.",
      "Generation of, or exposure to, toxic, demeaning, or harmful content.",
    ],
    keywords: [
      "bias",
      "discrimination",
      "discriminatory",
      "fairness",
      "toxic",
      "toxicity",
      "racist",
      "sexist",
      "stereotype",
      "harassment",
      "unequal",
      "disparate",
      "protected groups",
      "demeaning",
      "harmful content",
    ],
  },
  {
    catalogDomain: "Misinformation",
    aiqName: "Misinformation",
    summary:
      "False, fabricated, or misleading information produced or amplified by AI systems.",
    description:
      "Misinformation covers false information, deepfakes, hallucinations presented as fact, and truth pollution that misleads users or decision-makers.",
    coveragePoints: [
      "Fabricated or misleading claims presented with high fluency and apparent authority.",
      "Deepfakes and synthetic media used to deceive.",
      "Hallucinated facts, figures, or citations that distort decisions.",
    ],
    keywords: [
      "misinformation",
      "disinformation",
      "deepfake",
      "fabricated",
      "false information",
      "misleading",
      "fake",
      "hallucinated",
      "truth pollution",
    ],
  },
  {
    catalogDomain: "Malicious Actors and Misuse",
    aiqName: "Malicious Actors & Misuse",
    summary:
      "Intentional misuse, fraud, criminal activity, and adversarial exploitation of AI systems.",
    description:
      "Malicious Actors and Misuse covers deliberate harm through fraud, cyberattacks, weapons, surveillance abuse, criminal incitement, and coordinated misuse of AI capabilities.",
    coveragePoints: [
      "Intentional adversarial exploitation such as fraud, scams, and criminal misuse.",
      "Weaponization, surveillance abuse, and coordinated harmful campaigns.",
      "Bypassing safety controls for harmful or illegal ends.",
    ],
    keywords: [
      "malicious",
      "misuse",
      "fraud",
      "scam",
      "criminal",
      "weapons",
      "surveillance",
      "intentional",
      "adversarial",
      "abuse",
      "exploitation",
      "harmful campaign",
    ],
  },
  {
    catalogDomain: "Human-Computer Interaction",
    aiqName: "Human Oversight",
    summary:
      "Insufficient human control, overreliance, and loss of meaningful review.",
    description:
      "Human Oversight covers the risk that people lack meaningful control over an AI system. It includes overreliance, automation bias, and the loss of the ability to review, intervene in, or override consequential decisions.",
    coveragePoints: [
      "Overreliance and automation bias that erode independent human judgment.",
      "Absence of review, intervention, or override for high-stakes decisions.",
      "Loss of user agency where the system acts without appropriate human involvement.",
      "Undefined ownership and accountability for AI outcomes.",
      "Missing or immature AI policy, ethics framework, and change management.",
      "Inadequate record keeping, audit trails, and lifecycle controls.",
    ],
    keywords: [
      "human oversight",
      "overreliance",
      "automation bias",
      "human review",
      "intervention",
      "override",
      "loss of agency",
      "human control",
      "accountability",
      "governance",
      "audit trail",
      "policy",
      "ethics framework",
      "lifecycle",
    ],
  },
  {
    catalogDomain: "Socioeconomic and Environmental",
    aiqName: "Socioeconomic Impact",
    summary:
      "Broader economic, workforce, societal, and environmental harm.",
    description:
      "Socioeconomic Impact covers the broader economic, workforce, societal, and environmental effects of deploying AI. It captures harms that extend beyond the immediate system to people, markets, and the environment.",
    coveragePoints: [
      "Workforce displacement, skill erosion, and decline in the quality of work.",
      "Inequitable distribution of benefits and concentration of power.",
      "Environmental cost of training and operating models.",
    ],
    keywords: [
      "socioeconomic",
      "workforce",
      "job loss",
      "displacement",
      "inequality",
      "environmental",
      "economic impact",
      "unemployment",
      "concentration of power",
      "skill erosion",
      "carbon",
      "energy consumption",
    ],
  },
] as const;

export function listTaxonomyDomains(): readonly TaxonomyDomain[] {
  return CATALOG_DOMAINS;
}

export function getDefinitionForCatalogDomain(
  catalogDomain: string,
): AiqDomainDefinition | undefined {
  const fp = catalogDomain.toLowerCase().replace(/[^a-z0-9]/g, "");
  return AIQ_RISK_DOMAIN_DEFINITIONS.find(
    (def) =>
      def.catalogDomain.toLowerCase().replace(/[^a-z0-9]/g, "") === fp,
  );
}

/** Full searchable text corpus for a domain definition (used for token scoring). */
export function buildDomainDefinitionCorpus(def: AiqDomainDefinition): string {
  return [
    def.aiqName,
    def.catalogDomain,
    def.summary,
    def.description,
    ...def.coveragePoints,
    ...def.keywords,
  ].join(" ");
}
