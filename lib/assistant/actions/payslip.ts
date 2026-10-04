import "server-only";
import { z } from "zod";
import { currentJalaliYMD } from "@/lib/jalali";
import { selectOwnPayslip, PAYMENT_STATE_AT_ISSUE_FA, type OwnPayslipItem } from "@/lib/assistant/payslipSelect";
import type { ActionDefinition } from "./types";

const getMyPayslipInput = z.object({
  period: z.enum(["latest", "this_month", "prev_month"]).optional(),
  jalali_year: z.number().int().min(1300).max(1600).optional(),
  jalali_month: z.number().int().min(1).max(12).optional(),
});

/**
 * «فیش حقوقی خودم» — the caller's OWN archived payslip, nothing else (spec §28/§29).
 *
 * There is deliberately NO parameter that names a person: the owner is always the authenticated profile
 * (ctx.userId), resolved server-side through personnel.profile_id inside the SECURITY DEFINER functions of
 * 0134 — which re-check ownership themselves, so even a bug here could not leak another employee's payslip.
 * Asking for someone else's payslip has no tool at all (the web UI's payroll access is the only path).
 *
 * Salary AMOUNTS are intentionally not returned to the model: it only learns period + payment state at
 * issue, and the real archived PDF (the single source of truth, never regenerated) is delivered by the
 * channel layer via the `deliver` hint. This keeps salary data out of the LLM vendor entirely.
 */
export const getMyPayslip: ActionDefinition<z.infer<typeof getMyPayslipInput>> = {
  name: "GET_MY_PAYSLIP",
  description:
    "ارسال «فیش حقوقی خودِ کاربر» (فقط فیش خودِ همین کاربر، هرگز فیش دیگران). بدون ورودی یا با period=latest آخرین فیش صادرشده، با this_month فیش این ماه شمسی، با prev_month ماه قبل؛ برای ماه مشخص jalali_year و jalali_month (شمسی) را با هم بفرست. فیش‌ها فقط پس از تأیید حقوق و صدور توسط واحد حقوق‌ودستمزد موجودند. مبلغ حقوق را به کاربر نگو و حدس نزن — خود فایل PDF فیش ارسال می‌شود. اگر کاربر فیش شخص دیگری را خواست، بگو این کار از طریق ربات ممکن نیست و باید از بخش حقوق‌ودستمزد در NIL Office اقدام شود.",
  riskLevel: "LOW",
  requiresConfirmation: false,
  inputSchema: getMyPayslipInput,
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase.rpc("assistant_my_payslips", { p_profile_id: ctx.userId });
    if (error) {
      console.error("[assistant] assistant_my_payslips failed", error.message);
      throw new Error("دریافت فیش حقوقی ناموفق بود.");
    }
    const result = data as { linked: boolean; items: OwnPayslipItem[] } | null;
    if (!result?.linked) {
      return { data: { note: "حساب شما هنوز به پروندهٔ پرسنلی متصل نشده است؛ لطفاً با مدیر منابع انسانی تماس بگیرید." } };
    }

    const { jy, jm } = currentJalaliYMD(new Date());
    const picked = selectOwnPayslip(result.items ?? [], input, { jy, jm });
    if (!picked.ok) return { data: { note: picked.error } };

    return {
      data: {
        period: picked.label,
        revision: picked.item.revision,
        state_at_issue: PAYMENT_STATE_AT_ISSUE_FA[picked.item.payment_state],
        note: "فایل PDF فیش به‌صورت جداگانه برای کاربر ارسال می‌شود.",
      },
      cards: [{ kind: "payslip", id: picked.item.id, title: `فیش حقوقی ${picked.label}`, subtitle: PAYMENT_STATE_AT_ISSUE_FA[picked.item.payment_state], href: `/api/payslips/${picked.item.id}/pdf` }],
      deliver: [{ kind: "PAYSLIP", payslipId: picked.item.id, label: picked.label }],
    };
  },
};

export const payslipActions: ActionDefinition<any>[] = [getMyPayslip];
