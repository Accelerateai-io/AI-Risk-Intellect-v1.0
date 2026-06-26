import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./env.js";
import { initDB } from "./database/db.js";
import { httpLoggerMiddleware, logger } from "./logger/index.js";
import { resumeActiveCronJobServices } from "./services/admin/cronJobs.service.js";
import { apiRouter } from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";

const app = express();

app.set("trust proxy", true);

const allowedOrigins = new Set(
  env.CORS_ORIGIN.split(",")
    .map((s: string) => s.trim())
    .filter(Boolean),
);

const localhostOriginPattern =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

app.use(
  helmet({
    // Default `same-origin` blocks browsers from reading this API from another origin (e.g. Vite on :5176).
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      if (
        env.NODE_ENV !== "production" &&
        localhostOriginPattern.test(origin)
      ) {
        return cb(null, origin);
      }
      return cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Requested-With",
    ],
    credentials: true,
    optionsSuccessStatus: 204,
  }),
);

app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(httpLoggerMiddleware);

app.use("/api/v1", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

try {
  await initDB();
  await resumeActiveCronJobServices();
  app.listen(env.PORT, () => {
    logger.info("Server listening", { port: env.PORT });
  });
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  logger.error("Server failed to start", { message, err });
  process.exitCode = 1;
}
