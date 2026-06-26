import type { NextFunction, Request, Response } from "express";
import { getRequestClientInfo } from "../utils/requestClient.js";
import { createLogger } from "./logger.js";

const httpLog = createLogger("http");

export function httpLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();
  const client = getRequestClientInfo(req);

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const level =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

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
