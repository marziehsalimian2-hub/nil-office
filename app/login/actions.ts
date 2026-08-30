"use server";

import { createClient } from "@/lib/supabase/server";

export type LoginState = { ok?: boolean; redirect?: string; error?: string } | null;

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "") || "/dashboard";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "ایمیل یا گذرواژه نادرست است." };

  return { ok: true, redirect: redirectTo };
}