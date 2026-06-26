/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend API root (no trailing slash), including version path, e.g. `http://localhost:5005/api/v1` */
  readonly VITE_BASE_URL?: string;
  /** Optional UI version label for Settings → About (defaults to 1.0.0 in code) */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
