import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../env.js";

/**
 * Builds a nodemailer transport from `env` (Gmail or Office 365).
 * Returns `null` when `EMAIL_SERVICE_TYPE` is `none` (invite emails disabled until configured).
 */
export function createMailTransport(): Transporter | null {
  const type = env.EMAIL_SERVICE_TYPE;
  if (type === "none") {
    return null;
  }

  const user = env.SENDER_EMAIL_ID?.trim();
  const pass = env.SENDER_EMAIL_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "SENDER_EMAIL_ID and SENDER_EMAIL_PASSWORD are required when EMAIL_SERVICE_TYPE is gmail or office365",
    );
  }

  if (type === "gmail") {
    return nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user, pass },
    });
  }

  if (type === "office365") {
    return nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: { user, pass },
    });
  }

  throw new Error(`Unsupported EMAIL_SERVICE_TYPE: ${String(type)}`);
}

export default createMailTransport;
