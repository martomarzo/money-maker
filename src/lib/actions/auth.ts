"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { signIn } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { seedPersonalLedger } from "@/db/seed-personal";

const registerSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1, "Enter your name").max(80),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function register(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const email = parsed.data.email.toLowerCase();

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    return { ok: false, error: "An account with this email already exists" };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email, passwordHash, displayName: parsed.data.displayName })
      .returning({ id: users.id });
    await seedPersonalLedger(tx, user.id);
  });

  await signIn("credentials", {
    email,
    password: parsed.data.password,
    redirectTo: "/",
  });
  return { ok: true };
}

export async function login(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? "").toLowerCase(),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/",
    });
    return { ok: true };
  } catch (error) {
    // next-auth signals redirects by throwing — rethrow those.
    if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) {
      throw error;
    }
    return { ok: false, error: "Invalid email or password" };
  }
}
