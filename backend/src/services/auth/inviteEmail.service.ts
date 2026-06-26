import { createMailTransport } from "../../functions/emailconfig.js";
import { env } from "../../env.js";
import { HttpError } from "../../utils/httpError.js";

export async function sendUserInviteEmail(args: {
  to: string;
  invitedByEmail: string;
  invitedByUsername: string;
  inviteToken: string;
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
  const setPasswordUrl = `${appBase}/invite/set-password?token=${encodeURIComponent(args.inviteToken)}`;
  const subject = "You're invited to AI Risk Intellect";

  const text = [
    "Hello,",
    "",
    `You have been invited to join AI Risk Intellect by ${args.invitedByUsername} (${args.invitedByEmail}).`,
    "",
    `Set your password to get started: ${setPasswordUrl}`,
    "",
    "If you did not expect this message, you can ignore it.",
  ].join("\n");

  const html = `
    <p>Hello,</p>
    <p>You have been invited to join <strong>AI Risk Intellect</strong> by
      <strong>${escapeHtml(args.invitedByUsername)}</strong>.</p>
    <p style="margin:1.25rem 0">
      <a href="${escapeHtml(setPasswordUrl)}"
        style="display:inline-block;padding:12px 22px;background:#1cb0d4;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px">
        Set password
      </a>
    </p>
    <p style="color:#64748b;font-size:0.9em">If you did not expect this message, you can ignore it.</p>
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
    console.error("[invite email]", err);
    throw HttpError.internal(
      err instanceof Error ? err.message : "Failed to send invitation email",
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
