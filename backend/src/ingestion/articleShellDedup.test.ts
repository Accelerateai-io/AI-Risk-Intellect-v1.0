import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isEmptyArticleShell,
  reassignJobAndDropEmptyShell,
  runDedupShellCleanup,
  type ArticleShellRow,
  type DedupShellTx,
} from "./articleShellDedup.js";

type State = {
  jobArticleId: number;
  jobStatus: string;
  shell: ArticleShellRow | null;
  risks: number;
  otherJobs: number;
  deleted: boolean;
};

function memoryTx(state: State, opts?: { failDelete?: boolean }): DedupShellTx {
  return {
    async reassignJob(_jobId, shellArticleId, canonicalArticleId) {
      if (state.jobArticleId === shellArticleId) {
        state.jobArticleId = canonicalArticleId;
      }
    },
    async loadShell(articleId) {
      if (!state.shell || state.shell.id !== articleId || state.deleted) return null;
      return state.shell;
    },
    async countRisks() {
      return state.risks;
    },
    async countOtherJobs() {
      return state.otherJobs;
    },
    async deleteShell() {
      if (opts?.failDelete) {
        throw new Error("delete failed");
      }
      state.deleted = true;
      state.shell = null;
    },
  };
}

const input = { jobId: 226, shellArticleId: 42, canonicalArticleId: 41 };

function emptyState(): State {
  return {
    jobArticleId: 42,
    jobStatus: "running",
    shell: { id: 42, title: null, rawText: null, html: null },
    risks: 0,
    otherJobs: 0,
    deleted: false,
  };
}

describe("empty article shell on dedupe hit", () => {
  it("treats a title-less shell with no body as empty", () => {
    assert.equal(
      isEmptyArticleShell({ title: null, rawText: null, html: "  " }),
      true,
    );
    assert.equal(
      isEmptyArticleShell({ title: "Rite Aid", rawText: null, html: null }),
      false,
    );
  });

  it("reassigns the job to the canonical article and deletes the empty shell", async () => {
    const state = emptyState();
    const result = await reassignJobAndDropEmptyShell(memoryTx(state), input);
    assert.equal(result.deletedShell, true);
    assert.equal(result.blocker, null);
    assert.equal(state.jobArticleId, 41);
    assert.equal(state.jobStatus, "running");
    assert.equal(state.deleted, true);
  });

  it("keeps an article that already has content", async () => {
    const state = emptyState();
    state.shell = { id: 42, title: null, rawText: "stored body", html: null };
    const result = await reassignJobAndDropEmptyShell(memoryTx(state), input);
    assert.equal(result.deletedShell, false);
    assert.equal(result.blocker, "content");
    assert.equal(state.jobArticleId, 41);
    assert.equal(state.deleted, false);
  });

  it("keeps the shell when risks or other jobs still reference it", async () => {
    const withRisks = emptyState();
    withRisks.risks = 1;
    const riskResult = await reassignJobAndDropEmptyShell(memoryTx(withRisks), input);
    assert.equal(riskResult.blocker, "risks");
    assert.equal(withRisks.deleted, false);
    assert.equal(withRisks.jobArticleId, 41);

    const withJobs = emptyState();
    withJobs.otherJobs = 1;
    const jobResult = await reassignJobAndDropEmptyShell(memoryTx(withJobs), input);
    assert.equal(jobResult.blocker, "other_jobs");
    assert.equal(withJobs.deleted, false);
  });

  it("rolls the reassignment back when shell deletion fails", async () => {
    const committed: State = emptyState();
    await assert.rejects(() =>
      runDedupShellCleanup(async (fn) => {
        const working: State = {
          ...committed,
          shell: committed.shell ? { ...committed.shell } : null,
        };
        try {
          return await fn(memoryTx(working, { failDelete: true }));
        } catch (err) {
          throw err;
        }
      }, input),
    );
    assert.equal(committed.jobArticleId, 42);
    assert.equal(committed.jobStatus, "running");
    assert.equal(committed.deleted, false);
    assert.equal(committed.shell?.id, 42);
  });
});
