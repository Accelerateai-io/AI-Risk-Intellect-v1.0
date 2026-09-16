import type { NextFunction, Request, Response } from "express";
import { getRequestClientInfo } from "../utils/requestClient.js";
import { createLogger } from "./logger.js";

const httpLog = createLogger("http");

/** High-frequency poll endpoints — skip success logs to keep the terminal readable. */
function shouldSkipHttpLog(req: Request, statusCode: number): boolean {
  if (statusCode >= 400) return false;
  const path = (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
  return req.method === "GET" && path === "/api/v1/notifications";
}

export function httpLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();

  res.on("finish", () => {
    if (shouldSkipHttpLog(req, res.statusCode)) return;

    const durationMs = Date.now() - start;
    const level =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    const client = getRequestClientInfo(req);

    httpLog.log(level, `${req.method} ${req.originalUrl}`, {
      status: res.statusCode,
      durationMs,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      browser: client.browser,
      browserVersion: client.browserVersion,
      os: client.os,
      osVersion: client.osVersion,
      device: client.device,
      deviceType: client.deviceType,
    });
  });

  next();
}
