import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { databaseUrlFromParts } from "./config/databaseDefaults.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

loadEnv({ path: path.join(projectRoot, ".env.local") });
loadEnv({ path: path.join(projectRoot, ".env") });

if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = databaseUrlFromParts();
}

if (process.env.NODE_ENV !== "production") {
  if (
    !process.env.JWT_ACCESS_SECRET?.trim() ||
    process.env.JWT_ACCESS_SECRET.length < 32
  ) {
    process.env.JWT_ACCESS_SECRET =
      "temporary-dev-jwt-access-secret-min-32-chars!";
  }
  if (
    !process.env.JWT_REFRESH_SECRET?.trim() ||
    process.env.JWT_REFRESH_SECRET.length < 32
  ) {
    process.env.JWT_REFRESH_SECRET =
      "temporary-dev-jwt-refresh-secret-min-32-chars!";
  }
  if (
    !process.env.WEBHOOK_SIGNING_SECRET?.trim() ||
    process.env.WEBHOOK_SIGNING_SECRET.length < 32
  ) {
    process.env.WEBHOOK_SIGNING_SECRET =
      "temporary-dev-webhook-signing-secret-min-32!";
  }
}

if (process.env.BACKEND_PORT?.trim() && !process.env.PORT?.trim()) {
  process.env.PORT = process.env.BACKEND_PORT;
}

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5005),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (postgres connection string)"),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),

  ACCESS_TOKEN_TTL: z.string().default("45m"),
  REFRESH_TOKEN_TTL: z.string().default("7d"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  CORS_ORIGIN: z.string().default(process.env.BASE_URL || ""),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(8).max(15).default(10),

  EMAIL_SERVICE_TYPE: z.enum(["gmail", "office365", "none"]).default("none"),
  SENDER_EMAIL_ID: z.string().optional(),
  SENDER_EMAIL_PASSWORD: z.string().optional(),
  /** App origin for invite links (set-password page), e.g. http://localhost:5176 */
  INVITE_APP_URL: z.string().default(process.env.BASE_URL || ""),

  /** HMAC secret for inbound API-key webhooks (≥32 chars). */
  WEBHOOK_SIGNING_SECRET: z
    .string()
    .min(32, "WEBHOOK_SIGNING_SECRET must be at least 32 characters"),
  /** Event type that triggers API key generation. */
  WEBHOOK_API_KEY_EVENT: z.string().default("api_key.generate"),
  /** Max webhook requests per window (dedicated limiter). */
  WEBHOOK_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000),
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  /** Max API-key create requests per window (JWT-authenticated). */
  API_KEY_CREATE_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000),
  API_KEY_CREATE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
