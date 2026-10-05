# Payroll calculation engine — what it computes, and what it deliberately does not

Audience: the accountant / lawyer who must approve the numbers fed to the engine. The software contains **no legal
value**: no tax bracket, no insurance rate, no overtime ratio, no monthly-hours basis. Every such number is entered by the
company (on a salary component, or as an entry of an APPROVED legal rule set) and the engine refuses to guess a missing one.
**Choosing the numbers and their legal correctness is the company's responsibility**, not the software's.

Engine version recorded on every calculation: `PAYROLL_ENGINE_2` (Phase 8). Calculations made earlier carry
`PAYROLL_ENGINE_1` and are immutable. A batch that is still DRAFT / CALCULATED uses the current engine the next time it is calculated.

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

## 3. Warning codes (CRITICAL stops the line; none carries an amount)
`QUANTITY_MISSING` · `RULE_MISSING` · `RULE_AMBIGUOUS` · `RULE_CHANGES_IN_PERIOD` · `RULE_VALUE_INVALID` · `CURRENCY_MISMATCH` ·
`UNSUPPORTED_METHOD` (FORMULA, or a pre-Phase-8 QUANTITY_X_RATE definition without parameters) · `GROSS_BASIS_INCOMPLETE` · `NEGATIVE_NET` …
`HOURS_NOT_APPLIED` (INFO): overtime / absence / unpaid-leave numbers exist but **no** component in the person's profile uses them.

## 4. What is NOT modelled (decide separately — none of it happens silently)
- **Proration** of a partial period (hired / left mid-month): the existing `PARTIAL_PERIOD` warning stays; salary is not pro-rated.
  Absence days entered for such a month are therefore not reconciled with the partial period.
- Leave balances / accrual, public holidays, shift patterns, overtime caps, night / holiday overtime premiums beyond one multiplier per component.
- Hours collected automatically from other modules (work data is entered in the grid or imported as data).
- Non-monthly payment frequencies; Rial↔Toman conversion (amounts are used in the batch currency exactly as entered).
- Any legal interpretation: which allowances belong in the wage basis, the legal overtime ratio, the legal monthly hours or days basis.

## 5. Where to configure
`/payroll/components` (create a component → method «مقدار × نرخ») · `/payroll/rule-sets` (approved rules) · the personnel compensation tab
(add the component to the person's profile; hourly rate and per-person rate overrides) · the work-data grid of the period (quantities).
