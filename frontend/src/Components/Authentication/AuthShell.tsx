import type { ReactNode } from "react";
import mainLogo from "../../assets/images/mainlogo.svg";
import "./Signin/signin.css";

type AuthShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
};

export function AuthShell({ title, subtitle, children, wide }: AuthShellProps) {
  const contentClass = wide
    ? "authContent authContent--signin authContent--signin-wide"
    : "authContent authContent--signin";
  const formClass = wide
    ? "loginForm loginForm--signin loginForm--signin-wide"
    : "loginForm loginForm--signin";

  return (
    <div className="authPage authPage--signin">
      <div className={contentClass}>
        <div className="loginData loginData--signin">
          <div className="loginCred loginCred--signin">
            <div className={formClass}>
              <div className="signin-brand">
                <img src={mainLogo} alt="" className="signin-logo" />
              </div>
              <div className="signin-heading-block">
                <h1 className="signin-title">{title}</h1>
                {subtitle ? <p className="signin-subtitle">{subtitle}</p> : null}
              </div>
              {children}
            </div>
          </div>
        </div>
      </div>
      <footer className="signin-page-footer">
        <a
          className="signin-footer-link"
          href="https://aiq.accelerateai.io/login"
          target="_blank"
          rel="noopener noreferrer"
        >
          AI-Q Platform
        </a>
        <nav className="signin-footer-links" aria-label="Footer links">
          <a className="signin-footer-link" href="#support">
            Support
          </a>
          <a className="signin-footer-link" href="#privacy">
            Privacy
          </a>
        </nav>
      </footer>
    </div>
  );
}
