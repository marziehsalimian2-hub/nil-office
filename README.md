# دبیرخانه نیل — NIL Office v1.0

سامانهٔ داخلی مکاتبات، بایگانی، پرونده‌ها، پیگیری‌ها و **حسابداری دوطرفه** برای **شرکت توسعه مدیریت راهبردی نیل**.

رابط فارسی و راست‌به‌چپ، شماره‌گذاری رسمیِ اتمیک و ضدتکرار، استوریج خصوصی، RLS و لاگ ممیزی.

---

## استک فنی

Next.js 15 (App Router) · TypeScript · React 19 · Tailwind CSS · Supabase (Postgres + Auth + Storage + RLS)

---

## راه‌اندازی گام‌به‌گام

### ۱) پیش‌نیازها
- Node.js 20 یا بالاتر
- یک پروژهٔ Supabase (رایگان هم کافی است)

### ۲) نصب وابستگی‌ها
```bash
npm install
```

### ۳) متغیرهای محیطی
فایل `.env.example` را به `.env.local` کپی کنید و مقادیر پروژهٔ Supabase خود را بگذارید:
```bash
cp .env.example .env.local
```
```
NEXT_PUBLIC_SUPABASE_URL=...          # از Project Settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY=...     # کلید anon (عمومی)
SUPABASE_SERVICE_ROLE_KEY=...         # فقط سمت سرور — هرگز public نکنید
```

### ۴) اجرای مهاجرت‌های دیتابیس (به‌ترتیب)
در Supabase → **SQL Editor** محتوای این فایل‌ها را **به همین ترتیب** اجرا کنید:
```
supabase/migrations/0001_init.sql       # enumها، تبدیل جلالی، توابع نمایش
supabase/migrations/0002_tables.sql     # ۱۰ جدول + ایندکس‌ها + محدودیت‌ها
supabase/migrations/0003_functions.sql  # RPCها: شماره‌گذاری اتمیک، جستجو، تریگرها
supabase/migrations/0004_rls.sql        # سیاست‌های RLS
supabase/migrations/0005_storage.sql    # باکت خصوصی nil-files + سیاست‌ها
supabase/migrations/0006_seed.sql       # (اختیاری) دادهٔ نمونه دبیرخانه
supabase/migrations/0007_accounting_tables.sql    # جدول‌های حسابداری + enumها
supabase/migrations/0008_accounting_functions.sql # ثبت، برگشت، بستن سال، ویوهای گزارش
supabase/migrations/0009_accounting_rls.sql       # RLS حسابداری + رفع تشدید دسترسی
supabase/migrations/0010_accounting_seed.sql      # واحد پول، سال مالی و کدینگ اولیه
```

### ۵) ساخت کاربران و مدیر اول
1. در Supabase → **Authentication → Users** دو کاربر بسازید (یا بگذارید خودشان از صفحهٔ ورود ثبت‌نام کنند).
   با ساخت هر کاربر، یک ردیف `profiles` به‌صورت خودکار ساخته می‌شود.
2. یک نفر را مدیر کنید:
```sql
update public.profiles set role = 'ADMIN'
where id = (select id from auth.users where email = 'admin@nil.example');
```

> نقش `ADMIN` به‌صورت خودکار دسترسی کامل حسابداری هم دارد. برای دادن دسترسی حسابداری به کاربرِ غیرمدیر، از **تنظیمات ← کاربران ← دسترسی مالی** (مشاهده/ثبت/ثبت قطعی/مدیر مالی) استفاده کنید. بدون این نقش، بخش مالی برای کاربر نمایش داده نمی‌شود.

### ۶) مقداردهی اولیهٔ شماره‌ها (ادامهٔ بایگانی موجود)
از داخل برنامه: **تنظیمات → مقداردهی اولیهٔ سری شماره‌ها** (نیازمند نقش مدیر).
یا مستقیم در SQL Editor:
```sql
select public.init_number_sequence('OUTGOING', 1405, 69);  -- نامهٔ بعدی: ص-1405-0070
select public.init_number_sequence('INCOMING', 1405, 18);  -- نامهٔ بعدی: و-1405-0019
```

### ۷) اجرا
```bash
npm run dev          # حالت توسعه روی http://localhost:3000
# یا
npm run build && npm run start
```

---

## بررسی‌های کیفیت (همه پاس می‌شوند)
```bash
npm run typecheck    # tsc --noEmit
npm run lint
npm run build
```

---

## تست شماره‌گذاری (بخش حیاتی)

### تست هم‌زمانی دو کاربره
دو کاربر تست بسازید و متغیرها را ست کنید، سپس:
```bash
node supabase/tests/concurrent-finalize.mjs
```
خروجی درست: دو شمارهٔ **متفاوت** (مثلاً `ص-1405-0070` و `ص-1405-0071`) و رد شدن ثبت‌نهاییِ دوباره.

سناریوهای دیگر (پیش‌نویس بدون شماره، ابطال با حفظ شماره، استقلال سری صادره/وارده) در همان اسکریپت و در کامنت‌های `0003_functions.sql` توضیح داده شده‌اند.

### تست‌های حسابداری
```bash
node supabase/tests/concurrent-post.mjs      # دو سند هم‌زمان → دو شمارهٔ ACC متفاوت و متوالی
```
و تستِ یکپارچگیِ کامل (نامتوازن رد، متوازن ثبت، ثبت مجدد بدون شمارهٔ نو، تغییرناپذیری سند ثبت‌شده، سال بسته، حذف پیش‌نویس‌ها از گزارش‌ها، توازن تراز آزمایشی) را در **SQL Editor** اجرا کنید — این اسکریپت با یک ADMIN موجود کار می‌کند و در پایان `ROLLBACK` می‌شود:
```
supabase/tests/accounting_integrity.sql
```

---

## نکات استقرار (Deploy)

- روی Vercel یا هر میزبان Node مستقر کنید؛ سه متغیر محیطی بالا را تنظیم کنید.
- **فونت آفلاین:** فونت Vazirmatn به‌صورت خودمیزبان (`app/fonts/Vazirmatn-Variable.woff2` با `next/font/local`) بارگذاری می‌شود و به اینترنت وابسته نیست؛ روی شبکهٔ داخلی هم کار می‌کند.
- **سربرگ/مهر نیل:** در v1 کاربر فایل نهایی Word/PDF را پیوست می‌کند. تولید خودکار نامه روی سربرگ در معماری پیش‌بینی شده اما پیاده نشده است.

جزئیات کامل معماری، مدل امنیت و محدودیت‌ها در `docs/IMPLEMENTATION_REPORT.md`.
