import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Loader2, Mail, MoveRightIcon } from "lucide-react";
import "./forgotPassword.css";
import { Link } from "react-router-dom";
import { apiUrl } from "../../../utils/apiBase";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import { AuthShell } from "../AuthShell";

function firstIssueMessage(
  details: unknown,
): string | undefined {
  if (!Array.isArray(details) || details.length === 0) return undefined;
  const first = details[0] as { message?: string } | undefined;
  return typeof first?.message === "string" ? first.message : undefined;
}

const ForgotPassword = () => {
  useEffect(() => {
    setDocumentPageTitle("Forgot password");
  }, []);

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Please enter your email address.", { autoClose: 4000 });
      return;
    }

    const trimmed = email.trim();
    setStatus("loading");
    try {
      const res = await fetch(apiUrl("/auth/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: { message?: string; details?: unknown };
      };
      if (!res.ok) {
        const msg =
          firstIssueMessage(data.error?.details) ??
          data.error?.message ??
          "Could not send reset email. Try again shortly.";
        toast.error(msg, { autoClose: 5000 });
        setStatus("idle");
        return;
      }
      toast.success(
        data.message ??
          "Password reset instructions were sent to your email.",
        { autoClose: 6000 },
      );
      setStatus("success");
    } catch {
      toast.error("Could not reach the server. Try again shortly.", {
        autoClose: 4000,
      });
      setStatus("idle");
    }
  };

  return (
    <AuthShell
      title="Forgot Password"
      subtitle="Enter your registered email to receive a password reset link."
    >
      <form className="signin-form" onSubmit={handleSubmit} autoComplete="off">
        <div className="emailData emailData--signin">
          <label
            htmlFor="forgotEmail"
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
            id="forgotEmail"
            type="email"
            className="signin-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            disabled={status === "loading" || status === "success"}
          />
        </div>
        <div className="loginBtn loginBtn--signin">
          <button
            type="submit"
            className={`login-btn signin-submit ${!email.trim() || status === "loading" || status === "success" ? "disabled_css" : ""} ${status === "loading" ? "auth_btn_loading" : ""}`}
            disabled={
              !email.trim() || status === "loading" || status === "success"
            }
            aria-busy={status === "loading"}
          >
            {status === "loading" ? (
              <>
                Sending…
                <Loader2 className="auth_spinner" size={20} aria-hidden />
              </>
            ) : status === "success" ? (
              <>Sent</>
            ) : (
              <>
                Submit
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
          Remember your credentials?{" "}
          <Link to="/signin">
            <span>Sign in</span>
          </Link>
        </p>
      </form>
    </AuthShell>
  );
};

export default ForgotPassword;
