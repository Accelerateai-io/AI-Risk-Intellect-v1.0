import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "react-toastify";
import {
  Loader2,
  Save,
  KeyRound,
  UserCircle,
  Mail,
  UserRound,
  AtSign,
  Lock,
  CheckCircle2,
  MessageSquareText,
} from "lucide-react";
import { PageHeader } from "../../Layout/PageHeader";
import { authFetch } from "../../../utils/authFetch";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import { notifySessionProfileChanged } from "../../../utils/sessionProfileEvents";
import "../Users/usersPage.css";
import "./accountPage.css";

type MeUser = {
  id: string;
  email: string;
  username: string;
  fullName: string | null;
  accountStatus: string;
  isActive: boolean;
};

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

function applyAuthResponse(data: {
  user: MeUser;
  accessToken: string;
}): void {
  sessionStorage.setItem("accessToken", data.accessToken);
  sessionStorage.setItem("userName", data.user.username);
  sessionStorage.setItem("userEmail", data.user.email);
  notifySessionProfileChanged();
}

export function AccountPage() {
  const detailsTitleId = useId();
  const passwordTitleId = useId();
  const [tab, setTab] = useState<"details" | "password">("details");

  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(
    "loading",
  );
  const [me, setMe] = useState<MeUser | null>(null);

  const [usernameDraft, setUsernameDraft] = useState("");
  const [fullNameDraft, setFullNameDraft] = useState("");
  const [profileUpdateReason, setProfileUpdateReason] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setDocumentPageTitle("My account");
  }, []);

  const fetchMe = useCallback(() => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      setLoadState("error");
      setMe(null);
      return;
    }
    setLoadState("loading");
    void authFetch("/auth/me")
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          user?: MeUser;
          error?: { message?: string };
        };
        if (res.status === 401) {
          setLoadState("error");
          return;
        }
        if (!res.ok || !data.user) {
          setLoadState("error");
          toast.error(
            data.error?.message ?? "Could not load your account.",
            { autoClose: 4000 },
          );
          return;
        }
        setMe(data.user);
        setUsernameDraft(data.user.username);
        setFullNameDraft(data.user.fullName?.trim() ?? "");
        setProfileUpdateReason("");
        setLoadState("idle");
      })
      .catch(() => {
        setLoadState("error");
        toast.error("Could not load your account.", { autoClose: 4000 });
      });
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const usernameTrim = usernameDraft.trim();
  const fullNameTrim = fullNameDraft.trim();
  const usernameValid =
    usernameTrim.length >= 3 &&
    usernameTrim.length <= 64 &&
    USERNAME_RE.test(usernameTrim);
  const fullNameValid = fullNameTrim.length <= 255;
  const usernameDirty = Boolean(me && usernameTrim !== me.username);
  const fullNameDirty = Boolean(
    me && fullNameTrim !== (me.fullName?.trim() ?? ""),
  );
  const profileDirty = usernameDirty || fullNameDirty;
  const reasonTrim = profileUpdateReason.trim();
  const reasonValid = reasonTrim.length > 0 && reasonTrim.length <= 2000;
  const canSaveProfile =
    profileDirty &&
    usernameValid &&
    fullNameValid &&
    reasonValid &&
    !savingProfile &&
    loadState === "idle";

  const submitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSaveProfile) return;
    setSavingProfile(true);
    try {
      const res = await authFetch("/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameTrim,
          fullName: fullNameTrim,
          reason: reasonTrim,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        user?: MeUser;
        accessToken?: string;
        error?: { message?: string };
      };
      if (!res.ok || !data.user || !data.accessToken) {
        toast.error(
          data.error?.message ?? "Could not update your profile.",
          { autoClose: 4000 },
        );
        return;
      }
      setMe(data.user);
      setUsernameDraft(data.user.username);
      setFullNameDraft(data.user.fullName?.trim() ?? "");
      setProfileUpdateReason("");
      applyAuthResponse({
        user: data.user,
        accessToken: data.accessToken,
      });
      toast.success("Profile updated.", { autoClose: 2500 });
    } catch {
      toast.error("Could not update your profile.", { autoClose: 4000 });
    } finally {
      setSavingProfile(false);
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.", {
        autoClose: 4000,
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match.", { autoClose: 4000 });
      return;
    }
    setSavingPassword(true);
    try {
      const res = await authFetch("/auth/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        user?: MeUser;
        accessToken?: string;
        error?: { message?: string };
      };
      if (!res.ok || !data.user || !data.accessToken) {
        toast.error(
          data.error?.message ?? "Could not change password.",
          { autoClose: 4000 },
        );
        return;
      }
      applyAuthResponse({
        user: data.user,
        accessToken: data.accessToken,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated.", { autoClose: 2500 });
    } catch {
      toast.error("Could not change password.", { autoClose: 4000 });
    } finally {
      setSavingPassword(false);
    }
  };

  const noToken = !sessionStorage.getItem("accessToken");

  return (
    <main className="mainLayout__content accountPage">
      <PageHeader
        title="My account"
        subtitle="View your profile and manage sign-in security."
        pageIcon={UserCircle}
      />

      <div
        className="accountPage__tabs"
        role="tablist"
        aria-label="Account sections"
      >
        <button
          type="button"
          role="tab"
          id={`${detailsTitleId}-tab`}
          aria-selected={tab === "details"}
          aria-controls={`${detailsTitleId}-panel`}
          tabIndex={tab === "details" ? 0 : -1}
          className={`accountPage__tab${tab === "details" ? " accountPage__tab--active" : ""}`}
          onClick={() => setTab("details")}
        >
          Details
        </button>
        <button
          type="button"
          role="tab"
          id={`${passwordTitleId}-tab`}
          aria-selected={tab === "password"}
          aria-controls={`${passwordTitleId}-panel`}
          tabIndex={tab === "password" ? 0 : -1}
          className={`accountPage__tab${tab === "password" ? " accountPage__tab--active" : ""}`}
          onClick={() => setTab("password")}
        >
          Change password
        </button>
      </div>

      {tab === "details" ? (
        <section
          id={`${detailsTitleId}-panel`}
          role="tabpanel"
          aria-labelledby={`${detailsTitleId}-tab`}
          className="accountPage__panel"
        >
          {loadState === "loading" ? (
            <div className="accountPage__state" role="status">
              <Loader2
                className="usersPage__spinner usersPage__spinner--lg"
                size={28}
                aria-hidden
              />
              <span> Loading…</span>
            </div>
          ) : loadState === "error" || !me || noToken ? (
            <div className="accountPage__state">
              {noToken
                ? "Sign in to manage your account."
                : "Could not load your account details."}
            </div>
          ) : (
            <form onSubmit={submitProfile}>
              <div className="accountPage__field">
                <label
                  className="accountPage__label accountPage__label--withIcon"
                  htmlFor="account-email"
                >
                  <Mail
                    className="usersPage__labelIcon"
                    size={15}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span>Email</span>
                </label>
                <input
                  id="account-email"
                  className="accountPage__input"
                  readOnly
                  value={me.email}
                  tabIndex={-1}
                  aria-readonly="true"
                />
              </div>
              <div className="accountPage__field">
                <label
                  className="accountPage__label accountPage__label--withIcon"
                  htmlFor="account-fullname"
                >
                  <UserRound
                    className="usersPage__labelIcon"
                    size={15}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span>Full name</span>
                </label>
                <input
                  id="account-fullname"
                  className="accountPage__input"
                  autoComplete="name"
                  value={fullNameDraft}
                  onChange={(e) => setFullNameDraft(e.target.value)}
                  maxLength={255}
                  placeholder="Your display name"
                  aria-invalid={fullNameDraft.length > 0 && !fullNameValid}
                />
              </div>
              <div className="accountPage__field">
                <label
                  className="accountPage__label accountPage__label--withIcon"
                  htmlFor="account-username"
                >
                  <AtSign
                    className="usersPage__labelIcon"
                    size={15}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span>Username</span>
                </label>
                <input
                  id="account-username"
                  className="accountPage__input"
                  autoComplete="username"
                  value={usernameDraft}
                  onChange={(e) => setUsernameDraft(e.target.value)}
                  maxLength={64}
                  aria-invalid={usernameDraft.length > 0 && !usernameValid}
                />
              </div>
              {profileDirty ? (
                <div className="accountPage__field">
                  <label
                    className="accountPage__label accountPage__label--withIcon"
                    htmlFor="account-update-reason"
                  >
                    <MessageSquareText
                      className="usersPage__labelIcon"
                      size={15}
                      strokeWidth={2}
                      aria-hidden
                    />
                    <span>Reason for this change</span>
                  </label>
                  <textarea
                    id="account-update-reason"
                    className="accountPage__textarea"
                    value={profileUpdateReason}
                    onChange={(e) => setProfileUpdateReason(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="Briefly describe why you are updating your profile"
                    aria-invalid={
                      profileUpdateReason.length > 0 && !reasonValid
                    }
                  />
                </div>
              ) : null}
              <div className="accountPage__actions">
                <button
                  type="submit"
                  className="accountPage__btn"
                  disabled={!canSaveProfile}
                >
                  {savingProfile ? (
                    <>
                      <Loader2 className="usersPage__spinner" size={18} aria-hidden />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Save size={16} strokeWidth={2} aria-hidden />
                      Save username
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </section>
      ) : (
        <section
          id={`${passwordTitleId}-panel`}
          role="tabpanel"
          aria-labelledby={`${passwordTitleId}-tab`}
          className="accountPage__panel"
        >
          {noToken ? (
            <div className="accountPage__state">Sign in to change your password.</div>
          ) : (
            <form onSubmit={submitPassword}>
              <div className="accountPage__field">
                <label
                  className="accountPage__label accountPage__label--withIcon"
                  htmlFor="account-current-pw"
                >
                  <Lock
                    className="usersPage__labelIcon"
                    size={15}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span>Current password</span>
                </label>
                <input
                  id="account-current-pw"
                  type="password"
                  className="accountPage__input"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={savingPassword}
                />
              </div>
              <div className="accountPage__field">
                <label
                  className="accountPage__label accountPage__label--withIcon"
                  htmlFor="account-new-pw"
                >
                  <KeyRound
                    className="usersPage__labelIcon"
                    size={15}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span>New password</span>
                </label>
                <input
                  id="account-new-pw"
                  type="password"
                  className="accountPage__input"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={savingPassword}
                  minLength={8}
                  maxLength={128}
                />
              </div>
              <div className="accountPage__field">
                <label
                  className="accountPage__label accountPage__label--withIcon"
                  htmlFor="account-confirm-pw"
                >
                  <CheckCircle2
                    className="usersPage__labelIcon"
                    size={15}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span>Confirm new password</span>
                </label>
                <input
                  id="account-confirm-pw"
                  type="password"
                  className="accountPage__input"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={savingPassword}
                  maxLength={128}
                />
              </div>
              <div className="accountPage__actions">
                <button
                  type="submit"
                  className="accountPage__btn"
                  disabled={
                    savingPassword ||
                    !currentPassword ||
                    !newPassword ||
                    !confirmPassword
                  }
                >
                  {savingPassword ? (
                    <>
                      <Loader2 className="usersPage__spinner" size={18} aria-hidden />
                      Updating…
                    </>
                  ) : (
                    <>
                      <KeyRound size={16} strokeWidth={2} aria-hidden />
                      Update password
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
