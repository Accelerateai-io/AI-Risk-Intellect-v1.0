import { createMailTransport } from "../../functions/emailconfig.js";
import { env } from "../../env.js";
import { HttpError } from "../../utils/httpError.js";

export async function sendPasswordResetEmail(args: {
  to: string;
  resetToken: string;
}): Promise<void> {
  let transport;
  try {
    transport = createMailTransport();
  } catch (err) {
    throw HttpError.serviceUnavailable(
      err instanceof Error ? err.message : "Invalid email configuration",
    );
  }

  if (!transport) {
    throw HttpError.serviceUnavailable(
      "Email delivery is not configured. Set EMAIL_SERVICE_TYPE to gmail or office365 and set SENDER_EMAIL_ID and SENDER_EMAIL_PASSWORD in .env.local",
    );
  }

  const from = env.SENDER_EMAIL_ID!.trim();
  const appBase = env.INVITE_APP_URL.replace(/\/$/, "");
  const resetUrl = `${appBase}/reset-password?token=${encodeURIComponent(args.resetToken)}&email=${encodeURIComponent(args.to)}`;
  const subject = "Reset your AI Risk Intellect password";

  const text = [
    "Hello,",
    "",
    `We received a request to reset the password for your account. Use this link (valid for one hour):`,
    "",
    resetUrl,
    "",
    "If you did not request a password reset, you can ignore this email. Your password will not change.",
  ].join("\n");

  const html = `
    <p>Hello,</p>
    <p>We received a request to reset the password for your <strong>AI Risk Intellect</strong> account.</p>
    <p style="margin:1.25rem 0">
      <a href="${escapeHtml(resetUrl)}"
        style="display:inline-block;padding:12px 22px;background:#1cb0d4;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px">
        Reset password
      </a>
    </p>
    <p style="color:#64748b;font-size:0.9em">This link expires in one hour. If you did not request this, you can ignore this message.</p>
  `;

  try {
    await transport.sendMail({
      from,
      to: args.to,
      subject,
      text,
      html,
    });
  } catch (err) {
    console.error("[password reset email]", err);
    throw HttpError.internal(
      err instanceof Error ? err.message : "Failed to send password reset email",
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
