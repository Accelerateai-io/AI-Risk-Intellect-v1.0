import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Eye, EyeOff, CheckCircle, Loader2, User, Lock, MoveRightIcon } from "lucide-react";
import { Link, useNavigate, useLocation, type Location } from "react-router-dom";
import { apiUrl } from "../../../utils/apiBase";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import { AuthShell } from "../AuthShell";

const Signin = () => {
  useEffect(() => {
    setDocumentPageTitle("Sign in");
  }, []);

  const navigate = useNavigate();
  const location = useLocation();
  const resetSuccess = (location.state as { resetSuccess?: boolean } | null)
    ?.resetSuccess;
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!emailOrUsername.trim() || !password.trim()) {
      toast.error("Enter your email or username and password.", {
        autoClose: 5005,
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(apiUrl("/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          emailOrUsername: emailOrUsername.trim(),
          password,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        user?: { username: string; email: string };
        accessToken?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        toast.error(
          data.error?.message ?? "Sign in failed. Check your credentials.",
          { autoClose: 5005 },
        );
        return;
      }
      if (data.user && data.accessToken) {
        sessionStorage.setItem("accessToken", data.accessToken);
        sessionStorage.setItem("userName", data.user.username);
        sessionStorage.setItem("userEmail", data.user.email);
        toast.success("Signed in.", { autoClose: 1500 });
        const from = (location.state as { from?: Location } | null)?.from;
        const target =
          from && from.pathname && from.pathname !== "/signin"
            ? `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`
            : "/dashboard";
        navigate(target, { replace: true });
      } else {
        toast.error("Unexpected response from server.", { autoClose: 5005 });
      }
    } catch {
      toast.error("Could not reach the server. Try again shortly.", {
        autoClose: 4000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const passwordVisible = () => {
    setIsVisible((prev) => !prev);
  };

  const isDisabledBtn =
    !emailOrUsername.trim() || !password.trim() || isSubmitting;

  return (
    <AuthShell title="Sign in">
      <form className="signin-form" action="" autoComplete="off" onSubmit={handleSubmit}>
        <div className="emailData emailData--signin">
          <label
            htmlFor="loginEmail"
            className="signin-field-label signin-field-label--inline"
          >
            <User
              className="signin-field-label__icon"
              size={24}
              strokeWidth={2}
              aria-hidden
            />
            <span>Email / username</span>
          </label>
          <input
            type="text"
            id="loginEmail"
            className="signin-input"
            autoComplete="username"
            value={emailOrUsername}
            onChange={(e) => setEmailOrUsername(e.target.value)}
            placeholder="Email or Username"
          />
        </div>
        <div className="passwordData passwordData--signin">
          <div className="signin-label-row">
            <label
              htmlFor="loginPassword"
              className="signin-field-label signin-field-label--inline"
            >
              <Lock
                className="signin-field-label__icon"
                size={24}
                strokeWidth={2}
                aria-hidden
              />
              <span>Password</span>
            </label>
            <Link to="/forgotPassword" className="signin-forgot-link">
              Forgot password?
            </Link>
          </div>
          <div className="signin-input-wrap">
            <input
              type={isVisible ? "text" : "password"}
              id="loginPassword"
              className="signin-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
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
        {resetSuccess && (
          <div className="authMessage authMessage--success signin-flash">
            <CheckCircle
              className="authMessage__icon"
              size={16}
              aria-hidden
            />
            <p className="loginSuccess">
              Password reset successfully. You can sign in with your new
              password.
            </p>
          </div>
        )}
        <div className="loginBtn loginBtn--signin">
          <button
            type="submit"
            className={`login-btn signin-submit ${isDisabledBtn ? "disabled_css" : ""} ${isSubmitting ? "auth_btn_loading" : ""}`}
            disabled={isDisabledBtn}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                Signing in…
                <Loader2 className="auth_spinner" size={20} aria-hidden />
              </>
            ) : (
              <>
                Sign in
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
      </form>
    </AuthShell>
  );
};

export default Signin;
