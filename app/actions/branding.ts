"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { validateImageUpload, extensionOf } from "@/lib/upload-validation";

export type ActionState = { error?: string } | null;

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "ADMIN") return { supabase, userId: user.id, isAdmin: false as const };
  return { supabase, userId: user.id, isAdmin: true as const };
}

async function uploadBrandingImage(
  file: File,
  storageDir: "settings" | "signatures",
  baseName: string,
): Promise<{ path: string } | { error: string }> {
  const check = validateImageUpload(file.name, file.type, file.size);
  if (!check.ok) return { error: check.error };
  const ext = extensionOf(file.name) ?? "png";
  const path = `${storageDir}/${baseName}.${ext}`;

  const supabase = await createClient();
  const { error } = await supabase.storage
    .from("nil-files")
    .upload(path, file, { contentType: file.type || "image/png", upsert: true });
  if (error) {
    console.error("uploadBrandingImage: storage upload failed", error);
    return { error: "بارگذاری تصویر ناموفق بود." };
  }
  return { path };
}

export async function uploadLetterhead(_p: ActionState, f: FormData): Promise<ActionState> {
  const { supabase, isAdmin } = await requireAdmin();
  if (!isAdmin) return { error: "این عملیات فقط برای مدیر سامانه مجاز است." };

  const file = f.get("file");
  if (!(file instanceof File)) return { error: "فایلی انتخاب نشده است." };
  const result = await uploadBrandingImage(file, "settings", "letterhead");
  if ("error" in result) return result;

  const { error } = await supabase
    .from("app_settings")
    .update({ letterhead_path: result.path, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: persianError(error.message) };

  revalidatePath("/settings");
  return null;
}

export async function uploadStamp(_p: ActionState, f: FormData): Promise<ActionState> {
  const { supabase, isAdmin } = await requireAdmin();
  if (!isAdmin) return { error: "این عملیات فقط برای مدیر سامانه مجاز است." };

  const file = f.get("file");
  if (!(file instanceof File)) return { error: "فایلی انتخاب نشده است." };
  const result = await uploadBrandingImage(file, "settings", "stamp");
  if ("error" in result) return result;

  const { error } = await supabase
    .from("app_settings")
    .update({ stamp_path: result.path, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: persianError(error.message) };

  revalidatePath("/settings");
  return null;
}

/** Uploads a signature: the account owner may upload their own; an admin may upload anyone's. */
export async function uploadSignature(_p: ActionState, f: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const targetUserId = String(f.get("user_id") ?? user.id);
  if (targetUserId !== user.id) {
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "ADMIN") return { error: "شما مجاز به تغییر امضای این کاربر نیستید." };
  }

  const file = f.get("file");
  if (!(file instanceof File)) return { error: "فایلی انتخاب نشده است." };
  const result = await uploadBrandingImage(file, "signatures", targetUserId);
  if ("error" in result) return result;

  const { error } = await supabase
    .from("profiles")
    .update({ signature_path: result.path, updated_at: new Date().toISOString() })
    .eq("id", targetUserId);
  if (error) return { error: persianError(error.message) };

  revalidatePath("/settings");
  revalidatePath("/profile");
  return null;
}
