import type { Request, Response } from "express";
import {
  getServicesStatus,
  startDiscoveryProcess,
  stopDiscoveryProcess,
} from "../../services/admin/discoveryManager.service.js";
import {
  resolveActiveIngestLinksByIds,
  resolveExtractedItemRefsByIds,
} from "../../services/admin/ingestLinks.service.js";
import {
  getLlmModelConfigAsync,
  invokeLlmModel,
  setLlmModel,
  validateLlmModel,
} from "../../services/admin/llmModelConfig.service.js";
import {
  ensureWorkerProcessRunning,
  startWorkerProcess,
  stopWorkerProcess,
} from "../../services/admin/workerManager.service.js";

function discoveryStartMessage(
  selectedItemCount: number,
  feedCount: number,
): string {
  const feedLabel = `${feedCount} feed${feedCount === 1 ? "" : "s"}`;
  const discoveryPart =
    selectedItemCount > 0
      ? `Discovery enqueued ${selectedItemCount} selected extracted URL${selectedItemCount === 1 ? "" : "s"} from ${feedLabel}.`
      : `Discovery enqueued extracted URLs for ${feedLabel}.`;
  return `${discoveryPart} Worker service started to process ingest jobs.`;
}
import type { SetLlmModelInput, StartDiscoveryInput, InvokeLlmModelInput } from "../../validators/admin.validators.js";

export async function getServicesStatusHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  res.status(200).json({ services: getServicesStatus() });
}

export async function startDiscoveryHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const {
    ingestLinkIds: requestedLinkIds = [],
    ingestLinkItemIds: requestedItemIds = [],
  } = req.body as StartDiscoveryInput;

  const links =
    requestedLinkIds.length > 0
      ? await resolveActiveIngestLinksByIds(requestedLinkIds)
      : [];
  const itemRefs =
    requestedItemIds.length > 0
      ? await resolveExtractedItemRefsByIds(requestedItemIds)
      : [];

  const resolvedLinkIds =
    links.length > 0
      ? links.map((l) => l.id)
      : [...new Set(itemRefs.map((item) => item.ingestLinkId))];

  const { pid } = startDiscoveryProcess({
    ingestLinkIds: resolvedLinkIds,
    ingestLinkItemIds: itemRefs.map((item) => item.id),
  });
  const { pid: workerPid } = ensureWorkerProcessRunning();

  const selectedItemCount = itemRefs.length;
  res.status(200).json({
    ok: true,
    message: discoveryStartMessage(selectedItemCount, resolvedLinkIds.length),
    pid,
    workerPid,
    feedCount: resolvedLinkIds.length,
    selectedItemCount,
    services: getServicesStatus(),
  });
}

export async function stopDiscoveryHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  stopDiscoveryProcess();
  res.status(200).json({
    ok: true,
    message: "Discovery service stop requested.",
    services: getServicesStatus(),
  });
}

export async function startWorkerHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const { pid } = startWorkerProcess();
  res.status(200).json({
    ok: true,
    message: "Worker service started.",
    pid,
    services: getServicesStatus(),
  });
}

export async function stopWorkerHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  stopWorkerProcess();
  res.status(200).json({
    ok: true,
    message: "Worker service stop requested.",
    services: getServicesStatus(),
  });
}

export async function getLlmModelHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const config = await getLlmModelConfigAsync();
  res.status(200).json({ ok: true, ...config });
}

export async function testLlmModelHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { modelId } = req.body as SetLlmModelInput;
  const result = await validateLlmModel(modelId);
  res.status(result.success ? 200 : 400).json(result);
}

export async function invokeLlmModelHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { modelId, prompt, maxTokens, temperature } =
    req.body as InvokeLlmModelInput;
  const result = await invokeLlmModel({
    modelId,
    prompt,
    maxTokens,
    temperature,
  });
  res.status(result.success ? 200 : 400).json(result);
}

export async function setLlmModelHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { modelId } = req.body as SetLlmModelInput;
  try {
    const config = await setLlmModel(modelId);
    res.status(200).json({
      ok: true,
      message: "LLM model updated.",
      ...config,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not update LLM model.";
    res.status(400).json({
      ok: false,
      error: { message },
    });
  }
}
