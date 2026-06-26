export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "app-theme";

function resolveTheme(mode: ThemeChoice): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

export function getStoredTheme(): ThemeChoice {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

export function applyTheme(mode: ThemeChoice): void {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = mode;
  document.documentElement.classList.toggle("app-theme-dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export function setTheme(mode: ThemeChoice): void {
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme(mode);
}

let systemThemeListenerAttached = false;

export function getResolvedThemeMode(): "light" | "dark" {
  return document.documentElement.classList.contains("app-theme-dark")
    ? "dark"
    : "light";
}

export function initThemeFromStorage(): void {
  applyTheme(getStoredTheme());
  if (systemThemeListenerAttached) return;
  systemThemeListenerAttached = true;
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (getStoredTheme() === "system") applyTheme("system");
    });
}
