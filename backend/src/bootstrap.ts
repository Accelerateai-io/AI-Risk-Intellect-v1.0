/**
 * Load `.env` before DB / worker modules (used by server, job worker, discovery).
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

loadEnv({ path: path.join(projectRoot, ".env.local") });
loadEnv({ path: path.join(projectRoot, ".env") });

if (!process.env.DATABASE_URL?.trim()) {
  const user = process.env.DATABASE_USER ?? "postgres";
  const password = process.env.DATABASE_PASSWORD ?? "Postgresql123";
  const host = process.env.DATABASE_HOST ?? "localhost";
  const port = process.env.DATABASE_PORT ?? "5432";
  const name = process.env.DATABASE_NAME ?? "ai_risk_db";
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

if (process.env.BACKEND_PORT?.trim() && !process.env.PORT?.trim()) {
  process.env.PORT = process.env.BACKEND_PORT;
}
