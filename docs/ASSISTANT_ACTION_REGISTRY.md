# NIL Assistant — Action Registry reference

The Action Registry (`lib/assistant/actions/registry.ts`) is the **only** set of operations the LLM can ever
request. There is no generic SQL / database / shell tool, and `CRITICAL` actions are never registered.
`lib/assistant/actions/registry.test.ts` asserts that **every registered action appears in this file** and that
the gate column below matches the code's structural rules (an action with no `requiredAccess` must be on the
reviewed any-active-user allowlist in that test).

- **Gate** = the permission predicate in `requiredAccess`. Over Telegram every query runs as `service_role`
  (RLS bypassed), so this predicate is the *only* permission layer there; on the web it is a second layer on
  top of RLS. It is evaluated **twice**: when the action is proposed/executed in the chat turn, and again when
  a write is confirmed (`confirmPendingAction`).
- **Confirm** = a write goes through preview → explicit confirmation. **Button** = only the «تأیید» button can
  confirm it (a bare «باشه» is refused). **Phrase OK** = a bare «باشه» may confirm it (exactly one pending action).
- Amounts are exact decimal text produced by the database; the model never computes totals; currencies are
  never summed.

## Read actions (LOW, no confirmation)

| Action | Gate | Notes |
|---|---|---|
| `GET_TODAY_WORK` | any active user (sections gated inside) | caller's own tasks / follow-ups / milestones |
| `GET_ATTENTION_ITEMS` | any active user (sections gated inside) | `lib/dashboard/attention` getters apply per-module roles |
| `GET_DAILY_BRIEF` | any active user (sections gated inside) | composition of the gated dashboard getters |
| `GET_FINANCIAL_SUMMARY` | ADMIN or `accounting_role` | executive dashboard getter |
| `GET_RECEIVABLES_SUMMARY` | ADMIN or `invoice_role` | |
| `GET_CRM_SUMMARY` | ADMIN or `crm_role` | |
| `GET_PROJECT_SUMMARY` | ADMIN or `project_role` | |
| `GET_CONTRACT_SUMMARY` | ADMIN or `contract_role` | |
| `SEARCH_COMPANY` | any active user | companies are readable by every active user (RLS `p_companies_read`) |
| `SEARCH_OPPORTUNITY` | ADMIN or `crm_role` | |
| `SEARCH_CONTRACT` | ADMIN or `contract_role` | |
| `SEARCH_INVOICES` | ADMIN or `invoice_role` | |
| `SEARCH_PROJECT` | ADMIN or `project_role` | |
| `SEARCH_CORRESPONDENCE` | any active user | RLS `p_corr_read` |
| `SEARCH_DOCUMENTS` | any active user | RLS `p_docs_read` |
| `SEARCH_TASKS` | any active user — **scoped in handler** | without project access only tasks the caller is assigned to / created (`p_tasks_read`) |
| `GET_COMPANY_360` | any active user — sections gated inside | CRM / contracts / projects / invoices sections only with that module's role |
| `GET_COMPANY_FINANCIAL_SUMMARY` | ADMIN or accounting / invoice / contract role | per-currency received / paid / outstanding invoices, exact text, POSTED documents only (`assistant_company_balance`, 0134) |
| `GET_OPPORTUNITY` | ADMIN or `crm_role` | |
| `GET_CONTRACT` | ADMIN or `contract_role` | |
| `GET_PROJECT_STATUS` | ADMIN or `project_role` | |
| `GET_CORRESPONDENCE` | any active user | RLS `p_corr_read` |
| `GET_DOCUMENT_METADATA` | any active user | metadata only, never file content |
| `LIST_FOLLOWUPS` | any active user | RLS `p_followups_read` |
| `LIST_MY_TASKS` | any active user | filters `assigned_to = caller` |
| `GET_TASK` | any active user — **scoped in handler** | same ownership rule as `SEARCH_TASKS` |
| `SEARCH_CHEQUES`, `GET_CHEQUE`, `GET_CHEQUES_DUE`, `GET_CHEQUE_BOOK_STATUS` | ADMIN or `cheque_role` | read-only |
| `LIST_TRADE_OFFERS`, `GET_TRADE_OFFER_BUYERS` | ADMIN or `trade_role` | |
| `GET_CLIENT_SERVICE_SUMMARY`, `LIST_CLIENT_SERVICES`, `SEARCH_SERVICE_ENTRIES`, `GET_UNBILLED_WORK`, `GET_REIMBURSABLE_EXPENSES` | ADMIN or any `service_ledger_role` | search term is escaped before it reaches a PostgREST filter |
| `GET_CLIENT_SERVICE_PERIOD_NUMBERS`, `LIST_CLIENT_REPORT_TEMPLATES`, `GET_CLIENT_DEFAULT_REPORT_TEMPLATE`, `GET_CLIENT_REPORT_HISTORY` | ADMIN or any `service_ledger_role` | client reports only — the internal management report is unreachable |
| `GET_MY_PAYSLIP` | any active user — **own payslip only** | no person parameter; owner = authenticated profile; salary amounts are never sent to the model; the archived PDF is delivered by the channel layer |

## Write actions (confirmation required)

| Action | Risk | Gate | Confirm | Effect |
|---|---|---|---|---|
| `CREATE_TASK_DRAFT` | MEDIUM | any active user | Phrase OK | task assigned to the caller |
| `CREATE_FOLLOWUP_DRAFT` | MEDIUM | any active user | Phrase OK | follow-up assigned to the caller |
| `CREATE_CHEQUE_DRAFT` | MEDIUM | ADMIN or `cheque_role` ≥ CREATE | Phrase OK | DRAFT cheque only (issue / clear / void are not reachable) |
| `PREPARE_CHEQUE_PRINT` | MEDIUM | ADMIN or `cheque_role` ≥ CREATE | Phrase OK | print preparation only |
| `CREATE_SERVICE_ENTRY_DRAFT`, `ADD_TIME_ENTRY_DRAFT`, `ADD_SERVICE_EXPENSE_DRAFT` | MEDIUM | service-ledger access | Phrase OK | drafts; billing batches are never reachable |
| `PREPARE_CLIENT_SERVICE_REPORT` | MEDIUM | service-ledger access | Phrase OK | generates the CLIENT report PDF |
| `CREATE_LETTER_DRAFT` | MEDIUM | any active user | Phrase OK | **numberless DRAFT letter only** |
| `FINALIZE_LETTER` | HIGH | any active user — own draft or ADMIN | **Button** | issues the official letter number (irreversible), archives + delivers the PDF |
| `CREATE_INVOICE_DRAFT` | MEDIUM | `invoice_role` ≥ CREATE | Phrase OK | **DRAFT invoice / proforma only**; totals are database-generated |
| `ISSUE_SALES_DOCUMENT` | HIGH | `invoice_role` ≥ APPROVE — own draft or ADMIN | **Button** | issues the official invoice / proforma number (irreversible), delivers the PDF |
| `REGISTER_INCOMING_LETTER` | HIGH | any active user | **Button** | registers an incoming letter (official incoming number) + archives the original file |

## Deliberately NOT in the registry (permanent boundaries)

Accounting posting / reversal · cheque issue, clear, void · billing-batch creation or conversion · payroll
calculation, approval, payment · another person's payslip or salary · HR personnel records · permission / user
management · the internal management report · any generic query tool. See also `docs/ACCOUNTING_AI_SAFETY.md`.
