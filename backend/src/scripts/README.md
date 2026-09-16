# Risk-matching maintenance scripts — rollout runbook

Operational scripts for the catalog-matching overhaul. Run them **in the order
below**; each is safe to re-run (idempotent / resumable). None of them change
scoring formulas, weights, thresholds, prompts, embeddings, or the taxonomy —
they only (re)compute and persist matches using the existing pipeline.

## Order of operations

1. **`npm run backfill:catalog-embeddings`** — *run FIRST.*
   Embeds every `risk_mappings` row into `risk_mapping_embeddings`. Until this
   completes, catalog matching degrades to lexical scoring. Safe to re-run;
   rows whose text hash is unchanged are skipped. Conservative Bedrock
   concurrency (2); ~15–25 min for ~1,250 rows. Running API/worker processes
   pick up new embeddings within the 5-minute catalog-cache TTL.

2. **`npm run backfill:matches`** — *run AFTER step 1.*
   Re-scores catalog matches for existing risks using the current pipeline
   (evidence + embeddings + optional judge). Review state is untouched.
   Emits a **preflight warning** if catalog embeddings are missing (step 1 not
   done). Per-record failures are isolated and counted — one bad row cannot
   abort the run. Flags: `--limit N`, `--no-judge`, `--dry-run`, `--force`,
   `--sleep-ms N`.

3. **`npm run reextract:all`** — *optional, heavy.*
   Full LLM re-extraction of every article that has risks, review state
   preserved. Requires the Python extraction service. Sequential and resumable
   (`--start-after <articleId>`); budget ~35–70s/article. Flags: `--limit`,
   `--dry-run`, `--sleep-ms`, `--force`.

## Verification / calibration

- **`npm run report:match-distribution`** — read-only. Recomputes matches for a
  random sample in lexical-only vs. +embeddings modes and prints mean / stdev /
  decile histograms. Use it to confirm scores discriminate and to calibrate
  `EMBEDDING_SCORE_FLOOR` / `EMBEDDING_SCORE_CEIL` when the corpus shifts.
  Add `--judge` to sample judge-adjusted scores (~$0.005 per sampled risk).

## Notes

- `risk_mappings` is read-only at runtime (loaded from backup / `pg_restore`);
  there is no runtime catalog-edit path, so the in-memory catalog cache relies
  on its 5-minute TTL rather than explicit invalidation.
- Judge is env-gated (`MATCH_JUDGE_ENABLED`, default on) and the evidence gate
  is env-gated (`MATCH_EVIDENCE_GATE_ENABLED`, default off) — both act as
  rollout kill-switches.
