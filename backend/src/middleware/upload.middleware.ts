import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import {
  ETL_ALLOWED_EXTENSIONS,
  ETL_MAX_FILE_BYTES,
} from "../etl/etlImport.types.js";
import { HttpError } from "../utils/httpError.js";

const storage = multer.memoryStorage();

function isAllowedExtension(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return ETL_ALLOWED_EXTENSIONS.includes(ext as (typeof ETL_ALLOWED_EXTENSIONS)[number]);
}

const upload = multer({
  storage,
  limits: { fileSize: ETL_MAX_FILE_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (!isAllowedExtension(file.originalname)) {
      cb(
        HttpError.badRequest(
          `Unsupported file type. Allowed: ${ETL_ALLOWED_EXTENSIONS.join(", ")}`,
        ),
      );
      return;
    }
    cb(null, true);
  },
}).single("file");

function mapMulterError(err: unknown): HttpError | null {
  if (!(err instanceof multer.MulterError)) return null;

  if (err.code === "LIMIT_FILE_SIZE") {
    const maxMb = Math.round(ETL_MAX_FILE_BYTES / (1024 * 1024));
    return HttpError.badRequest(
      `File is too large. Maximum upload size is ${maxMb} MB.`,
    );
  }

  return HttpError.badRequest(err.message);
}

export function etlUploadMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  upload(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    const mapped = mapMulterError(err);
    next(mapped ?? err);
  });
}
