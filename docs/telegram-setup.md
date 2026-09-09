# NIL Assistant — Telegram channel setup

Telegram is a **channel**, not a second assistant — every message is
handled by the exact same Action Registry, permission checks, and
Confirmation Engine as the web "دستیار نیل" (`lib/assistant/`). This
document is the one-time manual setup a human runs after deploying —
none of these steps are run automatically by Claude.

## 1. Create the bot

1. Open Telegram, message **@BotFather**.
2. `/newbot`, choose a name and a `@username`.
3. BotFather gives you a token like `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

## 2. Set environment variables

On the server (`/root/nil-office/.env.local`), add:

```
TELEGRAM_BOT_TOKEN=<the token from BotFather>
TELEGRAM_WEBHOOK_SECRET=<a random string you generate, e.g. via `openssl rand -hex 32`>
TELEGRAM_ALLOWED_USER_IDS=<comma-separated numeric Telegram user ids>
```

To get a numeric Telegram user id (not the `@username`), message
**@userinfobot** from the account that should be allowed — it replies
with your numeric `Id:`.

Rebuild and restart after setting these (same as any other env change):

```bash
cd /root/nil-office && npm run build && pm2 restart nil-office
```

## 3. Register the webhook (run this yourself — not automated)

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://office.nil-management.ir/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET — must match the env var exactly>"
  }'
```

A successful response looks like `{"ok":true,"result":true,"description":"Webhook was set"}`.

To check it later: `curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"`.

## 4. Link allowed Telegram accounts to NIL Office profiles

Each allowed Telegram user id must be mapped to a real `profiles.id` —
the allowlist alone only decides "can this Telegram account talk to the
bot at all"; the mapping decides "as which NIL Office user, with which
permissions." Run this in the Supabase SQL editor for each of the two
v1 users, after finding their `profiles.id` (Settings page, or
`select id, full_name from profiles;`):

```sql
insert into public.assistant_channel_identities (channel, external_user_id, profile_id)
values
  ('TELEGRAM', '<Marzieh''s numeric Telegram id>', '<Marzieh''s profiles.id>'),
  ('TELEGRAM', '<Saman''s numeric Telegram id>',   '<Saman''s profiles.id>');
```

A Telegram id in `TELEGRAM_ALLOWED_USER_IDS` but with no matching row
here gets a clear "not linked yet" message, not an error — see spec §6.

## 5. Test

1. Message the bot from an **allowed** account: `/start` should reply
   with a short welcome and suggested questions.
2. Message from a **third**, unlisted Telegram account: should get
   "دسترسی شما به این ربات مجاز نیست." — and no query should reach
   NIL Office at all for that account.
3. Ask a real question: "امروز چه کارهایی دارم؟" — answer should be
   grounded in that user's real, permission-filtered data.
4. Ask for a write: "برای [شرکت واقعی] سه روز دیگر پیگیری ثبت کن." —
   should show a preview with تأیید/لغو buttons, and only create the
   follow-up after تأیید is tapped.
5. Add the bot to a Telegram group and send a message — should get no
   response at all (private-chat-only, spec §26).

## Rotating/revoking access

- **Revoke a user**: remove their id from `TELEGRAM_ALLOWED_USER_IDS`
  (fast, no DB change) — or set `assistant_channel_identities.is_active
  = false` for a more permanent record-keeping revoke.
- **Rotate the bot token**: get a new one from BotFather
  (`/revoke` then re-issue, or `/mybots` -> API Token -> Revoke), update
  `TELEGRAM_BOT_TOKEN`, rebuild+restart, then re-run step 3's
  `setWebhook` (the URL/secret can stay the same).
- **Rotate the webhook secret**: generate a new one, update the env var,
  rebuild+restart, then re-run step 3's `setWebhook` with the new value.
