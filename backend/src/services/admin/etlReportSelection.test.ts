import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeReportRefSelection } from "./etlReportSelection.js";

describe("mergeReportRefSelection", () => {
  it("keeps all upload refs when nothing is excluded", () => {
    const refs = mergeReportRefSelection({
      uploadRefs: [
        { id: 1, uploadId: 10 },
        { id: 2, uploadId: 10 },
      ],
      reportRefs: [],
    });
    assert.deepEqual(
      refs.map((row) => row.id),
      [1, 2],
    );
  });

  it("adds individual report refs from other uploads", () => {
    const refs = mergeReportRefSelection({
      uploadRefs: [{ id: 1, uploadId: 10 }],
      reportRefs: [{ id: 9, uploadId: 11 }],
    });
    assert.deepEqual(
      refs.map((row) => row.id).sort((a, b) => a - b),
      [1, 9],
    );
  });

  it("drops excluded ids from fully selected uploads", () => {
    const refs = mergeReportRefSelection({
      uploadRefs: [
        { id: 1, uploadId: 10 },
        { id: 2, uploadId: 10 },
        { id: 3, uploadId: 10 },
      ],
      reportRefs: [],
      excludeReportIds: [2],
    });
    assert.deepEqual(
      refs.map((row) => row.id),
      [1, 3],
    );
  });

  it("dedupes the same report when it appears in both lists", () => {
    const refs = mergeReportRefSelection({
      uploadRefs: [{ id: 1, uploadId: 10 }],
      reportRefs: [{ id: 1, uploadId: 10 }],
    });
    assert.equal(refs.length, 1);
    assert.equal(refs[0]?.id, 1);
  });
});
