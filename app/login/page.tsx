"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FormError } from "@/components/form";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      setError("ایمیل یا گذرواژه نادرست است.");
      return;
    }
    // give the browser a tick to persist the session cookie, then hard-navigate
    window.location.href = params.get("redirect") || "/dashboard";
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-ink text-lg font-bold text-seal-soft">
          نیل
        </div>
        <h1 className="text-lg font-semibold text-ink">دبیرخانه نیل</h1>
        <p className="mt-1 text-sm text-ink-muted">سامانه داخلی مکاتبات و بایگانی</p>
      </div>
      <form onSubmit={onSubmit} className="card space-y-4 p-6">
        {params.get("inactive") && (
          <FormError message="حساب شما غیرفعال است. با مدیر تماس بگیرید." />
        )}
        <FormError message={error} />
        <label className="block">
          <span className="field-label">ایمیل</span>
          <input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} className="input text-left" placeholder="name@nil.example" />
        </label>
        <label className="block">
          <span className="field-label">گذرواژه</span>
          <input type="password" dir="ltr" required value={password} onChange={(e) => setPassword(e.target.value)} className="input text-left" />
        </label>
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "در حال ورود…" : "ورود"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}