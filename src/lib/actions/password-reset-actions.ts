"use server";

import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { sendPasswordResetEmail, isEmailConfigured, EmailNotConfiguredError } from "@/lib/email";

export type PasswordResetActionState = { error?: string; success?: boolean } | undefined;

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function getBaseUrl() {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

const requestSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

export async function requestPasswordResetAction(
  _prevState: PasswordResetActionState,
  formData: FormData
): Promise<PasswordResetActionState> {
  const parsed = requestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  if (!isEmailConfigured()) {
    return { error: "Password reset emails aren't configured yet — set RESEND_API_KEY." };
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

    // Always behave the same whether or not the account exists, so this form
    // can't be used to discover which emails have accounts.
    if (user) {
      const token = randomBytes(32).toString("hex");
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      const baseUrl = await getBaseUrl();
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      await sendPasswordResetEmail(user.email, resetUrl);
    }

    return { success: true };
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      return { error: "Password reset emails aren't configured yet — set RESEND_API_KEY." };
    }
    console.error("requestPasswordResetAction failed:", err);
    return { error: "Something went wrong. Try again in a moment." };
  }
}

const resetSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export async function resetPasswordAction(
  _prevState: PasswordResetActionState,
  formData: FormData
): Promise<PasswordResetActionState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tokenHash = hashToken(parsed.data.token);

  try {
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken || resetToken.expiresAt < new Date()) {
      return { error: "This reset link is invalid or has expired. Request a new one." };
    }

    const passwordHash = await hashPassword(parsed.data.password);

    await prisma.$transaction([
      prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: resetToken.userId } }),
    ]);
  } catch (err) {
    console.error("resetPasswordAction failed:", err);
    return { error: "Something went wrong. Try again in a moment." };
  }

  redirect("/login?reset=success");
}
