// Outgoing email (backend.md §8.2): nodemailer over SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS, sent
// from MAIL_FROM. The settings are read on first use, after dotenv has run.
//
// - Addresses on a *.test domain (the seeded demo users, architecture.md §8) are never emailed.
// - With no SMTP_HOST, local development still works: the message, OTP included, is written to the
//   log at info level instead. In production that would leak codes into the logs, so there only the
//   fact that mail is unconfigured is logged.
// - Callers decide whether to wait; a failed send rejects, and the caller logs it.
import nodemailer from "nodemailer";
import { log } from "../lib/log.js";

const DEFAULT_FROM = "CampusCommons <no-reply@campuscommons.invalid>";

let transport = null;
let override = null;

// Tests (and scripts) swap in an object with sendMail(message); null goes back to SMTP.
export function useMailTransport(next) {
  override = next;
  transport = null;
}

export const isTestAddress = (address) =>
  /\.test$/i.test(String(address).trim().split("@").pop() ?? "");

function smtpTransport() {
  if (override) return override;
  if (!process.env.SMTP_HOST) return null;
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // 587 upgrades with STARTTLS
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
      // Fail in seconds, not nodemailer's 2 minutes, when a host drops the port (Render's free plan
      // on 25/465/587): the failure is logged while the member is still waiting for the code.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }
  return transport;
}

// → { sent: true } or { sent: false, reason: "test_address" | "logged" | "unconfigured" }.
export async function sendMail({ to, subject, text }) {
  if (isTestAddress(to)) {
    log.info("Not emailing a *.test address");
    return { sent: false, reason: "test_address" };
  }
  const smtp = smtpTransport();
  if (!smtp) {
    if (process.env.NODE_ENV === "production") {
      log.error("SMTP_HOST is not set, so an email was not sent");
      return { sent: false, reason: "unconfigured" };
    }
    log.info(
      `SMTP_HOST is not set, so this email is logged instead of sent.\nTo: ${to}\nSubject: ${subject}\n\n${text}`,
    );
    return { sent: false, reason: "logged" };
  }
  await smtp.sendMail({
    from: process.env.MAIL_FROM || DEFAULT_FROM,
    to,
    subject,
    text,
  });
  return { sent: true };
}
