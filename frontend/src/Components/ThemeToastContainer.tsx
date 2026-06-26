import { useEffect, useState } from "react";
import { ToastContainer, type Theme } from "react-toastify";
import { getResolvedThemeMode } from "../themePreference";
import { ToastCloseButton } from "./ToastCloseButton";

/** Toast theme tracks `html.app-theme-dark` (auth + app). */
export function ThemeToastContainer() {
  const [theme, setTheme] = useState<Theme>(() => getResolvedThemeMode());

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(getResolvedThemeMode());
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("storage", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <ToastContainer
      position="top-center"
      autoClose={4000}
      theme={theme}
      closeButton={ToastCloseButton}
    />
  );
}
