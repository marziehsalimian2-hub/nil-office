# Payroll calculation engine — what it computes, and what it deliberately does not

Audience: the accountant / lawyer who must approve the numbers fed to the engine. The software contains **no legal
value**: no tax bracket, no insurance rate, no overtime ratio, no monthly-hours basis. Every such number is entered by the
company (on a salary component, or as an entry of an APPROVED legal rule set) and the engine refuses to guess a missing one.
**Choosing the numbers and their legal correctness is the company's responsibility**, not the software's.

Engine version recorded on every calculation: `PAYROLL_ENGINE_3` (Phase 9). Calculations made earlier carry
`PAYROLL_ENGINE_1` / `PAYROLL_ENGINE_2` and are immutable. A batch that is still DRAFT / CALCULATED uses the current engine the next time it is calculated.

## 1. Common rules (unchanged since Phase 3)
- One calculation per batch run; each person is calculated from: the compensation profile in force at the period end, the
  work data of that period, the components of the profile, the batch's currency / rounding scale / rounding mode / jurisdiction.
- Everything is exact decimal arithmetic in the database (`numeric`). A line amount is rounded **once** (batch scale + mode);
  totals are plain sums of rounded lines. Amounts leave the database as text.
- Totals: gross = sum of EARNING lines; deductions = sum of DEDUCTION lines; net = gross − deductions. EMPLOYER_COST lines never
  reduce net; INFORMATIONAL lines are excluded.
- A line that cannot be computed gets **no amount** and a CRITICAL warning; the person's result is then incomplete (cannot be approved).
  A gross-based percentage line is blocked while any earning is not computed.
- Methods: `FIXED`, `PERCENTAGE` (fixed % or % from an APPROVED rule; basis BASE_SALARY or GROSS_EARNINGS), `MANUAL_INPUT`,
  and — new in Phase 8 — `QUANTITY_X_RATE`. `FORMULA` is defined but never evaluated.
- Phase 9 adds calendar-day proration of a partial month (section 3) and the Toman ledger rule (section 5).

## 2. QUANTITY_X_RATE (overtime, absence, mission …)
**amount = quantity × rate.** The component's type decides the direction: EARNING (e.g. overtime pay) adds, DEDUCTION
(e.g. absence) subtracts.

**Quantity** — one column of the monthly work data (the grid already has them): `OVERTIME_HOURS`, `ABSENCE_HOURS`, `ABSENCE_DAYS`,
`UNPAID_LEAVE_DAYS`, `PAID_LEAVE_DAYS`, `MISSION_DAYS`, `MISSION_HOURS`, `WORK_DAYS`, `WORK_HOURS`. The unit (hours / days) follows from the name.
A field that was **not entered (empty)** stops the line (`QUANTITY_MISSING`); an explicit **0** is a valid line with amount 0.

**Rate** — two modes, chosen per component:
1. `PER_UNIT` — a fixed rate per unit on the component (e.g. mission allowance per day). A compensation line may override
   it for one person (a contractual rate).
2. `WAGE_FRACTION` — **rate = wage ÷ divisor × multiplier**
   - *wage* = the person's `base salary`; **except** for hour-based quantities when the person's compensation profile has an
     explicit **hourly rate** in the batch currency: then wage = that hourly rate and *no divisor is used*.
   - *divisor* = how many units make a month (hours or days, matching the quantity). Given **exactly one** way: a number on the
     component (`unit_divisor`) **or** an APPROVED rule key (`divisor_rule_key`, rule unit `HOURS` or `DAYS`).
   - *multiplier* = e.g. the overtime ratio, or 1 for a plain absence deduction. Exactly one way: a number on the component
     (`rate_multiplier`, 0–10) **or** an APPROVED rule key (`multiplier_rule_key`, rule unit `RATIO`).
   - Computed as `quantity × wage × multiplier ÷ divisor` (one division, one rounding). The unit rate shown on the line is informational.

**Rule-bound parameters** use the normal rule workflow (DRAFT → REVIEWED → APPROVED) and the batch's jurisdiction. If the rule
is missing, ambiguous, changes inside the period, or has the wrong unit/value, the line gets a CRITICAL warning
(`RULE_MISSING`, `RULE_AMBIGUOUS`, `RULE_CHANGES_IN_PERIOD`, `RULE_VALUE_INVALID`) and no amount.

**Traceability** — each computed line stores the quantity, its unit, the unit rate and a `details` record: wage source
(`BASE_SALARY` / `PROFILE_HOURLY`), where the divisor and multiplier came from (component, or rule key + rule-set id + entry id).
The payslip PDF and the result screen show «۱۰ ساعت × نرخ» next to such lines so an accountant can recompute the number by hand.

**Worked example** (base salary 30,000,000, HALF_UP, scale 0): overtime 10 h, divisor 220, multiplier 1.4 →
10 × 30,000,000 × 1.4 ÷ 220 = 1,909,090.909… → **1,909,091**. Absence 2 days, divisor 30, multiplier 1 → **2,000,000** deduction.
With an hourly rate of 150,000 on the profile: 10 × 150,000 × 1.4 = **2,100,000**.
Percentage lines based on GROSS_EARNINGS include overtime pay automatically.

## 3. Partial month — calendar-day proration (Phase 9)
A person hired or leaving in the middle of a period is paid for the days employed, not the whole month.

**Days.** `period_days` = the real length of the Jalali period (29–31). `employed_days` = the number of days of the period covered by
**any** employment record of the person (a record is half-open: its end date is the first day **not** employed; the first working day
and the last working day both count). Records with a gap (left and came back) are therefore counted correctly. The ratio is
`employed_days ÷ period_days`, used **only** when `0 < employed_days < period_days` — a full-month person gets exactly the numbers
of the earlier engines.

**What is prorated** (one multiplication, one division, one final rounding per line):
- **Base salary** — always.
- **FIXED components that the company ticked** («در ماه ناقص متناسب شود», off by default; the per-person amount override is prorated too).
  Which allowances are legally prorated is the company's decision — that is why it is a tick per component, not a global rule.
- **PERCENTAGE lines** follow automatically: based on base salary they use the prorated base, based on gross they use the prorated gross.

**What is never prorated:** MANUAL_INPUT amounts, QUANTITY_X_RATE lines (overtime, absence, mission, leave) — and overtime / absence
use the **full, unprorated** base salary (or the profile's hourly rate) as the wage, because the hourly / daily rate does not shrink in a part month.
Absence days entered for a part month are not reconciled with the employed days.

**Traceability.** Every prorated line stores `details.proration = {employed_days, period_days}`; the person's result stores
`inputs.proration = {employed_days, period_days, applied}`. The result screen, the batch review and the payslip PDF show
«متناسب با ۱۰ روز از ۳۱ روز».

**Worked example** (31-day period, base 31,000,000, HALF_UP, scale 0): hired on day 22 → 10 days → base **10,000,000**; a ticked
allowance of 1,550,000 → **500,000**; an un-ticked allowance of 1,000,000 stays **1,000,000**; a 7 % of base line → **700,000**; a manual
bonus of 200,000 stays **200,000**; overtime 10 h = 10 × 31,000,000 × 1.4 ÷ 220 = **1,972,727** (full base). A base of 10,000,000 for 7 of 31 days
= 2,258,064.516… → **2,258,065**.

**Warnings.** `PARTIAL_PERIOD` (WARNING) = the ratio was applied. `PRORATION_NOT_APPLIED` (WARNING) = the person is flagged as part-month
but has **no** employment day in the period (e.g. forced in with an INCLUDE override): nothing is prorated and the full salary is
calculated — a salary is never silently zeroed; check the employment records. There is no per-batch switch: to pay a full month to a
part-month person, correct the employment dates or use the eligibility override deliberately.

## 4. Warning codes (CRITICAL stops the line; none carries an amount)
`QUANTITY_MISSING` · `RULE_MISSING` · `RULE_AMBIGUOUS` · `RULE_CHANGES_IN_PERIOD` · `RULE_VALUE_INVALID` · `CURRENCY_MISMATCH` ·
`UNSUPPORTED_METHOD` (FORMULA, or a pre-Phase-8 QUANTITY_X_RATE definition without parameters) · `GROSS_BASIS_INCOMPLETE` · `NEGATIVE_NET` …
`PARTIAL_PERIOD` · `PRORATION_NOT_APPLIED` (WARNING, section 3).
`HOURS_NOT_APPLIED` (INFO): overtime / absence / unpaid-leave numbers exist but **no** component in the person's profile uses them.

## 5. Toman books (Phase 9)
A payroll batch can be calculated, approved and given payslips in any supported currency, but it can create an **accounting draft** and
**payment drafts** only when its currency belongs to the books' unit. The system never converts Rial ↔ Toman: stored amounts are
already in the configured unit (Settings → «واحد نمایش»).

| Settings | Books' currencies (`accounting_ledger_currencies()`) | Accepted for accounting / payments |
|---|---|---|
| display unit **Rial**, base IRR | IRR | IRR batch with an IRR bank account |
| display unit **Toman**, base IRR or TOMAN | IRR **and** TOMAN | an IRR **or** TOMAN batch, with an IRR **or** TOMAN bank account |
| any other base (e.g. USD) | that base only | batches / banks in that currency only |

So a company that pays in Toman sets the display unit to Toman once; it works whether its documents are coded `TOMAN` or coded `IRR`
carrying Toman numbers. With display unit Rial a TOMAN batch is refused (`PAYROLL_CURRENCY_NOT_BASE`) — that would need ×10, which is not
modelled. Labels keep following each document's own currency code (IRR → «ریال», TOMAN → «تومان»); no app-wide relabeling is done.

## 6. What is NOT modelled (decide separately — none of it happens silently)
- A per-batch switch or a 30-day-month option for proration; leave / holiday logic in the employed days.
- Leave balances / accrual, public holidays, shift patterns, overtime caps, night / holiday overtime premiums beyond one multiplier per component.
- Hours collected automatically from other modules (work data is entered in the grid or imported as data).
- Non-monthly payment frequencies; Rial↔Toman conversion (amounts are used in the batch currency exactly as entered); relabeling of IRR documents that hold Toman numbers.
- Any legal interpretation: which allowances belong in the wage basis, the legal overtime ratio, the legal monthly hours or days basis.

## 7. Where to configure
`/payroll/components` (create a component → method «مقدار × نرخ»; for a «مبلغ ثابت» component tick «در ماه ناقص متناسب شود») · `/payroll/rule-sets` (approved rules) · the personnel compensation tab
(add the component to the person's profile; hourly rate and per-person rate overrides) · the work-data grid of the period (quantities) · Settings → «واحد نمایش» (Toman books).
