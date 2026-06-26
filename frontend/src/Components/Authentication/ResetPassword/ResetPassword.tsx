import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Eye, EyeOff, Loader2, Lock, Mail, MoveRightIcon } from "lucide-react";
import "./resetPassword.css";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiUrl } from "../../../utils/apiBase";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import { AuthShell } from "../AuthShell";

const ResetPassword = () => {
  useEffect(() => {
    setDocumentPageTitle("Reset password");
  }, []);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const resetEmail = searchParams.get("email")?.trim() ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [isVisibleConfirm, setIsVisibleConfirm] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success">(
    "idle",
  );

  const passwordVisible = () => setIsVisible((prev) => !prev);
  const confirmPasswordVisible = () => setIsVisibleConfirm((prev) => !prev);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!token) {
      toast.error("This reset link is missing a token.", { autoClose: 4000 });
      return;
    }

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

    setStatus("loading");
    try {
      const res = await fetch(apiUrl("/auth/reset-password"), {
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
          data.error?.message ?? "Could not reset your password. Try again.",
          { autoClose: 5000 },
        );
        setStatus("idle");
        return;
      }
      if (data.user && data.accessToken) {
        sessionStorage.setItem("accessToken", data.accessToken);
        sessionStorage.setItem("userName", data.user.username);
        sessionStorage.setItem("userEmail", data.user.email);
        setStatus("success");
        toast.success("Password updated. You're signed in.", {
          autoClose: 2000,
        });
        window.setTimeout(() => navigate("/dashboard"), 1200);
      } else {
        toast.error("Unexpected response from server.", { autoClose: 4000 });
        setStatus("idle");
      }
    } catch {
      toast.error("Could not reach the server. Try again shortly.", {
        autoClose: 4000,
      });
      setStatus("idle");
    }
  };

  if (!token) {
    return (
      <AuthShell
        title="Reset Password"
        subtitle="This link is invalid or incomplete."
      >
        <div className="signin-form">
          <p className="signinText" style={{ marginBottom: "1.25rem" }}>
            Open the password reset link from your email, or request a new one
            from the forgot password page.
          </p>
          <Link to="/forgotPassword" className="signin-auth-footer">
            <span>Request a new link</span>
          </Link>
          <p className="signinText signin-auth-footer" style={{ marginTop: "1rem" }}>
            <Link to="/signin">
              <span>Sign in</span>
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset Password"
      subtitle="Choose a new password. This link expires in one hour."
    >
      <form className="signin-form" onSubmit={handleSubmit} autoComplete="off">
        <div className="emailData emailData--signin">
          <label
            htmlFor="resetEmail"
            className="signin-field-label signin-field-label--inline"
          >
            <Mail
              className="signin-field-label__icon"
              size={24}
              strokeWidth={2}
              aria-hidden
            />
            <span>Email</span>
          </label>
          <input
            id="resetEmail"
            type="email"
            className="signin-input signin-input--inviteReadonly"
            value={resetEmail}
            readOnly
            tabIndex={-1}
            aria-readonly="true"
            autoComplete="email"
            placeholder={
              resetEmail ? undefined : "Open the latest link from your email"
            }
          />
        </div>
        <div className="passwordData passwordData--signin">
          <label
            htmlFor="newPassword"
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
              id="newPassword"
              type={isVisible ? "text" : "password"}
              className="signin-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              maxLength={128}
              minLength={8}
              placeholder="At least 8 characters"
              disabled={status === "loading" || status === "success"}
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
            htmlFor="confirmPassword"
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
              id="confirmPassword"
              type={isVisibleConfirm ? "text" : "password"}
              className="signin-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              maxLength={128}
              placeholder="Confirm new password"
              disabled={status === "loading" || status === "success"}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="signin-eye"
              onClick={confirmPasswordVisible}
              aria-label={
                isVisibleConfirm ? "Hide password" : "Show password"
              }
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
              status === "loading" ||
              status === "success" ||
              !newPassword ||
              !confirmPassword
                ? "disabled_css"
                : ""
            } ${status === "loading" ? "auth_btn_loading" : ""}`}
            disabled={
              status === "loading" ||
              status === "success" ||
              !newPassword ||
              !confirmPassword
            }
            aria-busy={status === "loading"}
          >
            {status === "loading" ? (
              <>
                Resetting…
                <Loader2 className="auth_spinner" size={20} aria-hidden />
              </>
            ) : status === "success" ? (
              <>Success — redirecting…</>
            ) : (
              <>
                Confirm
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
          Remember your password?{" "}
          <Link to="/signin">
            <span>Sign in</span>
          </Link>
        </p>
      </form>
    </AuthShell>
  );
};

export default ResetPassword;
