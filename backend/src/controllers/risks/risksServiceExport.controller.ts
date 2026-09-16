import type { Request, Response } from "express";
import {
  queryRiskExport,
  type RiskExportQuery,
} from "../../services/risks/risksServiceExport.service.js";

function parseCsv(value: unknown): string[] | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const items = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * GET /api/v1/risks/export — service JSON export for AI-Q.
 * Guarded upstream by `requireServiceKey`. Read-only.
 */
export async function exportRisksForServiceHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const query: RiskExportQuery = {
    limit: parseNumber(req.query.limit),
    cursor: parseString(req.query.cursor),
    sector: parseString(req.query.sector),
    domains: parseCsv(req.query.domains),
    minQuality: parseNumber(req.query.minQuality),
  };

  const result = await queryRiskExport(query);
  res.status(200).json(result);
}
