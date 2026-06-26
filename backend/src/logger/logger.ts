import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import winston from "winston";
import { DatabaseLogTransport } from "./databaseTransport.js";
import { TableFileTransport } from "./tableFileTransport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = process.env.LOG_DIR?.trim()
  ? path.resolve(process.env.LOG_DIR.trim())
  : path.resolve(__dirname, "../../logs");

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

export const applicationLogPath = path.join(logDir, "application.log");
export const errorLogPath = path.join(logDir, "error.log");

const logLevel =
  process.env.LOG_LEVEL?.trim().toLowerCase() ??
  (process.env.NODE_ENV === "production" ? "info" : "debug");

const consoleFormat = winston.format.printf(
  ({ timestamp, level, message, label, stack, ...meta }) => {
    const tag = label ? `[${label}] ` : "";
    const metaKeys = Object.keys(meta).filter((key) => key !== "splat");
    const metaSuffix =
      metaKeys.length > 0 ? ` ${JSON.stringify(meta)}` : "";
    const stackSuffix = stack ? `\n${stack}` : "";
    return `${timestamp} ${tag}${level}: ${message}${metaSuffix}${stackSuffix}`;
  },
);

const rootLogger = winston.createLogger({
  level: logLevel,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        consoleFormat,
      ),
    }),
    new TableFileTransport(applicationLogPath),
    new TableFileTransport(errorLogPath, { level: "error" }),
    new DatabaseLogTransport(),
  ],
});

export function createLogger(label: string): winston.Logger {
  return rootLogger.child({ label });
}

export const logger = createLogger("app");
