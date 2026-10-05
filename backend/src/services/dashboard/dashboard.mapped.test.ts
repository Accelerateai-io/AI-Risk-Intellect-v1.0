import assert from "node:assert/strict";
import { test } from "node:test";
import { filterDashboardMappedRisks } from "./dashboard.service.js";

const privacy = "Privacy and Security";

test("catalog holds are not counted as mapped", () => {
  const heldOnCatalog = {
    domains: privacy,
    qualityScore: 94,
    extractionJson: {
      source_language: "en",
      catalog_matches: [{ judgeVerdict: "no_match" }],
    },
  };
  const mapped = {
    domains: privacy,
    qualityScore: 94,
    extractionJson: {
      source_language: "en",
      catalog_matches: [{ judgeVerdict: "match" }],
    },
  };

  const visible = filterDashboardMappedRisks([heldOnCatalog, mapped]);
  assert.deepEqual(visible, [mapped]);
});

test("an approved catalog hold stays on the mapped register", () => {
  const approved = {
    domains: privacy,
    qualityScore: 94,
    extractionJson: {
      review_status: "approved",
      source_language: "en",
      catalog_matches: [{ judgeVerdict: "no_match" }],
    },
  };
  assert.equal(filterDashboardMappedRisks([approved]).length, 1);
});
