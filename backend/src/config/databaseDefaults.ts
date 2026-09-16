/**
 * Single source of truth for Postgres connection defaults when env vars are unset.
 * Change the database name here — `env.ts`, `bootstrap.ts`, and `database/db.ts` all use it.
 */
export const DB_DEFAULTS = {
  user: "postgres",
  password: "Postgresql123",
  host: "localhost",
  port: "5432",
  name: "ai_risk_db",
  // name: "ai_risk_db_server_26Aug2026",
} as const;

export function databaseUrlFromParts(env: NodeJS.ProcessEnv = process.env): string {
  const user = env.DATABASE_USER?.trim() || DB_DEFAULTS.user;
  const password = env.DATABASE_PASSWORD ?? DB_DEFAULTS.password;
  const host = env.DATABASE_HOST?.trim() || DB_DEFAULTS.host;
  const port = env.DATABASE_PORT?.trim() || DB_DEFAULTS.port;
  const name = env.DATABASE_NAME?.trim() || DB_DEFAULTS.name;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}
