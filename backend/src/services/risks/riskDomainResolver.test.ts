import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIQ_RISK_DOMAIN_DEFINITIONS } from "../../config/aiqRiskTaxonomy.js";
import {
  normalizeLabelToCatalogDomain,
  resolveCatalogDomain,
  scoreDomainsFromDefinitions,
} from "./riskDomainResolver.service.js";

describe("AIQ risk domain definitions", () => {
  it("defines all seven catalog domains", () => {
    const catalogDomains = new Set(
      AIQ_RISK_DOMAIN_DEFINITIONS.map((def) => def.catalogDomain),
    );
    assert.equal(catalogDomains.size, 7);
    assert.ok(catalogDomains.has("Privacy and Security"));
    assert.ok(catalogDomains.has("Discrimination and Toxicity"));
  });

  it("maps AI-Q fairness label to discrimination catalog domain", () => {
    assert.equal(
      normalizeLabelToCatalogDomain("Fairness & Non-discrimination"),
      "Discrimination and Toxicity",
    );
  });

  it("maps AI-Q human oversight label to HCI catalog domain", () => {
    assert.equal(
      normalizeLabelToCatalogDomain("Human Oversight"),
      "Human-Computer Interaction",
    );
  });
});

describe("resolveCatalogDomain", () => {
  it("uses definitions to pick privacy when text describes a data breach", () => {
    const result = resolveCatalogDomain({
      llmDomain: "7. AI System Safety",
      title: "Customer PII exposed in model prompt logs",
      description:
        "A data breach leaked PII and PHI through prompt injection and unauthorized access to confidential records.",
      articleText:
        "Attackers exploited a vulnerability to extract secrets and financial records from the pipeline.",
    });

    assert.equal(result.domain, "Privacy and Security");
    assert.equal(result.method, "definitions");
  });

  it("uses definitions to pick discrimination for biased hiring outcomes", () => {
    const result = resolveCatalogDomain({
      llmDomain: "Privacy & Security",
      title: "Biased resume screening",
      description:
        "The model showed disparate treatment across protected groups and generated toxic stereotypes in hiring recommendations.",
    });

    assert.equal(result.domain, "Discrimination and Toxicity");
    assert.equal(result.method, "definitions");
  });

  it("confirms label when definitions agree", () => {
    const result = resolveCatalogDomain({
      llmDomain: "Misinformation",
      title: "Deepfake political video",
      description:
        "A fabricated deepfake spread false information and misleading claims across social media.",
    });

    assert.equal(result.domain, "Misinformation");
    assert.ok(
      result.method === "label+definitions" || result.method === "label",
    );
  });

  it("scores socioeconomic domain for workforce displacement text", () => {
    const scores = scoreDomainsFromDefinitions(
      "Mass job loss and workforce displacement caused inequitable economic impact and environmental harm from model training.",
    );
    assert.equal(scores[0]?.catalogDomain, "Socioeconomic and Environmental");
    assert.ok((scores[0]?.keywordHits ?? 0) >= 2);
  });
});
