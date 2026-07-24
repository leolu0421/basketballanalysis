import { Resend } from "resend";

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

let client: Resend | null = null;
function getClient() {
  if (!isEmailConfigured()) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("RESEND_API_KEY is not configured");
    this.name = "EmailNotConfiguredError";
  }
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const resend = getClient();
  if (!resend) throw new EmailNotConfiguredError();

  const from = process.env.RESEND_FROM_EMAIL || "hooplens <onboarding@resend.dev>";

  const { error } = await resend.emails.send({
    from,
    to,
    subject: "Reset your hooplens password",
    html: `
      <p>Someone requested a password reset for this email on hooplens.</p>
      <p><a href="${resetUrl}">Click here to set a new password</a>. This link expires in 1 hour.</p>
      <p>If you didn't request this, you can ignore this email.</p>
    `,
  });

  if (error) {
    throw new Error(`Failed to send reset email: ${error.message}`);
  }
}
