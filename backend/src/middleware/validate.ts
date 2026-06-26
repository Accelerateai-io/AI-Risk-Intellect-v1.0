import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { HttpError } from "../utils/httpError.js";

type Source = "body" | "query" | "params";

export const validate =
  <T>(schema: ZodType<T>, source: Source = "body") =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const data = req[source];
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      next(
        HttpError.badRequest("Validation failed", parsed.error.issues),
      );
      return;
    }
    if (source === "body") {
      req.body = parsed.data as Request["body"];
    } else if (source === "query") {
      Object.assign(req.query as Record<string, unknown>, parsed.data);
    } else {
      Object.assign(req.params as Record<string, unknown>, parsed.data);
    }
    next();
  };
