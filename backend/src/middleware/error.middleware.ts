import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { ETL_MAX_FILE_BYTES } from "../etl/etlImport.types.js";
import { env } from "../env.js";
import { createLogger } from "../logger/index.js";
import { HttpError } from "../utils/httpError.js";
import { getRequestClientInfo } from "../utils/requestClient.js";

const errorLog = createLogger("error");

export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(HttpError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const httpLike =
    err instanceof HttpError
      ? err
      : err &&
          typeof err === "object" &&
          typeof (err as { status?: unknown }).status === "number" &&
          typeof (err as { message?: unknown }).message === "string" &&
          (err as { status: number }).status >= 400 &&
          (err as { status: number }).status < 600
        ? (err as {
            status: number;
            message: string;
            code?: string;
            details?: unknown;
          })
        : null;

  if (httpLike) {
    res.status(httpLike.status).json({
      error: {
        code: httpLike.code ?? (httpLike.status === 409 ? "CONFLICT" : "ERROR"),
        message: httpLike.message,
        details: httpLike.details ?? undefined,
      },
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? `File is too large. Maximum upload size is ${Math.round(ETL_MAX_FILE_BYTES / (1024 * 1024))} MB.`
        : err.message;
    res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Validation failed",
        details: err.issues,
      },
    });
    return;
  }

  errorLog.error("Unhandled error", {
    err,
    ...getRequestClientInfo(req),
    method: req.method,
    path: req.originalUrl,
  });

  const rawMessage = err instanceof Error ? err.message : String(err);
  const pgMessage = /value too long/i.test(rawMessage)
    ? "The model id is too long to save on this job."
    : /does not exist/i.test(rawMessage)
      ? "A required database column is missing. Restart the API so schema updates can apply."
      : null;

  res.status(pgMessage ? 400 : 500).json({
    error: {
      code: pgMessage ? "BAD_REQUEST" : "INTERNAL",
      message: pgMessage ?? "Internal server error",
      details: env.NODE_ENV === "development" ? rawMessage : undefined,
    },
  });
}