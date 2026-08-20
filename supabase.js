/* =========================================================
   supabase.js
   إعدادات الاتصال بقاعدة بيانات Supabase.
   هذا هو المكان الوحيد الذي يجب تعديل المفاتيح فيه.
   ========================================================= */

// رابط مشروع Supabase
const SUPABASE_URL = "https://mhbpryotyrqffcuwffpm.supabase.co";

// المفتاح العام (anon public key) — خذه من:
// Supabase Dashboard > Settings > API > Project API keys > anon public
// ⚠️ ضع المفتاح هنا فقط، وليس داخل index.html أو app.js
const SUPABASE_ANON_KEY = "sb_publishable_Wa1LMW_qaPqSezJMGmBEwQ_5cI1PASk";

// إنشاء عميل Supabase (يُستخدم في كل أنحاء التطبيق عبر window.db)
window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
