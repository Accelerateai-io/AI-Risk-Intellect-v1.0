"""AIRI extraction baseline (BUG-07 / BUG-21 / BUG-06).

Reads the gold set and prints today's numbers, so every remediation PR has a
number to beat. Standard library only.

Usage:
  python python/app/evals/baseline.py docs/remediation/gold_set/gold_set.jsonl
  python python/app/evals/baseline.py <gold.jsonl> --split test --json out.json
  python python/app/evals/baseline.py <gold.jsonl> --check   # exit 1 if a label > 50%
"""
import argparse
import collections
import json
import statistics
import sys

FAILURE_CODES = ["guess_as_fact", "safeguard_assumed_absent", "solution_blamed",
                 "severity_overreach", "classification_wrong", "other_or_correct"]
WITHDRAWN = {"R-12222", "R-12332", "R-12388"}
COLLAPSE_LIMIT = 0.50  # README definition of done: no label above 50%


def load(path, split):
    rows = [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]
    return rows if split == "all" else [r for r in rows if r.get("split") == split]


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def codes(row):
    confirmed = row.get("failure_codes_confirmed") or ""
    if confirmed.strip():
        return [c.strip() for c in confirmed.replace(";", ",").split(",") if c.strip()], True
    return list(row.get("failure_codes") or []), False


def top_share(counter, n):
    if not counter or not n:
        return None, 0.0
    label, count = counter.most_common(1)[0]
    return label, count / n


def compute(rows):
    n = len(rows)
    rec = lambda r: r.get("record") or {}
    status = collections.Counter(r.get("review_status") for r in rows)
    domain = collections.Counter(rec(r).get("Domain") for r in rows)
    secondary = collections.Counter(rec(r).get("Secondary Risk") for r in rows)

    q = collections.defaultdict(list)
    high = collections.Counter()
    low_li = 0
    for r in rows:
        s = r.get("review_status")
        v = num(rec(r).get("Quality Score"))
        if v is not None:
            q[s].append(v / 100 if v > 1 else v)
        if str(rec(r).get("Confidence", "")).upper() == "HIGH":
            high[s] += 1
        li = [num(rec(r).get("Likelihood (1-5)")), num(rec(r).get("Impact (1-5)"))]
        if any(x is not None and x <= 2 for x in li):
            low_li += 1

    fc = collections.Counter()
    confirmed_rows = 0
    for r in rows:
        c, was_confirmed = codes(r)
        confirmed_rows += was_confirmed
        fc.update(c)

    d_label, d_share = top_share(domain, n)
    s_label, s_share = top_share(secondary, n)
    return {
        "records": n,
        "review_status": dict(status),
        "label_collapse": {
            "top_domain": d_label, "top_domain_share": round(d_share, 3),
            "top_secondary": s_label, "top_secondary_share": round(s_share, 3),
            "distinct_secondary": len([k for k in secondary if k]),
            "passes_50pct_rule": d_share <= COLLAPSE_LIMIT and s_share <= COLLAPSE_LIMIT,
        },
        "self_score_gate": {
            "mean_quality_rejected": round(statistics.mean(q["Rejected"]), 3) if q["Rejected"] else None,
            "mean_quality_approved": round(statistics.mean(q["Approved"]), 3) if q["Approved"] else None,
            "high_confidence_but_rejected": high["Rejected"],
        },
        "severity_spread": {"records_with_L_or_I_at_most_2": low_li},
        "failure_codes": {k: fc.get(k, 0) for k in FAILURE_CODES},
        "failure_codes_source": f"{confirmed_rows} confirmed by reviewer, {n - confirmed_rows} auto-tagged",
        "source_coverage": dict(collections.Counter(
            (r.get("source_coverage") or "unknown").split(";")[0] for r in rows)),
        "withdrawn_sources_in_set": sorted(WITHDRAWN & {r.get("risk_id") for r in rows}),
        "extraction_models": dict(collections.Counter(r.get("extraction_model") for r in rows)),
        "not_yet_measurable": [
            "field accuracy vs human-corrected answer",
            "likelihood / impact MAE",
            "reviewer-correction rate",
        ],
        "why_not_measurable": "gold set holds one version per record; needs the plan section 5 export "
                              "(model_original + human_corrected) to compare.",
    }


def report(m, split):
    lc, sg = m["label_collapse"], m["self_score_gate"]
    out = [f"AIRI baseline — split: {split} — {m['records']} records",
           f"  Review status: {m['review_status']}",
           f"  Top domain: {lc['top_domain']} at {lc['top_domain_share']:.0%}",
           f"  Top secondary: {lc['top_secondary']} at {lc['top_secondary_share']:.0%} "
           f"({lc['distinct_secondary']} distinct used)",
           f"  50% label rule: {'PASS' if lc['passes_50pct_rule'] else 'FAIL'}",
           f"  Self-score: rejected {sg['mean_quality_rejected']} vs approved {sg['mean_quality_approved']}; "
           f"HIGH confidence but rejected: {sg['high_confidence_but_rejected']}",
           f"  Records scoring L or I at 1-2: {m['severity_spread']['records_with_L_or_I_at_most_2']}",
           f"  Failure codes ({m['failure_codes_source']}): {m['failure_codes']}",
           f"  Source coverage: {m['source_coverage']}",
           f"  Withdrawn sources in this split: {m['withdrawn_sources_in_set'] or 'none'}",
           f"  Extraction model(s): {m['extraction_models']}",
           f"  Not yet measurable: {', '.join(m['not_yet_measurable'])}",
           f"    ({m['why_not_measurable']})"]
    return "\n".join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("gold")
    p.add_argument("--split", default="all", choices=["all", "train", "validation", "test"])
    p.add_argument("--json", help="write metrics JSON here")
    p.add_argument("--check", action="store_true", help="exit 1 if a label exceeds 50%%")
    a = p.parse_args(argv)
    m = compute(load(a.gold, a.split))
    print(report(m, a.split))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(m, f, indent=2)
    if a.check and not m["label_collapse"]["passes_50pct_rule"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
