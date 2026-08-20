# نظام إدارة مؤسسة زروق للخدمات المطبعية

نظام محاسبي وإداري ويعمل من المتصفح مباشرة (بدون تسجيل دخول)، متصل بقاعدة بيانات Supabase، بواجهة عربية RTL متجاوبة مع الهاتف والحاسوب.

## هيكل الملفات

```
zerough/
├── index.html      واجهة التطبيق (الهيكل والأقسام)
├── style.css       التصميم الكامل
├── app.js          منطق التطبيق (البيانات، الفواتير، التقارير)
├── supabase.js     إعدادات الاتصال بـ Supabase (المكان الوحيد للمفاتيح)
└── README.md       هذا الملف
```

## 1) إكمال إعداد قاعدة البيانات

جداول `users_profile, customers, products, invoices, invoice_items, expenses, direct_sales, settings` تم إنشاؤها مسبقا. قبل تشغيل النظام، افتح **SQL Editor** في Supabase وشغّل الاستعلام التالي لإضافة الجداول والحقول الناقصة (المشتريات + تصنيف المصروفات):

```sql
-- تصنيف المصروفات
alter table expenses add column if not exists category text default 'أخرى';

-- جدول المشتريات
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  supplier text,
  purchase_date date default current_date,
  total numeric default 0,
  item_count integer default 0,
  created_at timestamp default now()
);

-- أصناف المشتريات
create table if not exists purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid references purchases(id) on delete cascade,
  product_name text not null,
  quantity numeric default 1,
  price numeric default 0,
  total numeric default 0
);

alter table purchases enable row level security;
alter table purchase_items enable row level security;

drop policy if exists "purchases_access" on purchases;
create policy "purchases_access" on purchases for all to public using (true) with check (true);

drop policy if exists "purchase_items_access" on purchase_items;
create policy "purchase_items_access" on purchase_items for all to public using (true) with check (true);
```

## 2) ربط مفتاح Supabase

1. من لوحة Supabase: **Settings → API → Project API keys → anon public**.
2. انسخ المفتاح.
3. افتح ملف `supabase.js` وضع المفتاح مكان `ضع_مفتاحك_العام_هنا`:

```js
const SUPABASE_ANON_KEY = "هنا_المفتاح_الذي_نسخته";
```

الرابط `SUPABASE_URL` معبّأ مسبقا بمشروعك.

> ⚠️ سياسات RLS الحالية "public access" تسمح لأي شخص يملك الرابط بالقراءة والكتابة، لأن النظام يعمل بدون تسجيل دخول كما طُلب. إذا رغبت مستقبلا بحماية أكبر، يمكن إضافة نظام مصادقة (Supabase Auth) وتقييد السياسات لاحقا.

## 3) رفع شعار المؤسسة

من قسم **الإعدادات** داخل النظام، ضع رابط صورة الشعار (Logo URL) — يمكن رفع الصورة إلى أي مستضيف صور (مثل Supabase Storage أو imgur) والحصول على رابط مباشر لها. سيظهر الشعار تلقائيا في رأس الفاتورة المطبوعة.

## 4) التشغيل محليا

لا حاجة لأي تثبيت — الملفات HTML/CSS/JS عادية. يكفي فتح `index.html` في المتصفح، أو تشغيل خادم محلي بسيط:

```bash
npx serve .
```

## 5) الرفع على Vercel

1. ارفع مجلد `zerough` إلى مستودع GitHub.
2. من [vercel.com](https://vercel.com) اختر **Add New Project** واستورد المستودع.
3. اترك إعدادات البناء فارغة (Static Site) — لا يحتاج المشروع أي خطوة Build.
4. اضغط Deploy، وسيصبح النظام متاحا برابط عام يعمل من أي جهاز مع مزامنة البيانات مباشرة عبر Supabase.

## ملاحظات

- عدد المنتجات يُخصم/يُضاف تلقائيا عند حفظ فاتورة بيع أو عملية شراء.
- رقم الفاتورة يُولَّد تلقائيا بصيغة `ZR-00001`.
- زر الطباعة في قسم الفواتير يطبع فاتورة رسمية تحتوي شعار وبيانات المؤسسة من الإعدادات.
- قسم التقارير يعتمد على الفترة الزمنية المختارة (من/إلى) ويشمل تصدير CSV.
