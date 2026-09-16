/**
 * Load `.env` before DB / worker modules (used by server, job worker, discovery).
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseUrlFromParts } from "./config/databaseDefaults.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

loadEnv({ path: path.join(projectRoot, ".env.local") });
loadEnv({ path: path.join(projectRoot, ".env") });

if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = databaseUrlFromParts();
}

if (process.env.BACKEND_PORT?.trim() && !process.env.PORT?.trim()) {
  process.env.PORT = process.env.BACKEND_PORT;
}
