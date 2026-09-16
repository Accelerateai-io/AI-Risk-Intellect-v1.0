import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { logger } from "../../logger/logger.js";
import type { CatalogRiskMatch } from "./riskCatalogMatch.service.js";

/**
 * LLM judge for catalog matches: reads the extracted risk plus the top
 * heuristic candidates and decides, per candidate, whether the catalog entry
 * describes the same underlying risk mechanism. Roughly $0.005 and 3–6s per
 * article on Haiku; disable with MATCH_JUDGE_ENABLED=false.
 */

export const JUDGE_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const MAX_CANDIDATES = 5;
const MAX_OUTPUT_TOKENS = 1200;

/** Blend: judge opinion dominates but the heuristic anchors the score. */
const JUDGE_BLEND_WEIGHT = 0.6;
/** A judged non-match can never present above this. */
const NO_MATCH_CAP_PERCENT = 35;

export type JudgeVerdict = {
  riskId: string;
  isMatch: boolean;
  adjustedPercent: number;
  reasoning: string;
};

const verdictSchema = z.object({
  verdicts: z
    .array(
      z.object({
        risk_id: z.string().min(1),
        is_match: z.boolean(),
        adjusted_percent: z.number().min(0).max(100),
        reasoning: z.string(),
      }),
    )
    .min(1),
});

export function isJudgeEnabled(): boolean {
  return process.env.MATCH_JUDGE_ENABLED !== "false";
}

let client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
    });
  }
  return client;
}

const SYSTEM_PROMPT = `You are a strict risk-taxonomy matching judge. You compare ONE extracted AI risk against up to ${MAX_CANDIDATES} catalog risk entries and decide, per entry, whether the catalog entry describes the same underlying risk mechanism.

Similar topic is NOT a match: the failure mode, actor/intent, and harmed party must align.

Return ONLY JSON, no markdown, in exactly this shape:
{"verdicts":[{"risk_id":"...","is_match":true,"adjusted_percent":0,"reasoning":"<=30 words"}]}
Include one verdict per candidate, using each candidate's risk_id verbatim.

Calibration for adjusted_percent:
- 80-100: same mechanism AND same context
- 60-79: same mechanism, different context
- 40-59: related mechanism
- 0-39: topical overlap only
Use the full range; do not cluster values.`;

export type JudgeRiskInput = {
  title: string;
  description: string;
  domain: string | null;
  primaryRisk?: string | null;
  secondaryRisk?: string | null;
  keywordMatches?: string[];
};

function buildUserPrompt(
  risk: JudgeRiskInput,
  candidates: CatalogRiskMatch[],
): string {
  const lines: string[] = [
    "EXTRACTED RISK",
    `Title: ${risk.title}`,
    `Description: ${risk.description}`,
    `Domain: ${risk.domain ?? "unknown"}`,
    `Primary: ${risk.primaryRisk ?? "unknown"} / Secondary: ${risk.secondaryRisk ?? "unknown"}`,
  ];
  if (risk.keywordMatches?.length) {
    lines.push(`Keywords: ${risk.keywordMatches.slice(0, 15).join(", ")}`);
  }
  lines.push("", "CANDIDATES");
  candidates.forEach((candidate, index) => {
    lines.push(
      `${index + 1}) risk_id=${candidate.riskId}`,
      `   Title: ${candidate.title}`,
      `   Domain: ${candidate.domain}`,
      `   Description: ${candidate.description.slice(0, 400)}`,
    );
  });
  return lines.join("\n");
}

/** Exported for tests. */
export function parseVerdicts(
  raw: string,
  candidates: CatalogRiskMatch[],
): JudgeVerdict[] | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = verdictSchema.safeParse(parsed);
  if (!result.success) return null;

  const candidateIds = new Set(candidates.map((c) => c.riskId));
  const verdicts = result.data.verdicts
    .filter((v) => candidateIds.has(v.risk_id))
    .map((v) => ({
      riskId: v.risk_id,
      isMatch: v.is_match,
      adjustedPercent: Math.round(v.adjusted_percent),
      reasoning: v.reasoning.trim(),
    }));
  return verdicts.length > 0 ? verdicts : null;
}

async function invokeJudge(
  risk: JudgeRiskInput,
  candidates: CatalogRiskMatch[],
): Promise<string> {
  const response = await getClient().send(
    new InvokeModelCommand({
      modelId: JUDGE_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildUserPrompt(risk, candidates) },
        ],
      }),
    }),
  );
  const decoded = JSON.parse(new TextDecoder().decode(response.body)) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return (decoded.content ?? [])
    .map((block) => block.text ?? "")
    .join("")
    .trim();
}

function isRetryableError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  return (
    name === "ThrottlingException" ||
    name === "ServiceUnavailableException" ||
    name === "ModelTimeoutException"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let unavailableLogged = false;

/**
 * Judge the top candidates in one call. Returns null when the judge is
 * unavailable or its output is unusable — callers keep heuristic scores.
 */
export async function judgeCatalogMatches(input: {
  risk: JudgeRiskInput;
  candidates: CatalogRiskMatch[];
}): Promise<JudgeVerdict[] | null> {
  const candidates = input.candidates.slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await invokeJudge(input.risk, candidates);
      const verdicts = parseVerdicts(raw, candidates);
      if (verdicts) return verdicts;
      logger.warn("Match judge returned unparsable output", { attempt });
    } catch (err) {
      if (isRetryableError(err) && attempt === 1) {
        await sleep(1000 + Math.random() * 500);
        continue;
      }
      if (!unavailableLogged) {
        unavailableLogged = true;
        logger.warn("Match judge unavailable; keeping heuristic scores", {
          message: (err as Error)?.message,
          name: (err as { name?: string })?.name,
        });
      }
      return null;
    }
  }
  return null;
}

/**
 * Judge `matches` and blend the verdicts back in. Returns the matches
 * unchanged when the judge is unavailable.
 */
export async function judgeAndApplyVerdicts(
  matches: CatalogRiskMatch[],
  risk: JudgeRiskInput,
): Promise<CatalogRiskMatch[]> {
  const verdicts = await judgeCatalogMatches({ risk, candidates: matches });
  return verdicts ? applyJudgeVerdicts(matches, verdicts) : matches;
}

export function applyJudgeVerdicts(
  matches: CatalogRiskMatch[],
  verdicts: JudgeVerdict[],
): CatalogRiskMatch[] {
  const byId = new Map(verdicts.map((v) => [v.riskId, v]));
  return matches
    .map((match) => {
      const verdict = byId.get(match.riskId);
      if (!verdict) return match;
      const heuristic = match.heuristicPercent ?? match.accuracyPercent;
      let blended = Math.round(
        (1 - JUDGE_BLEND_WEIGHT) * heuristic +
          JUDGE_BLEND_WEIGHT * verdict.adjustedPercent,
      );
      if (!verdict.isMatch) {
        blended = Math.min(blended, NO_MATCH_CAP_PERCENT);
      }
      const updated: CatalogRiskMatch = {
        ...match,
        accuracyPercent: blended,
        heuristicPercent: heuristic,
        judgeVerdict: verdict.isMatch ? "match" : "no_match",
      };
      if (verdict.reasoning) updated.judgeReasoning = verdict.reasoning;
      return updated;
    })
    .sort((a, b) => b.accuracyPercent - a.accuracyPercent);
}
