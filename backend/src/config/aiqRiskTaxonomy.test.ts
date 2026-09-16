import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATALOG_DOMAINS } from "./aiqRiskTaxonomy.js";
import { normalizeLabelToCatalogDomain } from "../services/risks/riskDomainResolver.service.js";

/**
 * The domain taxonomy exists in two places: CATALOG_DOMAINS here (canonical, what
 * risks.domains and risk_mappings.domains store) and the numbered list the
 * extraction LLM is given in python/app/llm/system_prompt.txt
 * ("2. Privacy & Security"). normalizeLabelToCatalogDomain is the bridge.
 *
 * They can drift independently, and a drift is silent: an unmapped label makes
 * isDomainInTaxonomy false, which quietly routes the risk to the review queue
 * instead of the API. These tests fail loudly instead.
 */

const SYSTEM_PROMPT_PATH = fileURLToPath(
  new URL("../../../python/app/llm/system_prompt.txt", import.meta.url),
);

/** The numbered domain labels the prompt tells the model to choose from. */
function promptDomainLabels(): string[] {
  const prompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");
  const section = prompt.split("DOMAINS (Choose EXACTLY ONE):")[1] ?? "";
  const upToNextSection = section.split("PRIMARY RISKS")[0] ?? "";
  return [...upToNextSection.matchAll(/^\s*\d+\.\s*"([^"]+)"/gm)].map((m) => m[1]);
}

describe("domain taxonomy stays aligned with the extraction prompt", () => {
  const labels = promptDomainLabels();

  it("finds the prompt's domain list", () => {
    assert.equal(
      labels.length,
      CATALOG_DOMAINS.length,
      `system_prompt.txt lists ${labels.length} domains, CATALOG_DOMAINS has ${CATALOG_DOMAINS.length}: ${labels.join(" | ")}`,
    );
  });

  it("maps every prompt label onto a canonical domain", () => {
    for (const label of labels) {
      const canonical = normalizeLabelToCatalogDomain(label);
      assert.ok(
        canonical != null,
        `Prompt domain ${JSON.stringify(label)} does not normalize to any CATALOG_DOMAINS value. Add it to normalizeLabelToCatalogDomain, or align the prompt.`,
      );
      assert.ok(
        (CATALOG_DOMAINS as readonly string[]).includes(canonical),
        `Prompt domain ${JSON.stringify(label)} normalized to ${JSON.stringify(canonical)}, which is not in CATALOG_DOMAINS.`,
      );
    }
  });

  it("covers all seven canonical domains exactly once", () => {
    const mapped = labels
      .map((label) => normalizeLabelToCatalogDomain(label))
      .filter((d): d is NonNullable<typeof d> => d != null);
    assert.deepEqual(
      [...mapped].sort(),
      [...CATALOG_DOMAINS].sort(),
      "Prompt labels and CATALOG_DOMAINS do not cover the same seven domains.",
    );
  });

  it("normalizes each canonical domain to itself", () => {
    for (const domain of CATALOG_DOMAINS) {
      assert.equal(
        normalizeLabelToCatalogDomain(domain),
        domain,
        `CATALOG_DOMAINS value ${JSON.stringify(domain)} does not round-trip through normalizeLabelToCatalogDomain.`,
      );
    }
  });
});
