import { toast } from "react-toastify";
import { apiUrl } from "./apiBase";

export type AuthFetchInit = RequestInit & {
  /**
   * When true, a 401 response does not clear the session or redirect.
   * Use for public endpoints (e.g. login) or logout where the client handles cleanup.
   */
  skipAuthExpiredRedirect?: boolean;
};

let sessionExpirySignOutPending = false;
let idleSignOutPending = false;
let refreshInFlight: Promise<boolean> | null = null;

const IDLE_LOGOUT_MS = 15 * 60 * 1000;

async function tryRefreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(apiUrl("/auth/refresh"), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return false;
      const data = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
      };
      const nextToken = data.accessToken?.trim();
      if (!nextToken) return false;
      sessionStorage.setItem("accessToken", nextToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function signInHref(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? `${base}signin` : `${base}/signin`;
}

/** Removes auth entries from session storage (same keys used after sign-in). */
export function clearAuthSession(): void {
  sessionStorage.removeItem("accessToken");
  sessionStorage.removeItem("userName");
  sessionStorage.removeItem("userEmail");
}

function redirectToSignIn(): void {
  const path = signInHref();
  if (window.location.pathname === path || window.location.pathname.endsWith("/signin")) {
    return;
  }
  window.location.replace(path);
}

function scheduleSessionExpiredSignOut(): void {
  if (sessionExpirySignOutPending || idleSignOutPending) return;
  sessionExpirySignOutPending = true;

  toast.warning("Session expired", {
    className: "app-toast-session-expired",
    autoClose: 3500,
    closeOnClick: false,
    draggable: false,
    onClose: () => {
      clearAuthSession();
      redirectToSignIn();
      sessionExpirySignOutPending = false;
    },
  });
}

/** Signs the user out after a period of inactivity (see useIdleLogout). */
export function scheduleIdleSignOut(): void {
  if (idleSignOutPending || sessionExpirySignOutPending) return;
  if (!sessionStorage.getItem("accessToken")) return;
  idleSignOutPending = true;

  void authFetch("/auth/logout", {
    method: "POST",
    skipAuthExpiredRedirect: true,
  });

  toast.warning("You were signed out due to inactivity.", {
    className: "app-toast-session-expired",
    autoClose: 3500,
    closeOnClick: false,
    draggable: false,
    onClose: () => {
      clearAuthSession();
      redirectToSignIn();
      idleSignOutPending = false;
    },
  });
}

export const IDLE_LOGOUT_TIMEOUT_MS = IDLE_LOGOUT_MS;

export type UploadProgressHandler = (percent: number) => void;

export type AuthUploadInit = {
  onProgress?: UploadProgressHandler;
  skipAuthExpiredRedirect?: boolean;
};

function xhrUpload(
  url: string,
  formData: FormData,
  onProgress?: UploadProgressHandler,
): Promise<{ status: number; responseText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    const token = sessionStorage.getItem("accessToken");
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(
            Math.min(100, Math.round((event.loaded / event.total) * 100)),
          );
        }
      });
    }

    xhr.addEventListener("load", () => {
      resolve({ status: xhr.status, responseText: xhr.responseText });
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

    xhr.send(formData);
  });
}

/**
 * Multipart upload with upload progress (XHR). Same auth refresh behavior as authFetch.
 */
export async function authFetchUpload(
  apiPath: string,
  formData: FormData,
  init: AuthUploadInit = {},
): Promise<Response> {
  const { onProgress, skipAuthExpiredRedirect } = init;

  const execute = async (allowRefreshRetry: boolean): Promise<Response> => {
    const url = apiPath.startsWith("http") ? apiPath : apiUrl(apiPath);
    const { status, responseText } = await xhrUpload(url, formData, onProgress);

    if (status !== 401 || skipAuthExpiredRedirect) {
      return new Response(responseText, { status });
    }

    if (allowRefreshRetry && (await tryRefreshAccessToken())) {
      return execute(false);
    }

    scheduleSessionExpiredSignOut();
    return new Response(responseText, { status });
  };

  return execute(true);
}

/**
 * Fetch against the API, attaching Bearer access token when present.
 * On 401 (expired access token), silently refreshes the session once and retries.
 * If refresh fails, shows a “Session expired” notice, then clears auth and redirects to sign-in unless skipped.
 */
export async function authFetch(
  apiPath: string,
  init: AuthFetchInit = {},
): Promise<Response> {
  const { skipAuthExpiredRedirect, ...rest } = init;

  const execute = async (allowRefreshRetry: boolean): Promise<Response> => {
    const url = apiPath.startsWith("http") ? apiPath : apiUrl(apiPath);
    const headers = new Headers(rest.headers ?? undefined);
    const token = sessionStorage.getItem("accessToken");
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const credentials = rest.credentials ?? "include";
    const res = await fetch(url, { ...rest, headers, credentials });

    if (res.status !== 401 || skipAuthExpiredRedirect) {
      return res;
    }

    if (allowRefreshRetry && (await tryRefreshAccessToken())) {
      return execute(false);
    }

    scheduleSessionExpiredSignOut();
    return res;
  };

  return execute(true);
}
