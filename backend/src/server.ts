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

/** Trust the reverse proxy hop (nginx). Boolean `true` trips express-rate-limit. */
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY ?? "1", 10);
app.set(
  "trust proxy",
  Number.isInteger(trustProxyHops) && trustProxyHops >= 1 ? trustProxyHops : 1,
);

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
      "X-Api-Key",
      "X-Webhook-Signature",
      "X-Webhook-Timestamp",
      "X-Webhook-Delivery-Id",
    ],
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
    optionsSuccessStatus: 204,
  }),
);

app.use(cookieParser());

/** Preserve raw body for HMAC verification on webhook routes. */
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      const url = req.url ?? "";
      if (url.includes("/webhooks/")) {
        (req as typeof req & { rawBody?: string }).rawBody = buf.toString("utf8");
      }
    },
  }),
);
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
