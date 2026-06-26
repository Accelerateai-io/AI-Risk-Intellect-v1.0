import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Eye, EyeOff, Loader2, Mail, Lock, MoveRightIcon } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import "../ResetPassword/resetPassword.css";
import { apiUrl } from "../../../utils/apiBase";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import { AuthShell } from "../AuthShell";

type PreviewState = "loading" | "ready" | "error";

const InviteSetPassword = () => {
  useEffect(() => {
    setDocumentPageTitle("Set password");
  }, []);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [preview, setPreview] = useState<PreviewState>(() =>
    token ? "loading" : "error",
  );
  const [previewError, setPreviewError] = useState(() =>
    token
      ? ""
      : "This link is missing a token. Ask your administrator to send a new invitation.",
  );
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [isVisibleConfirm, setIsVisibleConfirm] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<
    "idle" | "loading" | "success"
  >("idle");

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    setPreview("loading");
    setPreviewError("");

    void (async () => {
      try {
        const res = await fetch(
          apiUrl(
            `/auth/invite/set-password?token=${encodeURIComponent(token)}`,
          ),
        );
        const data = (await res.json().catch(() => ({}))) as {
          email?: string;
          error?: { message?: string };
        };
        if (cancelled) return;
        if (!res.ok) {
          setPreview("error");
          setPreviewError(
            data.error?.message ??
              "This invitation link is invalid or has expired.",
          );
          return;
        }
        if (typeof data.email !== "string" || !data.email) {
          setPreview("error");
          setPreviewError("Could not load invitation details.");
          return;
        }
        setEmail(data.email);
        setPreview("ready");
      } catch {
        if (!cancelled) {
          setPreview("error");
          setPreviewError("Could not reach the server. Try again shortly.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const passwordVisible = () => setIsVisible((prev) => !prev);
  const confirmPasswordVisible = () => setIsVisibleConfirm((prev) => !prev);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.", {
        autoClose: 4000,
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.", { autoClose: 4000 });
      return;
    }

    setSubmitStatus("loading");
    try {
      const res = await fetch(apiUrl("/auth/invite/set-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password: newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        user?: { username: string; email: string };
        accessToken?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        toast.error(
          data.error?.message ?? "Could not set your password. Try again.",
          { autoClose: 5000 },
        );
        setSubmitStatus("idle");
        return;
      }
      if (data.user && data.accessToken) {
        sessionStorage.setItem("accessToken", data.accessToken);
        sessionStorage.setItem("userName", data.user.username);
        sessionStorage.setItem("userEmail", data.user.email);
        setSubmitStatus("success");
        toast.success("Password set. You're signed in.", { autoClose: 2000 });
        window.setTimeout(() => navigate("/dashboard"), 1200);
      } else {
        toast.error("Unexpected response from server.", { autoClose: 4000 });
        setSubmitStatus("idle");
      }
    } catch {
      toast.error("Could not reach the server. Try again shortly.", {
        autoClose: 4000,
      });
      setSubmitStatus("idle");
    }
  };

  if (preview === "loading") {
    return (
      <AuthShell
        title="Set password"
        subtitle="Loading your invitation…"
      >
        <div className="signin-form" role="status">
          <Loader2
            className="auth_spinner"
            size={32}
            aria-hidden
            style={{ margin: "2rem auto", display: "block" }}
          />
        </div>
      </AuthShell>
    );
  }

  if (preview === "error") {
    return (
      <AuthShell
        title="Set password"
        subtitle="We could not open this invitation."
      >
        <div className="signin-form">
          <p className="resetError" style={{ marginBottom: "1.25rem" }}>
            {previewError}
          </p>
          <p className="signinText signin-auth-footer">
            <Link to="/signin">
              <span>Back to sign in</span>
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set password"
      subtitle="Choose a password for this account."
    >
      <form className="signin-form" onSubmit={handleSubmit} autoComplete="off">
        <div className="emailData emailData--signin">
          <label
            htmlFor="inviteEmail"
            className="signin-field-label signin-field-label--inline"
          >
            <Mail
              className="signin-field-label__icon"
              size={24}
              strokeWidth={2}
              aria-hidden
            />
            <span>Account email</span>
          </label>
          <input
            id="inviteEmail"
            type="email"
            className="signin-input signin-input--inviteReadonly"
            value={email}
            readOnly
            tabIndex={-1}
            aria-readonly="true"
            autoComplete="email"
          />
        </div>
        <div className="passwordData passwordData--signin">
          <label
            htmlFor="inviteNewPassword"
            className="signin-field-label signin-field-label--inline"
          >
            <Lock
              className="signin-field-label__icon"
              size={24}
              strokeWidth={2}
              aria-hidden
            />
            <span>New password</span>
          </label>
          <div className="signin-input-wrap">
            <input
              id="inviteNewPassword"
              type={isVisible ? "text" : "password"}
              className="signin-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              maxLength={128}
              minLength={8}
              placeholder="At least 8 characters"
              disabled={
                submitStatus === "loading" || submitStatus === "success"
              }
              autoComplete="new-password"
            />
            <button
              type="button"
              className="signin-eye"
              onClick={passwordVisible}
              aria-label={isVisible ? "Hide password" : "Show password"}
            >
              {isVisible ? (
                <Eye size={18} strokeWidth={1.75} />
              ) : (
                <EyeOff size={18} strokeWidth={1.75} />
              )}
            </button>
          </div>
        </div>
        <div className="passwordData passwordData--signin">
          <label
            htmlFor="inviteConfirmPassword"
            className="signin-field-label signin-field-label--inline"
          >
            <Lock
              className="signin-field-label__icon"
              size={24}
              strokeWidth={2}
              aria-hidden
            />
            <span>Confirm password</span>
          </label>
          <div className="signin-input-wrap">
            <input
              id="inviteConfirmPassword"
              type={isVisibleConfirm ? "text" : "password"}
              className="signin-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              maxLength={128}
              placeholder="Confirm new password"
              disabled={
                submitStatus === "loading" || submitStatus === "success"
              }
              autoComplete="new-password"
            />
            <button
              type="button"
              className="signin-eye"
              onClick={confirmPasswordVisible}
              aria-label={isVisibleConfirm ? "Hide password" : "Show password"}
            >
              {isVisibleConfirm ? (
                <Eye size={18} strokeWidth={1.75} />
              ) : (
                <EyeOff size={18} strokeWidth={1.75} />
              )}
            </button>
          </div>
        </div>
        <div className="loginBtn loginBtn--signin">
          <button
            type="submit"
            className={`login-btn signin-submit ${
              submitStatus === "loading" ||
              submitStatus === "success" ||
              !newPassword ||
              !confirmPassword
                ? "disabled_css"
                : ""
            } ${submitStatus === "loading" ? "auth_btn_loading" : ""}`}
            disabled={
              submitStatus === "loading" ||
              submitStatus === "success" ||
              !newPassword ||
              !confirmPassword
            }
            aria-busy={submitStatus === "loading"}
          >
            {submitStatus === "loading" ? (
              <>
                Setting password…
                <Loader2 className="auth_spinner" size={20} aria-hidden />
              </>
            ) : submitStatus === "success" ? (
              <>Success — redirecting…</>
            ) : (
              <>
                Set password
                <MoveRightIcon
                  className="signin-submit__icon"
                  size={20}
                  strokeWidth={2}
                  aria-hidden
                />
              </>
            )}
          </button>
        </div>
        <p className="signinText signin-auth-footer">
          Already set up?{" "}
          <Link to="/signin">
            <span>Sign in</span>
          </Link>
        </p>
      </form>
    </AuthShell>
  );
};

export default InviteSetPassword;
