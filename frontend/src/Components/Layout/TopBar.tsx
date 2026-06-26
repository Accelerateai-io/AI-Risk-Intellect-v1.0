import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { LogOut, User, Palette, Sun, Moon, Monitor } from "lucide-react";
import { NotificationBell } from "../../notifications/NotificationBell";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  getStoredTheme,
  setTheme,
  type ThemeChoice,
} from "../../themePreference";
import { authFetch } from "../../utils/authFetch";
import { SESSION_PROFILE_CHANGED } from "../../utils/sessionProfileEvents";

function readUserProfile() {
  const name = sessionStorage.getItem("userName")?.trim() || "Guest";
  const email = sessionStorage.getItem("userEmail")?.trim() || "";
  return { name, email };
}

function userInitial(name: string) {
  const t = name.trim();
  if (!t) return "?";
  return t.charAt(0).toUpperCase();
}

const THEME_OPTIONS: {
  value: ThemeChoice;
  label: string;
  Icon: LucideIcon;
}[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

export function TopBar() {
  const [open, setOpen] = useState(false);
  const [themeExpanded, setThemeExpanded] = useState(false);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() =>
    getStoredTheme(),
  );
  const [profileTick, setProfileTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onSession = () => setProfileTick((t) => t + 1);
    window.addEventListener(SESSION_PROFILE_CHANGED, onSession);
    return () => window.removeEventListener(SESSION_PROFILE_CHANGED, onSession);
  }, []);

  const profile = useMemo(
    () => readUserProfile(),
    [profileTick, location.pathname, open],
  );
  const initial = userInitial(profile.name);

  useEffect(() => {
    if (!open) {
      setThemeExpanded(false);
      return;
    }
    setThemeChoice(getStoredTheme());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      if (open && !rootRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  const openUserMenu = () => {
    setOpen((value) => !value);
  };

  const logout = async () => {
    close();
    try {
      await authFetch("/auth/logout", {
        method: "POST",
        skipAuthExpiredRedirect: true,
      });
    } catch {
      /* still clear client session */
    }
    sessionStorage.clear();
    navigate("/signin", { replace: true });
  };

  return (
    <header className="mainLayout__topBar">
      <div className="mainLayout__topBarInner">
        <div className="mainLayout__topBarSpacer" aria-hidden />
        <div className="mainLayout__topBarEnd">
          <NotificationBell />

          <div className="mainLayout__userMenu" ref={rootRef}>
            <div className="mainLayout__userTrigger">
              <button
                type="button"
                className="mainLayout__userAvatar"
                onClick={openUserMenu}
                aria-expanded={open}
                aria-haspopup="menu"
                aria-label="User menu"
              >
                {initial}
              </button>
              <div className="mainLayout__userText">
                <span className="mainLayout__userName">{profile.name}</span>
                {profile.email ? (
                  <span className="mainLayout__userEmail">{profile.email}</span>
                ) : null}
              </div>
            </div>
            {open ? (
              <div className="mainLayout__dropdown" role="menu">
                <Link
                  role="menuitem"
                  className="mainLayout__dropdownItem"
                  to="/account"
                  onClick={close}
                >
                  <User size={16} strokeWidth={1.75} aria-hidden />
                  My Account
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  className="mainLayout__dropdownItem mainLayout__dropdownItem--expandable"
                  aria-expanded={themeExpanded}
                  onClick={() => setThemeExpanded((v) => !v)}
                >
                  <Palette size={16} strokeWidth={1.75} aria-hidden />
                  Choose Theme
                </button>
                {themeExpanded ? (
                  <div
                    className="mainLayout__dropdownThemeOpts"
                    role="radiogroup"
                    aria-label="Theme"
                  >
                    {THEME_OPTIONS.map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={themeChoice === value}
                        className={`mainLayout__dropdownThemeOpt${themeChoice === value ? " mainLayout__dropdownThemeOpt--active" : ""}`}
                        onClick={() => {
                          setTheme(value);
                          setThemeChoice(value);
                          setThemeExpanded(false);
                          close();
                        }}
                      >
                        <Icon size={14} strokeWidth={1.75} aria-hidden />
                        <span>{label}</span>
                        {themeChoice === value ? (
                          <span className="mainLayout__dropdownThemeCheck" aria-hidden>
                            ✓
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="mainLayout__dropdownItem mainLayout__dropdownItem--logout"
                  onClick={logout}
                >
                  <LogOut size={16} strokeWidth={1.75} aria-hidden />
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
