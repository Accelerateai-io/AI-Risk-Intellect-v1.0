import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideRiskWriteMode } from "./extractRisk.service.js";

// B-3: re-running an article (e.g. arXiv 2304.10041) with force_reprocess must
// insert a NEW risk row that supersedes the existing one, bypassing dedup.
// Earlier rows stay for audit and are retired from published status.
// decideRiskWriteMode is the pure gate that drives which DB path
// extractRiskForArticle takes.
describe("decideRiskWriteMode (B-3 force reprocess)", () => {
  it("re-running an article with an existing risk inserts a new superseding row", () => {
    assert.equal(
      decideRiskWriteMode({ hasExisting: true, forceReprocess: true }),
      "reprocess-new",
    );
  });

  it("force reprocess with no existing risk just inserts a fresh row", () => {
    assert.equal(
      decideRiskWriteMode({ hasExisting: false, forceReprocess: true }),
      "insert-new",
    );
  });

  it("force reprocess wins over force reextract (new row, not in-place rebuild)", () => {
    assert.equal(
      decideRiskWriteMode({
        hasExisting: true,
        forceReprocess: true,
        forceReextract: true,
      }),
      "reprocess-new",
    );
  });

  it("force reextract alone still rebuilds the existing row in place", () => {
    assert.equal(
      decideRiskWriteMode({ hasExisting: true, forceReextract: true }),
      "reextract-in-place",
    );
  });

  it("an existing risk without any flag is refreshed, not duplicated", () => {
    assert.equal(
      decideRiskWriteMode({ hasExisting: true }),
      "refresh-existing",
    );
  });

  it("a first extraction with no existing risk inserts a new row", () => {
    assert.equal(decideRiskWriteMode({ hasExisting: false }), "insert-new");
  });
});
