"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";

export type ActionState = { error?: string } | null;

/** Updates full_name/title: the account owner may edit their own; an admin may edit anyone's. */
export async function updateProfileNameTitle(_p: ActionState, f: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const targetUserId = String(f.get("user_id") ?? user.id);
  if (targetUserId !== user.id) {
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "ADMIN") return { error: "شما مجاز به تغییر اطلاعات این کاربر نیستید." };
  }

  const fullName = String(f.get("full_name") ?? "").trim();
  const title = String(f.get("title") ?? "").trim();
  if (!fullName) return { error: "نام نمی‌تواند خالی باشد." };

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, title: title || null, updated_at: new Date().toISOString() })
    .eq("id", targetUserId);
  if (error) return { error: persianError(error.message) };

  revalidatePath("/settings");
  revalidatePath("/profile");
  return null;
}
