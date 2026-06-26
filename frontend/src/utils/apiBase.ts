/**
 * API root from `.env.local` (`VITE_BASE_URL`), no trailing slash.
 * Include the versioned API path in the value, e.g. `http://localhost:5005/api/v1`.
 * Leave empty only if you use same-origin relative URLs (resource `path` must then be
 * browser-routable to your API, e.g. via a dev proxy).
 */
export function getApiBaseUrl(): string {
  const v = import.meta.env.VITE_BASE_URL;
  if (v == null || String(v).trim() === "") return "";
  return String(v).trim().replace(/\/$/, "");
}

function normalizeResourcePath(path: string): string {
  let p = path.startsWith("/") ? path : `/${path}`;
  const re = /^\/api\/v\d+(?=\/|$)/i;
  if (re.test(p)) {
    p = p.replace(re, "") || "/";
  }
  return p;
}

export type ApiUrlOptions = {
  /** When set (including `""`), use this base instead of `VITE_BASE_URL` (e.g. Settings “Test connection”). */
  base?: string;
};

/**
 * Join API base + resource path (e.g. `/health`, `/auth/login`).
 * If `path` still starts with `/api/vN` after normalization, strips it so
 * `.../api/v1` + `/api/v1/...` does not duplicate.
 */
export function apiUrl(path: string, options?: ApiUrlOptions): string {
  const baseArg = options?.base;
  const base =
    baseArg !== undefined
      ? String(baseArg).trim().replace(/\/$/, "")
      : getApiBaseUrl().trim().replace(/\/$/, "");
  const p = normalizeResourcePath(path);

  if (!base) {
    return p;
  }

  const joined = `${base}${p}`;
  return joined.replace(/\/api\/(v\d+)\/api\//i, "/api/$1/");
}
