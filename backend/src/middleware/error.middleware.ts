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
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? undefined,
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
  res.status(500).json({
    error: {
      code: "INTERNAL",
      message: "Internal server error",
      details: env.NODE_ENV === "development" ? String(err) : undefined,
    },
  });
}