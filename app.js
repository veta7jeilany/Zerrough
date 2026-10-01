/* =========================================================
   app.js — مؤسسة زروق للخدمات المطبعية
   النسخة المحدّثة: تصنيف المبيعات، المنتجات المصنّعة ووصفاتها،
   المخزون بالمواد، الخسائر والتالف، الجرد، الموردون، العمال،
   تقرير الأرباح المفصّل، الصلاحيات (مدير/محاسب)، سجل العمليات.
   ========================================================= */

/* ---------- تخزين محلي مؤقت لنتائج القاعدة (Cache) ---------- */
const STATE = {
  customers: [], suppliers: [], employees: [],
  materials: [], products: [], productMaterials: [], productComponents: [],
  invoices: [], invoiceItems: [], customerPayments: [],
  purchases: [], purchaseItems: [], supplierPayments: [],
  expenses: [], losses: [], movements: [], auditLog: [],
  settings: null, salesChart: null,
  session: null, role: null, userEmail: null,
};

/* ================= أدوات مساعدة عامة ================= */
const qs  = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('ar-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmtDateAr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ar-MA', { year: 'numeric', month: 'short', day: 'numeric' });
}
function toast(message, type = '') {
  const el = qs('#toast');
  el.textContent = message;
  el.className = 'toast show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast ' + type; }, 3200);
}
function openModal(id) { qs('#' + id).classList.add('show'); }
function closeModal(id) { qs('#' + id).classList.remove('show'); }
qsa('.modal-close, [data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
qsa('.modal-backdrop').forEach(bd => bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('show'); }));

function exportCSV(filename, rows) {
  if (!rows.length) { toast('لا توجد بيانات لتصديرها', 'error'); return; }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')));
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* حساب متوسط التكلفة المرجّح بعد شراء دفعة جديدة */
function nextAvgCost(oldQty, oldAvg, addQty, addPrice) {
  const oq = Number(oldQty) || 0, oa = Number(oldAvg) || 0, aq = Number(addQty) || 0, ap = Number(addPrice) || 0;
  const totalQty = oq + aq;
  if (totalQty <= 0) return ap;
  return (oq * oa + aq * ap) / totalQty;
}

/* ================= الصلاحيات (عبر تسجيل الدخول الحقيقي بـ Supabase Auth) ================= */
function getRole() { return STATE.role || 'accountant'; }
function applyRoleUI() {
  const role = getRole();
  document.body.classList.toggle('accountant-mode', role === 'accountant');
  document.body.classList.toggle('manager-mode', role === 'manager');
  const label = role === 'manager' ? 'مدير' : 'محاسب';
  qsa('#rolePillTop, #rolePillSide').forEach(el => el.textContent = label);
  const roleLabelEl = qs('#currentRoleLabel');
  if (roleLabelEl) roleLabelEl.textContent = label;
  qsa('.user-email-display').forEach(el => el.textContent = STATE.userEmail || '');
}

/* حاجز حماية: يمنع أي عملية حذف إن لم يكن المستخدم مديرا (طبقة حماية إضافية،
   الحماية الحقيقية والملزِمة موجودة في سياسات RLS على مستوى قاعدة البيانات) */
function requireManager(actionLabel = 'هذه العملية') {
  if (getRole() !== 'manager') {
    toast(`${actionLabel} متاحة لحساب المدير فقط`, 'error');
    return false;
  }
  return true;
}

/* ================= سجل العمليات (Audit log) ================= */
async function logAudit(action, entity, label) {
  try {
    await window.db.from('audit_log').insert([{
      role: getRole(), user_email: STATE.userEmail || null, action, entity,
      entity_label: String(label || '').slice(0, 140),
    }]);
  } catch (e) { /* لا نعطّل العملية إن فشل تسجيل السجل */ }
}

/* =========================================================
   طبقة الوصول لقاعدة البيانات (Supabase) + تسجيل تلقائي
   ========================================================= */
const Api = {
  async list(table, orderCol = 'created_at', ascending = false, limit = null) {
    let q = window.db.from(table).select('*').order(orderCol, { ascending });
    if (limit) q = q.limit(limit);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async insert(table, row, label) {
    const { data, error } = await window.db.from(table).insert([row]).select().single();
    if (error) throw error;
    logAudit('إضافة', table, label || data?.name || data?.description || data?.invoice_number || '');
    return data;
  },
  async insertMany(table, rows, label) {
    const { data, error } = await window.db.from(table).insert(rows).select();
    if (error) throw error;
    if (rows.length) logAudit('إضافة', table, label || `(${rows.length} سجل)`);
    return data;
  },
  async update(table, id, patch, label) {
    const { data, error } = await window.db.from(table).update(patch).eq('id', id).select().single();
    if (error) throw error;
    logAudit('تعديل', table, label || data?.name || data?.description || data?.invoice_number || '');
    return data;
  },
  async remove(table, id, label) {
    const { error } = await window.db.from(table).delete().eq('id', id);
    if (error) throw error;
    logAudit('حذف', table, label || '');
  },
  async removeWhere(table, col, val) {
    const { error } = await window.db.from(table).delete().eq(col, val);
    if (error) throw error;
  },
};

/* حركة مخزون (دخول/خروج) */
async function logMovement(itemType, itemId, itemName, direction, quantity, reason, qtyBefore = null, qtyAfter = null) {
  try {
    await window.db.from('inventory_movements').insert([{
      item_type: itemType, item_id: itemId, item_name: itemName,
      direction, quantity, reason,
      quantity_before: qtyBefore, quantity_after: qtyAfter,
      movement_date: todayISO(),
    }]);
  } catch (e) { /* تجاهل فشل السجل، لا نعطّل العملية الأساسية */ }
}

/* ================= التنقل بين الأقسام ================= */
function goToSection(name) {
  qsa('.page').forEach(p => p.classList.remove('active'));
  qs('#sec-' + name).classList.add('active');
  qsa('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  closeSidebarMobile();
  if (name === 'reports') runReport();
}
qsa('.nav-item').forEach(btn => btn.addEventListener('click', () => goToSection(btn.dataset.section)));

function openSidebarMobile() { qs('#sidebar').classList.add('open'); qs('#sidebarOverlay').classList.add('show'); }
function closeSidebarMobile() { qs('#sidebar').classList.remove('open'); qs('#sidebarOverlay').classList.remove('show'); }
qs('#menuToggle').addEventListener('click', openSidebarMobile);
qs('#sidebarOverlay').addEventListener('click', closeSidebarMobile);

/* ================= التبويبات الفرعية ================= */
function initSubtabs() {
  qsa('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.subtabs');
      const page = btn.closest('.page');
      qsa('.subtab-btn', group).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      qsa('.subtab-panel', page).forEach(p => p.classList.remove('active'));
      const panel = qs('#panel-' + btn.dataset.subtab);
      if (panel) panel.classList.add('active');
    });
  });
}

/* =========================================================
   المصادقة (Supabase Auth) — بوابة دخول حقيقية بدل التبديل المحلي
   ========================================================= */
async function fetchUserRole(userId) {
  try {
    const { data, error } = await window.db.from('user_roles').select('role, full_name').eq('id', userId).single();
    if (error) throw error;
    return data;
  } catch (e) { return { role: 'accountant', full_name: null }; }
}

function showLoginGate(message) {
  document.body.classList.remove('authenticated');
  const err = qs('#loginError');
  if (err) err.textContent = message || '';
  const pw = qs('#loginPassword');
  if (pw) pw.value = '';
}
function hideLoginGate() { document.body.classList.add('authenticated'); }

async function bootAfterLogin(session) {
  const roleRow = await fetchUserRole(session.user.id);
  STATE.session = session;
  STATE.role = roleRow.role || 'accountant';
  STATE.userEmail = session.user.email;
  applyRoleUI();
  hideLoginGate();
  const loaderEl = qs('#loader'); if (loaderEl) loaderEl.classList.remove('hide');
  try {
    await loadAll();
  } catch (err) {
    console.error(err);
    toast('تعذر تحميل البيانات: تحقق من جداول قاعدة البيانات', 'error');
  } finally {
    const le = qs('#loader'); if (le) le.classList.add('hide');
  }
}

async function doLogout() {
  try { await window.db.auth.signOut(); } catch (e) { /* تجاهل */ }
  STATE.session = null; STATE.role = null; STATE.userEmail = null;
  showLoginGate();
}

qs('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = qs('#loginEmail').value.trim();
  const password = qs('#loginPassword').value;
  const btn = qs('#btnLoginSubmit');
  qs('#loginError').textContent = '';
  btn.disabled = true; btn.textContent = 'جاري الدخول…';
  try {
    const { data, error } = await window.db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await bootAfterLogin(data.session);
  } catch (err) {
    qs('#loginError').textContent = 'فشل تسجيل الدخول — تحقق من البريد الإلكتروني وكلمة المرور';
  } finally {
    btn.disabled = false; btn.textContent = 'دخول';
  }
});

qsa('#btnLogout, #btnLogoutSettings').forEach(btn => {
  if (btn) btn.addEventListener('click', doLogout);
});

/* هذا السطر يعمل فور تحميل الملف، قبل أي شيء آخر — إن لم تكن مكتبة Supabase قد
   حُمّلت بعد (شبكة بطيئة، حاجب إعلانات، تعارض مؤقت) كان سابقاً يُسقط تنفيذ الملف
   بأكمله بصمت فتبقى شاشة "جاري التحميل" عالقة للأبد دون أي رسالة خطأ. الآن محمي. */
if (window.db && window.db.auth) {
  window.db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      STATE.session = null; STATE.role = null; STATE.userEmail = null;
      showLoginGate();
    }
  });
} else {
  console.error('تعذر الاتصال بقاعدة البيانات: window.db غير معرّف (تحقق من تحميل مكتبة Supabase وملف supabase.js)');
}

/* =========================================================
   تحميل كل البيانات عند بدء التشغيل
   ========================================================= */
async function loadAll() {
  const [customers, suppliers, employees, materials, products, productMaterials, productComponents,
    invoices, invoiceItems, customerPayments, purchases, purchaseItems, supplierPayments,
    expenses, losses, movements, auditLog, settingsRows] = await Promise.all([
    Api.list('customers', 'name', true),
    Api.list('suppliers', 'name', true),
    Api.list('employees', 'name', true),
    Api.list('materials', 'name', true),
    Api.list('products', 'name', true),
    Api.list('product_materials', 'id', true),
    Api.list('product_components', 'id', true),
    Api.list('invoices', 'invoice_date', false),
    Api.list('invoice_items', 'id', true),
    Api.list('customer_payments', 'payment_date', false),
    Api.list('purchases', 'purchase_date', false),
    Api.list('purchase_items', 'id', true),
    Api.list('supplier_payments', 'payment_date', false),
    Api.list('expenses', 'expense_date', false),
    Api.list('inventory_losses', 'loss_date', false),
    Api.list('inventory_movements', 'created_at', false, 400),
    Api.list('audit_log', 'created_at', false, 60),
    window.db.from('settings').select('*').limit(1),
  ]);
  Object.assign(STATE, {
    customers, suppliers, employees, materials, products, productMaterials, productComponents,
    invoices, invoiceItems, customerPayments, purchases, purchaseItems, supplierPayments,
    expenses, losses, movements, auditLog,
    settings: (settingsRows.data && settingsRows.data[0]) || null,
  });

  renderDashboard();
  renderInvoices();
  renderManufactured();
  renderSimple();
  renderComposite();
  renderMaterials();
  renderMovements();
  renderLosses();
  renderAdjustments();
  renderPurchases();
  renderExpenses();
  renderEmployees();
  renderCustomers();
  renderSuppliers();
  renderSettings();
  renderAuditLog();
  fillDatalists();
}

/* =========================================================
   حسابات مشتركة (أرصدة، تكاليف)
   ========================================================= */
function customerBalance(customerId) {
  const invoiced = activeInvoices().filter(i => i.customer_id === customerId).reduce((s, i) => s + Number(i.total || 0), 0);
  const paid = STATE.customerPayments.filter(p => p.customer_id === customerId).reduce((s, p) => s + Number(p.amount || 0), 0);
  return { invoiced, paid, remaining: invoiced - paid };
}
function supplierBalance(supplierId) {
  const purchased = activePurchases().filter(p => p.supplier_id === supplierId).reduce((s, p) => s + Number(p.total || 0), 0);
  const paid = STATE.supplierPayments.filter(p => p.supplier_id === supplierId).reduce((s, p) => s + Number(p.amount || 0), 0);
  return { purchased, paid, remaining: purchased - paid };
}
function invoicePaid(invoiceId) {
  return STATE.customerPayments.filter(p => p.invoice_id === invoiceId).reduce((s, p) => s + Number(p.amount || 0), 0);
}
function purchasePaid(purchaseId) {
  return STATE.supplierPayments.filter(p => p.purchase_id === purchaseId).reduce((s, p) => s + Number(p.amount || 0), 0);
}
/* حالة الفاتورة: مدفوعة بالكامل / مدفوعة جزئيا / غير مدفوعة */
function invoiceStatusInfo(invoice) {
  const total = Number(invoice.total || 0);
  const paid = invoicePaid(invoice.id);
  if (paid <= 0) return { label: 'غير مدفوعة', cls: 'badge-status-unpaid' };
  if (paid >= total - 0.009) return { label: 'مدفوعة بالكامل', cls: 'badge-status-paid' };
  return { label: 'مدفوعة جزئيا', cls: 'badge-status-partial' };
}

/* السجلات "النشطة" فقط (غير الملغاة) — تُستخدم في كل الحسابات المالية والتقارير،
   بينما تبقى السجلات الملغاة ظاهرة في الجداول للمراجعة فقط ولا تدخل في أي مجموع */
function activeInvoices() { return STATE.invoices.filter(i => !i.is_cancelled); }
function activePurchases() { return STATE.purchases.filter(p => !p.is_cancelled); }
function activeExpenses() { return STATE.expenses.filter(e => !e.is_cancelled); }

/* ---------- فترة لوحة التحكم ---------- */
let DASH_PERIOD = 'today';
function dashPeriodRange() {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (DASH_PERIOD === 'today') { const d = iso(now); return { from: d, to: d }; }
  if (DASH_PERIOD === 'week') {
    const day = now.getDay(); // 0 = الأحد
    const start = new Date(now); start.setDate(now.getDate() - day);
    return { from: iso(start), to: iso(now) };
  }
  if (DASH_PERIOD === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: iso(start), to: iso(now) };
  }
  if (DASH_PERIOD === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: iso(start), to: iso(now) };
  }
  if (DASH_PERIOD === 'custom') {
    return { from: qs('#dashFrom').value || null, to: qs('#dashTo').value || null };
  }
  return { from: null, to: null }; // كل الفترات
}
qsa('#dashPeriodTabs .period-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    qsa('#dashPeriodTabs .period-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    DASH_PERIOD = btn.dataset.period;
    const isCustom = DASH_PERIOD === 'custom';
    qs('#dashFrom').style.display = isCustom ? '' : 'none';
    qs('#dashRangeSep').style.display = isCustom ? '' : 'none';
    qs('#dashTo').style.display = isCustom ? '' : 'none';
    if (!isCustom || (qs('#dashFrom').value && qs('#dashTo').value)) renderDashboard();
  });
});
qs('#dashFrom').addEventListener('change', () => { if (DASH_PERIOD === 'custom') renderDashboard(); });
qs('#dashTo').addEventListener('change', () => { if (DASH_PERIOD === 'custom') renderDashboard(); });

/* تكلفة الوحدة التقديرية لمنتج مصنّع بناءً على وصفته الحالية */
function manufacturedUnitCost(productId) {
  const bom = STATE.productMaterials.filter(pm => pm.product_id === productId);
  let cost = 0;
  bom.forEach(row => {
    const mat = STATE.materials.find(m => m.id === row.material_id);
    if (mat) cost += Number(row.qty_per_unit || 0) * Number(mat.avg_cost || 0);
  });
  return cost;
}

/* =========================================================
   المنتجات المركبة (الأطقم) — نظام عام تكراري
   ========================================================= */
/* تكلفة وحدة من أي منتج، بغض النظر عن نوعه (تكرارية للمركبات) */
function productUnitCost(product, visited = new Set()) {
  if (!product) return 0;
  if (product.type === 'manufactured') return manufacturedUnitCost(product.id);
  if (product.type === 'simple') return Number(product.buy_price) || 0;
  if (product.type === 'service') return Number(product.cost_price) || 0;
  if (product.type === 'composite') {
    if (visited.has(product.id)) return 0; // حماية من الحلقات المغلقة
    const next = new Set(visited); next.add(product.id);
    return STATE.productComponents
      .filter(c => c.parent_product_id === product.id)
      .reduce((sum, c) => {
        const child = STATE.products.find(p => p.id === c.component_product_id);
        return sum + productUnitCost(child, next) * Number(c.quantity || 0);
      }, 0);
  }
  return 0;
}
function compositeUnitCost(productId) {
  return productUnitCost(STATE.products.find(p => p.id === productId));
}

/* تفكيك منتج (بكمية معينة) إلى قائمة "أوراق" نهائية: مواد خام أو منتجات جاهزة يجب خصمها من المخزون.
   المنتج المركب يُفكَّك تكراريا إلى مكوناته، والمصنّع إلى مواده، والجاهز يُخصم من كميته، والخدمة لا شيء. */
function expandProductToLeaves(product, qty, visited = new Set(), out = []) {
  if (!product || qty <= 0) return out;
  if (product.type === 'manufactured') {
    STATE.productMaterials.filter(pm => pm.product_id === product.id).forEach(b => {
      const mat = STATE.materials.find(m => m.id === b.material_id);
      if (mat) out.push({ kind: 'material', item: mat, qty: Number(b.qty_per_unit || 0) * qty, via: product.name });
    });
  } else if (product.type === 'simple') {
    out.push({ kind: 'product', item: product, qty, via: product.name });
  } else if (product.type === 'composite') {
    if (visited.has(product.id)) return out; // حماية من الحلقات المغلقة
    const next = new Set(visited); next.add(product.id);
    STATE.productComponents.filter(c => c.parent_product_id === product.id).forEach(c => {
      const child = STATE.products.find(p => p.id === c.component_product_id);
      expandProductToLeaves(child, Number(c.quantity || 0) * qty, next, out);
    });
  }
  return out;
}

/* هل إضافة componentId كمكوّن لـ parentId ستُنشئ حلقة مغلقة (منتج يحتوي نفسه مباشرة أو بشكل غير مباشر)؟ */
function wouldCreateCycle(parentId, componentId, pendingComponents = null) {
  if (parentId === componentId) return true;
  const stack = [componentId];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (current === parentId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const children = (current === parentId && pendingComponents)
      ? pendingComponents
      : STATE.productComponents.filter(c => c.parent_product_id === current).map(c => c.component_product_id);
    children.forEach(ch => stack.push(ch));
  }
  return false;
}

/* دمج الأوراق المتكررة (نفس المادة/المنتج) في سطر واحد */
function aggregateLeaves(leaves) {
  const map = new Map();
  leaves.forEach(l => {
    const key = l.kind + ':' + l.item.id;
    const cur = map.get(key) || { kind: l.kind, item: l.item, qty: 0, via: new Set() };
    cur.qty += l.qty; cur.via.add(l.via);
    map.set(key, cur);
  });
  return [...map.values()];
}

/* التوفر الكافي للمنتجات الجاهزة (restoreLeaves: كميات ستُعاد قبل الخصم، عند تعديل فاتورة) */
function findShortage(leaves, restoreLeaves = []) {
  const restoreMap = {};
  aggregateLeaves(restoreLeaves).filter(l => l.kind === 'product').forEach(l => { restoreMap[l.item.id] = l.qty; });
  for (const l of aggregateLeaves(leaves)) {
    if (l.kind !== 'product') continue;
    const p = STATE.products.find(x => x.id === l.item.id);
    if (p && Number(p.quantity) + (restoreMap[p.id] || 0) < l.qty) return p.name;
  }
  return null;
}

/* تطبيق الخصم ('out') أو الاسترجاع ('in') على المخزون */
async function applyStockChange(leaves, direction, reasonPrefix) {
  const sign = direction === 'out' ? -1 : 1;
  for (const l of aggregateLeaves(leaves)) {
    const reason = reasonPrefix + ': ' + [...l.via].join('، ');
    if (l.kind === 'material') {
      const mat = STATE.materials.find(m => m.id === l.item.id);
      if (!mat) continue;
      const updated = await Api.update('materials', mat.id, { quantity: Number(mat.quantity) + sign * l.qty });
      STATE.materials = STATE.materials.map(m => m.id === mat.id ? updated : m);
      logMovement('material', mat.id, mat.name, direction, l.qty, reason);
    } else {
      const p = STATE.products.find(x => x.id === l.item.id);
      if (!p) continue;
      const updated = await Api.update('products', p.id, { quantity: Number(p.quantity) + sign * l.qty });
      STATE.products = STATE.products.map(x => x.id === p.id ? updated : x);
      logMovement('product', p.id, p.name, direction, l.qty, reason);
    }
  }
}

/* أوراق أصناف فاتورة (لأي مجموعة أصناف) */
function leavesOfItems(items) {
  const out = [];
  items.forEach(it => {
    const p = STATE.products.find(x => x.id === it.product_id);
    expandProductToLeaves(p, Number(it.quantity || 0), new Set(), out);
  });
  return out;
}
function inventoryValueTotal() {
  const matValue = STATE.materials.reduce((s, m) => s + Number(m.quantity || 0) * Number(m.avg_cost || 0), 0);
  const prodValue = STATE.products.filter(p => p.type === 'simple').reduce((s, p) => s + Number(p.quantity || 0) * Number(p.buy_price || 0), 0);
  return matValue + prodValue;
}

/* =========================================================
   لوحة التحكم
   ========================================================= */
function renderDashboard() {
  const { from, to } = dashPeriodRange();
  const inRange = (d) => d && (!from || d >= from) && (!to || d <= to);

  const activeInv = activeInvoices().filter(i => inRange(i.invoice_date));
  const activeInvIds = new Set(activeInv.map(i => i.id));
  const totalSales = activeInv.reduce((s, i) => s + Number(i.total || 0), 0);
  const totalCOGS = STATE.invoiceItems.filter(it => activeInvIds.has(it.invoice_id)).reduce((s, it) => s + Number(it.cost_price || 0) * Number(it.quantity || 0), 0);
  const grossProfit = totalSales - totalCOGS;
  const totalExpenses = activeExpenses().filter(e => inRange(e.expense_date)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalLosses = STATE.losses.filter(l => inRange(l.loss_date)).reduce((s, l) => s + Number(l.total_cost || 0), 0);
  const netProfit = grossProfit - totalExpenses - totalLosses;
  const customerDebt = STATE.customers.reduce((s, c) => s + customerBalance(c.id).remaining, 0);
  const supplierDebt = STATE.suppliers.reduce((s, sp) => s + supplierBalance(sp.id).remaining, 0);

  qs('#statSales').textContent = money(totalSales);
  qs('#statCOGS').textContent = money(totalCOGS);
  qs('#statExpenses').textContent = money(totalExpenses);
  qs('#statLosses').textContent = money(totalLosses);
  qs('#statNetProfit').textContent = money(netProfit);
  qs('#statCustomerDebt').textContent = money(customerDebt);
  qs('#statSupplierDebt').textContent = money(supplierDebt);
  qs('#statInventoryValue').textContent = money(inventoryValueTotal());
  qs('#todayDate').textContent = new Date().toLocaleDateString('ar-MA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const recent = activeInv.slice(0, 6);
  qs('#recentInvoices').innerHTML = recent.length ? recent.map(inv => `
    <div class="mini-row">
      <div><div class="mini-row-title">${inv.customer_name || 'عميل غير محدد'}</div><div class="mini-row-sub">#${inv.invoice_number} · ${fmtDateAr(inv.invoice_date)}</div></div>
      <div class="mini-row-value">${money(inv.total)} أ.م</div>
    </div>`).join('') : `<p class="mini-empty">لا توجد فواتير بعد</p>`;

  const lowMat = STATE.materials.filter(m => Number(m.quantity) <= 5);
  const lowProd = STATE.products.filter(p => p.type === 'simple' && Number(p.quantity) <= 3);
  const alerts = [...lowMat.map(m => ({ name: m.name, qty: m.quantity, unit: m.unit })), ...lowProd.map(p => ({ name: p.name, qty: p.quantity, unit: 'قطعة' }))];
  qs('#lowStockAlerts').innerHTML = alerts.length ? alerts.slice(0, 8).map(a => `
    <div class="mini-row"><div class="mini-row-title">${a.name}</div><div class="mini-row-value text-danger">${a.qty} ${a.unit}</div></div>
  `).join('') : `<p class="mini-empty">لا توجد تنبيهات مخزون حاليا</p>`;

  // الربح حسب نوع البيع خلال الفترة المختارة
  const byCat = { 'جملة': { sales: 0, cost: 0 }, 'فردي': { sales: 0, cost: 0 }, 'عادي': { sales: 0, cost: 0 } };
  STATE.invoiceItems.forEach(it => {
    const inv = activeInv.find(i => i.id === it.invoice_id);
    if (!inv) return;
    const cat = byCat[it.category] ? it.category : 'عادي';
    byCat[cat].sales += Number(it.price || 0) * Number(it.quantity || 0);
    byCat[cat].cost += Number(it.cost_price || 0) * Number(it.quantity || 0);
  });
  const catRows = Object.entries(byCat).filter(([, v]) => v.sales > 0);
  qs('#dashCategoryProfit').innerHTML = catRows.length ? catRows.map(([cat, v]) => `
    <div class="mini-row"><div class="mini-row-title">${cat}</div><div class="mini-row-value">${money(v.sales - v.cost)} أ.م</div></div>
  `).join('') : '';
  qs('#dashCategoryEmpty').style.display = catRows.length ? 'none' : 'block';

  renderSalesChart();
}

function renderSalesChart() {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('ar-MA', { month: 'short' }), total: 0 });
  }
  activeInvoices().forEach(inv => {
    if (!inv.invoice_date) return;
    const d = new Date(inv.invoice_date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const m = months.find(m => m.key === key);
    if (m) m.total += Number(inv.total || 0);
  });
  const ctx = qs('#salesChart').getContext('2d');
  if (STATE.salesChart) STATE.salesChart.destroy();
  STATE.salesChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: months.map(m => m.label), datasets: [{ label: 'المبيعات', data: months.map(m => m.total), backgroundColor: '#33529e', borderRadius: 5, maxBarThickness: 26 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#eee9dc' }, beginAtZero: true } } },
  });
}

/* =========================================================
   المبيعات والفواتير
   ========================================================= */
function invoiceCategoriesSet(invoiceId) {
  return new Set(STATE.invoiceItems.filter(it => it.invoice_id === invoiceId).map(it => it.category));
}

function renderInvoices() {
  const term = qs('#invoiceSearch').value.trim().toLowerCase();
  const cat = qs('#invoiceFilterCategory').value;
  const from = qs('#invoiceFilterFrom').value;
  const to = qs('#invoiceFilterTo').value;

  let rows = STATE.invoices.filter(i =>
    (!term || i.invoice_number?.toLowerCase().includes(term) || i.customer_name?.toLowerCase().includes(term)) &&
    (!from || i.invoice_date >= from) && (!to || i.invoice_date <= to) &&
    (!cat || invoiceCategoriesSet(i.id).has(cat))
  );

  qs('#invoicesEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#invoicesTableBody').innerHTML = rows.map(i => {
    const paid = invoicePaid(i.id);
    const remaining = Number(i.total || 0) - paid;
    const status = i.is_cancelled ? { label: 'ملغاة', cls: 'badge-status-unpaid' } : invoiceStatusInfo(i);
    return `
    <tr class="${i.is_cancelled ? 'row-cancelled' : ''}">
      <td class="cell-strong">${i.invoice_number}</td>
      <td>${i.customer_name || '—'}</td>
      <td>${fmtDateAr(i.invoice_date)}</td>
      <td>${money(i.total)} أ.م</td>
      <td class="text-success">${money(paid)}</td>
      <td class="${remaining > 0 ? 'text-danger' : ''}">${money(remaining)}</td>
      <td><span class="badge ${status.cls}">${status.label}</span></td>
      <td class="row-actions">
        <button class="btn-text" onclick="printInvoice('${i.id}')">طباعة</button>
        ${i.is_cancelled ? '' : `<button class="btn-text" onclick="editInvoice('${i.id}')">تعديل</button>
        <button class="btn-text" onclick="openPaymentModal('invoice','${i.id}','تسجيل دفعة على الفاتورة #${i.invoice_number}')">دفعة</button>
        <button class="btn-text danger" onclick="deleteInvoice('${i.id}')">إلغاء</button>`}
        <button class="btn-text danger" onclick="deleteInvoiceForever('${i.id}')">حذف نهائي</button>
      </td>
    </tr>`;
  }).join('');
}
['invoiceSearch', 'invoiceFilterCategory', 'invoiceFilterFrom', 'invoiceFilterTo'].forEach(id => qs('#' + id).addEventListener('input', renderInvoices));

window.deleteInvoice = async function (id) {
  if (!requireManager('إلغاء الفواتير')) return;
  const inv = STATE.invoices.find(i => i.id === id);
  if (inv && inv.is_cancelled) { toast('هذه الفاتورة ملغاة أصلا', 'error'); return; }
  if (!confirm('هل تريد إلغاء هذه الفاتورة؟ ستبقى محفوظة للمراجعة، ولن تُحتسب ضمن المبيعات والأرباح، وسيُعاد المخزون المستهلك.')) return;
  try {
    const patch = { is_cancelled: true, cancelled_at: new Date().toISOString(), cancelled_by: STATE.userEmail || null };
    const updated = await Api.update('invoices', id, patch, 'إلغاء فاتورة #' + (inv ? inv.invoice_number : id));
    STATE.invoices = STATE.invoices.map(i => i.id === id ? updated : i);
    await applyStockChange(leavesOfItems(STATE.invoiceItems.filter(it => it.invoice_id === id)), 'in', 'إلغاء فاتورة #' + (inv ? inv.invoice_number : ''));
    renderInvoices(); renderDashboard(); renderCustomers(); renderMaterials(); renderSimple(); renderMovements();
    toast('تم إلغاء الفاتورة وإعادة المخزون', 'success');
  } catch (err) { toast('تعذر الإلغاء: ' + err.message, 'error'); }
};

window.deleteInvoiceForever = async function (id) {
  if (!requireManager('الحذف النهائي للفواتير')) return;
  const inv = STATE.invoices.find(i => i.id === id);
  if (!inv) return;
  const paidAmt = invoicePaid(id);
  const warn = paidAmt > 0 ? `\n\nتنبيه: على هذه الفاتورة دفعات مسجّلة بقيمة ${money(paidAmt)} أوقية، وستُحذف معها نهائياً.` : '';
  if (!confirm(`حذف نهائي لفاتورة رقم ${inv.invoice_number} — لا يمكن التراجع عن هذا الإجراء ولن تبقى أي أثر لها في السجلات أو التقارير.${warn}\n\nهل أنت متأكد؟`)) return;
  try {
    if (!inv.is_cancelled) {
      await applyStockChange(leavesOfItems(STATE.invoiceItems.filter(it => it.invoice_id === id)), 'in', 'حذف نهائي لفاتورة #' + inv.invoice_number);
    }
    await Api.removeWhere('customer_payments', 'invoice_id', id);
    await Api.removeWhere('invoice_items', 'invoice_id', id);
    await Api.remove('invoices', id, 'حذف نهائي لفاتورة #' + inv.invoice_number);
    STATE.customerPayments = STATE.customerPayments.filter(p => p.invoice_id !== id);
    STATE.invoiceItems = STATE.invoiceItems.filter(it => it.invoice_id !== id);
    STATE.invoices = STATE.invoices.filter(i => i.id !== id);
    renderInvoices(); renderDashboard(); renderCustomers(); renderMaterials(); renderSimple(); renderMovements();
    toast('تم حذف الفاتورة نهائياً', 'success');
  } catch (err) { toast(friendlyDeleteError(err), 'error'); }
};

function categoryBadge(cat) {
  const cls = cat === 'جملة' ? 'badge-wholesale' : cat === 'فردي' ? 'badge-individual' : 'badge-regular';
  return `<span class="badge ${cls}">${cat}</span>`;
}

function productOptionsForSale() {
  const typeLabel = { manufactured: 'مصنّع', service: 'خدمة', composite: 'مركب', simple: 'جاهز' };
  return `<option value="">اختر منتج/خدمة…</option>` + STATE.products.map(p =>
    `<option value="${p.id}" data-price="${p.sell_price}" data-category="${p.category}">${p.name} (${typeLabel[p.type] || 'جاهز'})</option>`
  ).join('');
}

function addInvoiceRow() {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select class="inv-item-product">${productOptionsForSale()}</select></td>
    <td><select class="inv-item-category"><option value="جملة">جملة</option><option value="فردي">فردي</option><option value="عادي" selected>عادي</option></select></td>
    <td><input type="number" class="inv-item-qty" min="0.01" step="0.01" value="1"></td>
    <td><input type="number" class="inv-item-price" min="0" step="0.01" value="0"></td>
    <td class="line-total">0.00</td>
    <td><button type="button" class="row-remove">✕</button></td>`;
  qs('#invoiceItemsBody').appendChild(tr);
  const sel = tr.querySelector('.inv-item-product'), catSel = tr.querySelector('.inv-item-category');
  const qty = tr.querySelector('.inv-item-qty'), price = tr.querySelector('.inv-item-price');
  sel.addEventListener('change', () => {
    const opt = sel.selectedOptions[0];
    price.value = opt?.dataset.price || 0;
    if (opt?.dataset.category) catSel.value = opt.dataset.category;
    updateInvoiceRowTotal(tr);
  });
  [qty, price].forEach(inp => inp.addEventListener('input', () => updateInvoiceRowTotal(tr)));
  tr.querySelector('.row-remove').addEventListener('click', () => { tr.remove(); updateInvoiceGrandTotal(); });
}
function updateInvoiceRowTotal(tr) {
  const qty = Number(tr.querySelector('.inv-item-qty').value) || 0;
  const price = Number(tr.querySelector('.inv-item-price').value) || 0;
  tr.querySelector('.line-total').textContent = money(qty * price);
  updateInvoiceGrandTotal();
}
function updateInvoiceGrandTotal() {
  let total = 0;
  qsa('#invoiceItemsBody tr').forEach(tr => {
    total += (Number(tr.querySelector('.inv-item-qty').value) || 0) * (Number(tr.querySelector('.inv-item-price').value) || 0);
  });
  qs('#invoiceGrandTotal').textContent = money(total) + ' أوقية';
  return total;
}
qs('#btnAddInvoiceRow').addEventListener('click', addInvoiceRow);

let editingInvoiceId = null;

qs('#btnNewInvoice').addEventListener('click', () => {
  editingInvoiceId = null;
  qs('#invoiceModalTitle').textContent = 'فاتورة بيع جديدة';
  qs('#btnSaveInvoice').textContent = 'حفظ الفاتورة';
  qs('#invEditHint').style.display = 'none';
  qs('#invPaidNowField').style.display = '';
  qs('#invCustomerName').value = '';
  qs('#invDate').value = todayISO();
  qs('#invNumber').value = 'ZR-' + String(STATE.invoices.length + 1).padStart(5, '0');
  qs('#invPaidNow').value = 0;
  qs('#invoiceItemsBody').innerHTML = '';
  addInvoiceRow();
  updateInvoiceGrandTotal();
  openModal('modalInvoice');
});

window.editInvoice = function (id) {
  const inv = STATE.invoices.find(i => i.id === id);
  if (!inv) return;
  if (inv.is_cancelled) { toast('لا يمكن تعديل فاتورة ملغاة', 'error'); return; }

  editingInvoiceId = id;
  qs('#invoiceModalTitle').textContent = 'تعديل الفاتورة #' + inv.invoice_number;
  qs('#btnSaveInvoice').textContent = 'حفظ التعديلات';
  qs('#invEditHint').style.display = '';
  qs('#invPaidNowField').style.display = 'none';
  qs('#invPaidNow').value = 0;

  qs('#invCustomerName').value = inv.customer_name || '';
  qs('#invDate').value = inv.invoice_date || todayISO();
  qs('#invNumber').value = inv.invoice_number;

  qs('#invoiceItemsBody').innerHTML = '';
  const items = STATE.invoiceItems.filter(it => it.invoice_id === id);
  if (items.length) {
    items.forEach(it => {
      addInvoiceRow();
      const tr = qs('#invoiceItemsBody').lastElementChild;
      tr.querySelector('.inv-item-product').value = it.product_id;
      tr.querySelector('.inv-item-category').value = it.category || 'عادي';
      tr.querySelector('.inv-item-qty').value = it.quantity;
      tr.querySelector('.inv-item-price').value = it.price;
      updateInvoiceRowTotal(tr);
    });
  } else {
    addInvoiceRow();
  }
  updateInvoiceGrandTotal();
  openModal('modalInvoice');
};

qs('#btnSaveInvoice').addEventListener('click', async () => {
  const isEdit = !!editingInvoiceId;
  const customerName = qs('#invCustomerName').value.trim();
  const date = qs('#invDate').value || todayISO();
  const number = qs('#invNumber').value;
  const paidNow = isEdit ? 0 : (Number(qs('#invPaidNow').value) || 0);
  const rows = qsa('#invoiceItemsBody tr').map(tr => ({
    product_id: tr.querySelector('.inv-item-product').value,
    category: tr.querySelector('.inv-item-category').value,
    quantity: Number(tr.querySelector('.inv-item-qty').value) || 0,
    price: Number(tr.querySelector('.inv-item-price').value) || 0,
  })).filter(r => r.product_id && r.quantity > 0);

  if (!customerName) { toast('اكتب اسم العميل', 'error'); return; }
  if (!rows.length) { toast('أضف صنفا واحدا على الأقل', 'error'); return; }

  const itemsPayload = rows.map(r => {
    const p = STATE.products.find(p => p.id === r.product_id);
    return { ...r, product: p, cost_price: productUnitCost(p), total: r.quantity * r.price };
  });

  // تحقق من توفر المخزون (يشمل مكونات المنتجات المركبة). عند التعديل تُحتسب الكميات القديمة كمُعادة مسبقا
  const newLeaves = leavesOfItems(rows);
  const oldItemsForCheck = isEdit ? STATE.invoiceItems.filter(it => it.invoice_id === editingInvoiceId) : [];
  const shortage = findShortage(newLeaves, leavesOfItems(oldItemsForCheck));
  if (shortage) { toast(`الكمية غير كافية من: ${shortage}`, 'error'); return; }
  const total = itemsPayload.reduce((s, r) => s + r.total, 0);

  if (!isEdit && paidNow > total) {
    toast('المبلغ المدفوع أكبر من إجمالي الفاتورة — تحقق من الرقم', 'error');
    return;
  }
  if (isEdit) {
    const paidAlready = invoicePaid(editingInvoiceId);
    if (total < paidAlready - 0.009) {
      toast(`لا يمكن أن يكون إجمالي الفاتورة أقل من المبلغ المدفوع سلفا (${money(paidAlready)} أ.م)`, 'error');
      return;
    }
  }

  try {
    let customer = STATE.customers.find(c => c.name === customerName);
    if (!customer) {
      customer = await Api.insert('customers', { name: customerName, phone: '' }, customerName);
      STATE.customers.push(customer);
      STATE.customers.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }

    // عند التعديل: نعيد أولا المخزون المستهلك من النسخة القديمة، ثم نحذف أصنافها القديمة
    if (isEdit) {
      await applyStockChange(leavesOfItems(oldItemsForCheck), 'in', 'تعديل فاتورة (استرجاع)');
      await Api.removeWhere('invoice_items', 'invoice_id', editingInvoiceId);
      STATE.invoiceItems = STATE.invoiceItems.filter(it => it.invoice_id !== editingInvoiceId);
    }

    let invoice;
    if (isEdit) {
      invoice = await Api.update('invoices', editingInvoiceId, {
        invoice_number: number, customer_id: customer.id, customer_name: customerName, invoice_date: date, total,
      }, 'تعديل فاتورة #' + number);
      STATE.invoices = STATE.invoices.map(i => i.id === editingInvoiceId ? invoice : i);
    } else {
      invoice = await Api.insert('invoices', {
        invoice_number: number, customer_id: customer.id, customer_name: customerName, invoice_date: date, total,
      }, number);
      STATE.invoices.unshift(invoice);
    }

    const itemRows = itemsPayload.map(r => ({
      invoice_id: invoice.id, product_id: r.product_id, product_name: r.product.name, category: r.category,
      quantity: r.quantity, price: r.price, cost_price: r.cost_price, total: r.total,
    }));
    await Api.insertMany('invoice_items', itemRows, 'أصناف فاتورة #' + number);
    STATE.invoiceItems.push(...itemRows);

    // خصم المخزون (النسخة النهائية من الأصناف) — يفكّك المنتجات المركبة تلقائيا إلى مكوناتها ثم موادها
    await applyStockChange(newLeaves, 'out', isEdit ? 'تعديل فاتورة' : 'بيع');

    if (!isEdit && paidNow > 0) {
      const pay = await Api.insert('customer_payments', { customer_id: customer.id, invoice_id: invoice.id, amount: paidNow, payment_date: date, note: 'دفعة عند إنشاء الفاتورة' }, 'دفعة عميل');
      STATE.customerPayments.push(pay);
    }

    renderInvoices(); renderDashboard(); renderManufactured(); renderSimple(); renderComposite(); renderMaterials(); renderMovements(); renderCustomers();
    closeModal('modalInvoice');
    editingInvoiceId = null;
    toast(isEdit ? 'تم حفظ تعديلات الفاتورة' : 'تم حفظ الفاتورة بنجاح', 'success');
  } catch (err) { toast('خطأ أثناء الحفظ: ' + err.message, 'error'); }
});

/* شعار المؤسسة مضمّن داخل الملف مباشرة (Base64) — لا يحتاج رفع ملف صورة منفصل،
   ويظهر بنفس الجودة في كل الأجهزة دون اعتماد على مسار خارجي */
const ZAROUQ_LOGO_B64 = "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";

/* حالة الدفع بشكل شارة ملوّنة تُستخدم في نسخة الطباعة */
function invoicePrintStatusBadge(inv) {
  if (inv.is_cancelled) return { label: 'ملغاة', bg: '#8a8f98' };
  const info = invoiceStatusInfo(inv);
  if (info.cls === 'badge-status-paid')    return { label: info.label, bg: '#1a7f37' };
  if (info.cls === 'badge-status-partial') return { label: info.label, bg: '#c98a13' };
  return { label: info.label, bg: '#c0392b' };
}

window.printInvoice = async function (invoiceId) {
  const inv = STATE.invoices.find(i => i.id === invoiceId);
  if (!inv) return;

  /* نفتح النافذة فوراً (داخل حدث النقر) حتى لا يحجبها المتصفح، ثم نكمل التحضير */
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) { toast('يرجى السماح بالنوافذ المنبثقة لهذا الموقع لطباعة الفاتورة', 'error'); return; }
  try { win.document.write('<body dir="rtl" style="font-family:sans-serif;padding:24px;color:#555">جارٍ تجهيز الفاتورة…</body>'); } catch (e) {}

  const items = STATE.invoiceItems.filter(it => it.invoice_id === invoiceId);
  const paidAmt = invoicePaid(invoiceId);
  const remainingAmt = Number(inv.total || 0) - paidAmt;
  const badge = invoicePrintStatusBadge(inv);
  const badgeIcon = badge.bg === '#1a7f37' ? 'fa-check-circle' : (badge.bg === '#8a8f98' ? 'fa-ban' : 'fa-hourglass-half');
  const s = STATE.settings || {};
  const customer = STATE.customers.find(c => c.name === inv.customer_name);
  const customerPhone = customer && customer.phone ? customer.phone : '';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const delay = ms => new Promise(r => setTimeout(r, ms));

  /* ---- الشعار: نتحقق من الرابط في الصفحة الرئيسية قبل الكتابة في نافذة الطباعة ---- */
  const fallbackLogo = 'data:image/png;base64,' + ZAROUQ_LOGO_B64;
  const logoSrc = await new Promise(resolve => {
    const url = (s.logo_url || '').trim();
    if (!url) return resolve(fallbackLogo);
    const probe = new Image();
    const timer = setTimeout(() => resolve(fallbackLogo), 4000);
    probe.onload = () => { clearTimeout(timer); resolve(probe.naturalWidth ? url : fallbackLogo); };
    probe.onerror = () => { clearTimeout(timer); resolve(fallbackLogo); };
    probe.src = url;
  });

  const rowsHtml = items.map((it, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td class="desc">${esc(it.product_name)}</td>
      <td>${fmtQty(it.quantity)}</td>
      <td>${money(it.price)}</td>
      <td>${money(it.total)}</td>
    </tr>`).join('');

  const tagline  = s.tagline  ? esc(s.tagline)  : 'طباعة رقمية &nbsp;•&nbsp; ملابس التخرج &nbsp;•&nbsp; دروع التكريم';
  const tagline2 = s.tagline2 ? esc(s.tagline2) : 'الهدايا الإشهارية';

  const invoiceHtml = `
  <div class="sheet">
    <!-- أشكال الخلفية -->
    <svg class="shape-top-right" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 250" preserveAspectRatio="none">
      <path d="M500 0 L150 0 C300 0, 350 80, 500 80 Z" fill="#1c68af" />
      <path d="M500 0 L100 0 C250 50, 300 130, 500 130 Z" fill="#0f4c9a" opacity="0.9"/>
      <path d="M500 0 L50 0 C200 100, 250 200, 500 250 Z" fill="#0f4c9a" opacity="0.1"/>
    </svg>
    <svg class="shape-bottom-left" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 200" preserveAspectRatio="none">
      <path d="M0 200 L0 50 C100 100, 150 180, 250 200 Z" fill="#0f4c9a" opacity="0.9"/>
      <path d="M0 200 L0 100 C50 150, 100 190, 150 200 Z" fill="#1c68af" />
    </svg>

    <div class="content">

      <!-- الترويسة -->
      <div class="header">
        <div class="header-text">
          <h1>${esc(s.company_name || 'مؤسسة زروق للخدمات المطبعية')}</h1>
          <div class="services">
            <p>${tagline}</p>
            <p>${tagline2}</p>
          </div>
          ${s.address ? `<div class="location"><i class="fas fa-map-marker-alt"></i> ${esc(s.address)}</div>` : ''}
        </div>
        <div class="logo-area">
          <img id="invLogo" src="${logoSrc}" alt="شعار المؤسسة">
        </div>
      </div>

      <!-- العنوان الرئيسي -->
      <div class="invoice-title-container">
        <div class="invoice-title"><h2>فاتورة مبيعات</h2></div>
        <div class="invoice-subtitle">SALES INVOICE</div>
      </div>

      <!-- بطاقات المعلومات -->
      <div class="info-cards">
        <div class="info-box">
          <div class="info-row">
            <div class="info-label"><span><i class="fas fa-user"></i> اسم العميل:</span></div>
            <div class="info-value">${esc(inv.customer_name || '—')}</div>
          </div>
          ${customerPhone ? `
          <div class="info-row">
            <div class="info-label"><span><i class="fas fa-phone-alt"></i> رقم الهاتف:</span></div>
            <div class="info-value">${esc(customerPhone)}</div>
          </div>` : ''}
        </div>
        <div class="info-box">
          <div class="info-row">
            <div class="info-label"><span><i class="fas fa-file-invoice"></i> رقم الفاتورة:</span></div>
            <div class="info-value">${esc(inv.invoice_number)}</div>
          </div>
          <div class="info-row">
            <div class="info-label"><span><i class="fas fa-calendar-alt"></i> التاريخ:</span></div>
            <div class="info-value">${fmtDateAr(inv.invoice_date)}</div>
          </div>
          <div class="info-row">
            <div class="info-label"><span><i class="fas fa-wallet"></i> حالة الدفع:</span></div>
            <div class="info-value"><span class="status-badge" style="background:${badge.bg};"><i class="fas ${badgeIcon}"></i> ${badge.label}</span></div>
          </div>
        </div>
      </div>

      <!-- جدول الأصناف -->
      <table>
        <thead>
          <tr><th>م</th><th>الصنف / الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <!-- المجاميع والملاحظات -->
      <div class="bottom-section">
        <div class="totals-box">
          <div class="total-row">
            <div class="total-label">المجموع الكلي</div>
            <div class="total-value">${money(inv.total)} أوقية</div>
          </div>
          <div class="total-row paid">
            <div class="total-label">المبلغ المدفوع</div>
            <div class="total-value">${money(paidAmt)} أوقية</div>
          </div>
          <div class="total-row remaining">
            <div class="total-label">المتبقي</div>
            <div class="total-value">${money(remainingAmt)} أوقية</div>
          </div>
        </div>
        <div class="notes-box">
          <div class="notes-header"><i class="fas fa-clipboard-list"></i> ملاحظات</div>
          <ul class="notes-list">
            <li>شكرًا لاختياركم مؤسسة زروق.</li>
            <li>يرجى التأكد من صحة البيانات قبل استلام الطلب.</li>
            <li>يمكنكم التواصل معنا في أي وقت عبر وسائل الاتصال المذكورة.</li>
          </ul>
        </div>
      </div>

      <!-- الختم والتوقيع -->
      <div class="signature-row">
        <div class="signature"><div class="sig-label">ختم وتوقيع المؤسسة</div><div class="sig-line"></div></div>
      </div>

      <!-- فاصل مرن: يدفع التذييل إلى أسفل الورقة دائمًا -->
      <div class="spacer"></div>

      <!-- التذييل -->
      <div class="footer">
        <div class="contact-info">
          ${s.phone ? `<div class="contact-item"><div class="contact-icon"><i class="fas fa-phone-alt"></i></div> ${esc(s.phone)}</div>` : ''}
          ${s.address ? `<div class="contact-item"><div class="contact-icon"><i class="fas fa-map-marker-alt"></i></div> ${esc(s.address)}</div>` : ''}
          <div class="contact-item">
            <div class="contact-icon outline"><i class="fab fa-facebook-f"></i></div>
            <div class="contact-icon outline"><i class="fab fa-tiktok"></i></div>
            مؤسسة زروق
          </div>
        </div>
      </div>
    </div>
  </div>`;

  const css = `
    @page{ size:A4 portrait; margin:0; }
    :root{ --primary-blue:#0f4c9a; --secondary-blue:#1c68af; --light-blue-bg:#f4f9ff; --border-color:#d1e4f6; --text-dark:#1a3c63; --fit-a:1; --fit-l:1; }
    *{ box-sizing:border-box; margin:0; padding:0; font-family:'Cairo','Tahoma',sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; color-adjust:exact; }
    html,body{ background:#e9ecf3; }
    body{ direction:rtl; color:var(--primary-blue); }

    /* ورقة A4 بأبعاد ثابتة: لا تتجاوز صفحة واحدة مهما كان المحتوى */
    .sheet{ position:relative; overflow:hidden; display:flex; flex-direction:column; background:#fff;
            width:210mm; height:297mm; margin:0 auto; break-inside:avoid; page-break-after:avoid; page-break-inside:avoid; }
    .sheet.measuring{ height:auto !important; }
    @media screen{ body{ padding:12px 0; } .sheet{ box-shadow:0 4px 24px rgba(0,0,0,.18); } }
    @media print{
      html,body{ background:#fff; margin:0; padding:0; }
      .sheet{ margin:0; box-shadow:none; height:296mm; }
    }
    /* احتياط: إن كانت الورقة الفعلية أصغر من A4 (مثل Letter) نقلّص الارتفاع */
    @media print and (max-height:285mm){ .sheet{ height:277mm; } }

    /* الضغط التلقائي: يُحسب من الجافاسكربت حسب عدد العناصر */
    .content > *{ zoom:var(--fit-a); }
    @media print and (max-height:285mm){ .content > *{ zoom:var(--fit-l); } }
    .sheet.measuring .content > *{ zoom:1 !important; }

    .shape-top-right{ position:absolute; top:0; right:0; width:320px; height:110px; z-index:1; }
    .shape-bottom-left{ position:absolute; bottom:0; left:0; width:280px; height:100px; z-index:1; }
    .content{ position:relative; z-index:10; flex:1; min-height:0; display:flex; flex-direction:column; padding:13mm 12mm 9mm; }

    .header{ display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:4px; }
    .header-text{ flex:1; padding-top:6px; }
    .header-text h1{ font-weight:900; font-size:29px; margin-bottom:4px; line-height:1.3; }
    .services{ display:inline-block; text-align:center; margin-bottom:4px; }
    .services p{ font-size:14.5px; font-weight:700; color:var(--secondary-blue); line-height:1.6; }
    .location{ font-weight:700; font-size:13px; display:flex; align-items:center; gap:6px; }
    .logo-area{ width:34mm; height:34mm; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
    .logo-area img{ display:block; max-width:100%; max-height:100%; width:auto; height:auto; object-fit:contain; }

    .invoice-title-container{ text-align:center; margin:8px 0 12px; }
    .invoice-title{ display:flex; align-items:center; justify-content:center; gap:15px; }
    .invoice-title::before,.invoice-title::after{ content:""; height:1.5px; width:150px; background:var(--primary-blue); }
    .invoice-title h2{ font-size:32px; font-weight:900; line-height:1.2; }
    .invoice-subtitle{ font-size:14px; font-weight:700; letter-spacing:5px; margin-top:2px; }

    .info-cards{ display:flex; gap:18px; margin-bottom:12px; break-inside:avoid; }
    .info-box{ flex:1; border:1px solid var(--border-color); border-radius:6px; overflow:hidden; }
    .info-row{ display:flex; border-bottom:1px solid var(--border-color); }
    .info-row:last-child{ border-bottom:none; }
    .info-label{ width:130px; flex-shrink:0; background:var(--light-blue-bg); padding:6px 12px; font-weight:700; font-size:13px; display:flex; align-items:center; border-left:1px solid var(--border-color); }
    .info-label i{ margin-left:4px; }
    .info-value{ flex:1; padding:6px 12px; font-weight:700; font-size:13px; display:flex; align-items:center; color:var(--text-dark); }
    .status-badge{ color:#fff; padding:2px 14px; border-radius:20px; font-size:12px; display:inline-flex; align-items:center; gap:5px; }

    table{ width:100%; border-collapse:collapse; margin-bottom:12px; border:1px solid var(--border-color); }
    thead{ display:table-header-group; }
    tr{ break-inside:avoid; page-break-inside:avoid; }
    th,td{ border:1px solid var(--border-color); padding:6px 8px; text-align:center; font-weight:700; }
    th{ background:var(--primary-blue); color:#fff; border-color:rgba(255,255,255,.2); font-size:14px; }
    td{ font-size:13.5px; color:var(--text-dark); }
    td.desc{ text-align:right; }
    th:nth-child(1){ width:6%; } th:nth-child(2){ width:38%; } th:nth-child(3){ width:14%; } th:nth-child(4){ width:21%; } th:nth-child(5){ width:21%; }
    tbody tr:nth-child(even){ background:var(--light-blue-bg); }

    .bottom-section{ display:flex; gap:18px; margin-bottom:10px; break-inside:avoid; }
    .totals-box{ flex:1; display:flex; flex-direction:column; gap:6px; }
    .total-row{ display:flex; border-radius:6px; overflow:hidden; border:1px solid var(--border-color); background:var(--light-blue-bg); }
    .total-row.paid{ background:#e6f0fa; }
    .total-label{ flex:1; padding:7px 14px; font-weight:800; font-size:14.5px; border-left:1px solid var(--border-color); }
    .total-value{ flex:1.2; padding:7px 12px; font-weight:800; font-size:14.5px; text-align:center; white-space:nowrap; }
    .total-row.remaining{ background:var(--primary-blue); border-color:var(--primary-blue); color:#fff; }
    .total-row.remaining .total-label{ border-color:rgba(255,255,255,.25); }
    .notes-box{ flex:1.3; border:1px solid var(--border-color); border-radius:6px; padding:12px 14px; }
    .notes-header{ display:flex; align-items:center; gap:8px; font-weight:800; font-size:15px; margin-bottom:6px; }
    .notes-list{ list-style:none; padding-right:14px; font-size:12px; font-weight:600; line-height:1.8; }
    .notes-list li{ position:relative; }
    .notes-list li::before{ content:"•"; position:absolute; right:-14px; font-size:17px; }

    .signature-row{ display:flex; justify-content:flex-end; break-inside:avoid; }
    .signature{ width:190px; text-align:center; font-weight:700; font-size:13.5px; }
    .sig-label{ margin-bottom:24px; }
    .sig-line{ border-top:1.5px solid var(--primary-blue); }

    .spacer{ flex:1 1 auto; min-height:4mm; }
    .footer{ display:flex; justify-content:space-between; align-items:flex-end; break-inside:avoid; }
    .contact-info{ display:flex; flex-direction:column; gap:6px; }
    .contact-item{ display:flex; align-items:center; gap:9px; font-weight:700; font-size:12.5px; }
    .contact-icon{ width:23px; height:23px; background:var(--primary-blue); color:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; flex-shrink:0; }
    .contact-icon.outline{ background:transparent; border:1px solid var(--primary-blue); color:var(--primary-blue); }
  `;

  win.document.open();
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=794">
    <title>فاتورة ${esc(inv.invoice_number)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>${css}</style>
    </head><body>${invoiceHtml}</body></html>`);
  win.document.close();

  /* ننتظر اكتمال الصفحة (الأنماط والشعار) ثم الخطوط والأيقونات، مع مهلة قصوى حتى لا تتعطل الطباعة دون إنترنت */
  const whenLoaded = new Promise(res => {
    try {
      if (win.document.readyState === 'complete') res();
      else win.addEventListener('load', () => res(), { once: true });
    } catch (e) { res(); }
  });
  await Promise.race([
    whenLoaded.then(() => (win.document.fonts && win.document.fonts.ready) ? win.document.fonts.ready : null),
    delay(5000)
  ]);

  /* ---- ضمان صفحة واحدة: نقيس الارتفاع الطبيعي للمحتوى، وإن زاد عن الورقة نصغّره بنسبة تناسبه ---- */
  try {
    const doc = win.document;
    const sheet = doc.querySelector('.sheet');
    const content = doc.querySelector('.content');
    const mm = v => v * 96 / 25.4;
    const cs = win.getComputedStyle(content);
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    sheet.classList.add('measuring');
    const natural = sheet.getBoundingClientRect().height;      // الارتفاع الطبيعي بلا ضغط
    sheet.classList.remove('measuring');
    const body = Math.max(natural - pad, 1);
    const factor = avail => Math.max(0.45, Math.min(1, (avail - 3 - pad) / body));
    doc.documentElement.style.setProperty('--fit-a', factor(mm(296)).toFixed(4));   // ورقة A4
    doc.documentElement.style.setProperty('--fit-l', factor(mm(277)).toFixed(4));   // احتياط: ورقة أصغر
  } catch (e) {}

  await delay(250);
  try { win.focus(); win.print(); } catch (e) {}
};

/* =========================================================
   المنتجات — المصنّعة (وصفة تصنيع)
   ========================================================= */
function materialOptions() {
  return `<option value="">اختر مادة…</option>` + STATE.materials.map(m => `<option value="${m.id}">${m.name} (${m.unit})</option>`).join('');
}

function renderManufactured() {
  const rows = STATE.products.filter(p => p.type === 'manufactured');
  qs('#manufacturedEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#manufacturedTableBody').innerHTML = rows.map(p => {
    const cost = manufacturedUnitCost(p.id);
    const bom = STATE.productMaterials.filter(pm => pm.product_id === p.id).map(b => {
      const m = STATE.materials.find(mm => mm.id === b.material_id);
      return m ? `${m.name} (${b.qty_per_unit} ${m.unit})` : '';
    }).filter(Boolean).join('، ');
    return `<tr>
      <td class="cell-strong">${p.name}</td>
      <td>${categoryBadge(p.category)}</td>
      <td>${money(p.sell_price)} أ.م</td>
      <td class="cost-only">${money(cost)}</td>
      <td class="cost-only">${money(p.sell_price - cost)}</td>
      <td class="cell-sub">${bom || '—'}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="editManufactured('${p.id}')">تعديل</button>
        <button class="btn-text danger" onclick="deleteProductAny('${p.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}

function addManuRow(materialId = '', qty = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select class="manu-material">${materialOptions()}</select></td>
    <td><input type="number" class="manu-qty" min="0" step="0.001" value="${qty || ''}"></td>
    <td><button type="button" class="row-remove">✕</button></td>`;
  qs('#manuMaterialsBody').appendChild(tr);
  if (materialId) tr.querySelector('.manu-material').value = materialId;
  tr.querySelector('.manu-material').addEventListener('change', updateManuCostPreview);
  tr.querySelector('.manu-qty').addEventListener('input', updateManuCostPreview);
  tr.querySelector('.row-remove').addEventListener('click', () => { tr.remove(); updateManuCostPreview(); });
}
qs('#btnAddManuRow').addEventListener('click', () => { addManuRow(); updateManuCostPreview(); });

/* تكلفة الوحدة التقديرية لوصفة قيد التحرير (قبل الحفظ) */
function updateManuCostPreview() {
  const el = qs('#manuCostPreview');
  if (!el) return;
  let cost = 0;
  qsa('#manuMaterialsBody tr').forEach(tr => {
    const mat = STATE.materials.find(m => m.id === tr.querySelector('.manu-material').value);
    const q = Number(tr.querySelector('.manu-qty').value) || 0;
    if (mat) cost += q * Number(mat.avg_cost || 0);
  });
  el.textContent = money(cost) + ' أوقية';
}

/* رسالة خطأ واضحة عند فشل الحفظ بسبب قيد قديم على نوع المنتج في قاعدة البيانات */
function productSaveErrorMessage(err) {
  const msg = (err && err.message) || String(err);
  if (/products_type|check constraint|violates check|invalid input value/i.test(msg)) {
    return 'قاعدة البيانات لا تقبل هذا النوع من المنتجات بعد — شغّل ملف fix_products_type.sql في Supabase (SQL Editor) ثم أعد المحاولة.';
  }
  if (/product_components|product_materials|relation .* does not exist/i.test(msg)) {
    return 'جداول الوصفات أو المكوّنات غير موجودة — شغّل ملف spec_v2_migration.sql ثم fix_products_type.sql في Supabase.';
  }
  return 'خطأ: ' + msg;
}
qs('#btnNewManufactured').addEventListener('click', () => {
  qs('#manufacturedModalTitle').textContent = 'منتج مصنّع جديد';
  qs('#manuId').value = ''; qs('#manuName').value = ''; qs('#manuCategory').value = 'عادي'; qs('#manuSellPrice').value = '';
  qs('#manuMaterialsBody').innerHTML = '';
  addManuRow();
  updateManuCostPreview();
  openModal('modalManufactured');
});

window.editManufactured = function (id) {
  const p = STATE.products.find(x => x.id === id);
  if (!p) return;
  qs('#manufacturedModalTitle').textContent = 'تعديل منتج مصنّع';
  qs('#manuId').value = p.id; qs('#manuName').value = p.name; qs('#manuCategory').value = p.category; qs('#manuSellPrice').value = p.sell_price;
  qs('#manuMaterialsBody').innerHTML = '';
  const bom = STATE.productMaterials.filter(pm => pm.product_id === id);
  if (bom.length) bom.forEach(b => addManuRow(b.material_id, b.qty_per_unit));
  else addManuRow();
  updateManuCostPreview();
  openModal('modalManufactured');
};

qs('#btnSaveManufactured').addEventListener('click', async () => {
  const id = qs('#manuId').value;
  const name = qs('#manuName').value.trim();
  const category = qs('#manuCategory').value;
  const sellPrice = Number(qs('#manuSellPrice').value) || 0;
  const bomRows = qsa('#manuMaterialsBody tr').map(tr => ({
    material_id: tr.querySelector('.manu-material').value,
    qty_per_unit: Number(tr.querySelector('.manu-qty').value) || 0,
  })).filter(r => r.material_id && r.qty_per_unit > 0);

  if (!name) { toast('اكتب اسم المنتج', 'error'); return; }
  if (!bomRows.length) { toast('أضف مادة واحدة على الأقل في الوصفة', 'error'); return; }

  try {
    let product;
    if (id) {
      product = await Api.update('products', id, { name, category, sell_price: sellPrice }, name);
      STATE.products = STATE.products.map(p => p.id === id ? product : p);
      await Api.removeWhere('product_materials', 'product_id', id);
      STATE.productMaterials = STATE.productMaterials.filter(pm => pm.product_id !== id);
    } else {
      product = await Api.insert('products', { name, category, type: 'manufactured', sell_price: sellPrice, buy_price: 0, cost_price: 0, quantity: 0 }, name);
      STATE.products.push(product);
    }
    const bomPayload = bomRows.map(r => ({ product_id: product.id, material_id: r.material_id, qty_per_unit: r.qty_per_unit }));
    const inserted = await Api.insertMany('product_materials', bomPayload, 'وصفة ' + name);
    STATE.productMaterials.push(...(inserted || bomPayload));
    STATE.products.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    renderManufactured();
    closeModal('modalManufactured');
    toast('تم حفظ المنتج المصنّع', 'success');
  } catch (err) { toast(productSaveErrorMessage(err), 'error'); }
});

/* =========================================================
   المنتجات — المركبة (الأطقم)
   ========================================================= */
function renderComposite() {
  const rows = STATE.products.filter(p => p.type === 'composite');
  qs('#compositeEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#compositeTableBody').innerHTML = rows.map(p => {
    const cost = compositeUnitCost(p.id);
    const comps = STATE.productComponents.filter(c => c.parent_product_id === p.id).map(c => {
      const child = STATE.products.find(x => x.id === c.component_product_id);
      return child ? `${c.quantity} × ${child.name}` : '';
    }).filter(Boolean).join('، ');
    return `<tr>
      <td class="cell-strong">${p.name}</td>
      <td>${categoryBadge(p.category)}</td>
      <td>${money(p.sell_price)} أ.م</td>
      <td class="cost-only">${money(cost)}</td>
      <td class="cost-only">${money(p.sell_price - cost)}</td>
      <td class="cell-sub">${comps || '—'}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="editComposite('${p.id}')">تعديل</button>
        <button class="btn-text danger" onclick="deleteProductAny('${p.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}

function componentOptions(excludeId = '') {
  return `<option value="">اختر منتجا…</option>` +
    STATE.products.filter(p => p.id !== excludeId)
      .map(p => {
        const label = { manufactured: 'مصنّع', simple: 'جاهز', service: 'خدمة', composite: 'مركب' }[p.type] || '';
        return `<option value="${p.id}">${p.name} (${label})</option>`;
      }).join('');
}

function addCompRow(componentId = '', qty = '') {
  const excludeId = qs('#compId').value;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select class="comp-product">${componentOptions(excludeId)}</select></td>
    <td><input type="number" class="comp-qty" min="0" step="0.001" value="${qty || 1}"></td>
    <td><button type="button" class="row-remove">✕</button></td>`;
  qs('#compComponentsBody').appendChild(tr);
  if (componentId) tr.querySelector('.comp-product').value = componentId;
  tr.querySelector('.comp-product').addEventListener('change', updateCompPreview);
  tr.querySelector('.comp-qty').addEventListener('input', updateCompPreview);
  tr.querySelector('.row-remove').addEventListener('click', () => { tr.remove(); updateCompPreview(); });
}
qs('#btnAddCompRow').addEventListener('click', () => { addCompRow(); updateCompPreview(); });

/* تنسيق الكميات (حتى 3 منازل عشرية بدون أصفار زائدة) */
function fmtQty(n) {
  return Number((Number(n) || 0).toFixed(3)).toLocaleString('ar-MA', { maximumFractionDigits: 3 });
}

/* معاينة حيّة للمنتج المركب قبل الحفظ: المواد المستهلكة لعدد وحدات معيّن + تكلفة الوحدة.
   تستخدم نفس دالتي التفكيك والتكلفة المستخدمتين عند البيع، فتطابق ما سيُخصم فعلاً. */
function updateCompPreview() {
  const listEl = qs('#compMaterialsPreview');
  if (!listEl) return;
  const parentId = qs('#compId').value;
  const n = Number(qs('#compPreviewQty').value) > 0 ? Number(qs('#compPreviewQty').value) : 1;
  const rows = qsa('#compComponentsBody tr').map(tr => ({
    id: tr.querySelector('.comp-product').value,
    qty: Number(tr.querySelector('.comp-qty').value) || 0,
  })).filter(r => r.id && r.qty > 0);

  const base = parentId ? [parentId] : [];
  const leaves = [];
  let unitCost = 0;
  rows.forEach(r => {
    const child = STATE.products.find(p => p.id === r.id);
    if (!child) return;
    expandProductToLeaves(child, r.qty * n, new Set(base), leaves);
    unitCost += productUnitCost(child, new Set(base)) * r.qty;
  });

  const agg = aggregateLeaves(leaves);
  listEl.innerHTML = agg.length ? agg.map(l => {
    const isMat = l.kind === 'material';
    const unit = isMat ? (l.item.unit || '') : 'قطعة';
    const stock = Number(l.item.quantity || 0);
    const short = stock < l.qty;
    return `<div class="mini-row">
      <div>
        <div class="mini-row-title">${l.item.name}${isMat ? '' : '<span class="preview-tag">منتج جاهز</span>'}</div>
        <div class="mini-row-sub ${short ? 'preview-short' : ''}">المتوفر: ${fmtQty(stock)} ${unit}${short ? ' — غير كافٍ' : ''}</div>
      </div>
      <div class="mini-row-value">${fmtQty(l.qty)} ${unit}</div>
    </div>`;
  }).join('') : '<p class="mini-empty">اختر المكوّنات لتظهر المواد المستهلكة هنا</p>';

  const costEl = qs('#compCostPreview');
  if (costEl) costEl.textContent = money(unitCost) + ' أوقية';
}
qs('#compPreviewQty').addEventListener('input', updateCompPreview);

qs('#btnNewComposite').addEventListener('click', () => {
  qs('#compositeModalTitle').textContent = 'منتج مركب جديد';
  qs('#compId').value = ''; qs('#compName').value = ''; qs('#compCategory').value = 'عادي'; qs('#compSellPrice').value = '';
  qs('#compCycleWarning').style.display = 'none';
  qs('#compComponentsBody').innerHTML = '';
  qs('#compPreviewQty').value = 1;
  addCompRow();
  updateCompPreview();
  openModal('modalComposite');
});

window.editComposite = function (id) {
  const p = STATE.products.find(x => x.id === id);
  if (!p) return;
  qs('#compositeModalTitle').textContent = 'تعديل منتج مركب';
  qs('#compId').value = p.id; qs('#compName').value = p.name; qs('#compCategory').value = p.category || 'عادي'; qs('#compSellPrice').value = p.sell_price;
  qs('#compCycleWarning').style.display = 'none';
  qs('#compComponentsBody').innerHTML = '';
  const comps = STATE.productComponents.filter(c => c.parent_product_id === id);
  qs('#compPreviewQty').value = 1;
  if (comps.length) comps.forEach(c => addCompRow(c.component_product_id, c.quantity));
  else addCompRow();
  updateCompPreview();
  openModal('modalComposite');
};

qs('#btnSaveComposite').addEventListener('click', async () => {
  const id = qs('#compId').value;
  const name = qs('#compName').value.trim();
  const category = qs('#compCategory').value;
  const sellPrice = Number(qs('#compSellPrice').value) || 0;
  const compRows = qsa('#compComponentsBody tr').map(tr => ({
    component_product_id: tr.querySelector('.comp-product').value,
    quantity: Number(tr.querySelector('.comp-qty').value) || 0,
  })).filter(r => r.component_product_id && r.quantity > 0);

  if (!name) { toast('اكتب اسم المنتج المركب', 'error'); return; }
  if (!compRows.length) { toast('أضف مكوّنا واحدا على الأقل', 'error'); return; }

  // منع الحلقات المغلقة (منتج يحتوي نفسه مباشرة أو عبر منتج آخر)
  if (id && compRows.some(r => wouldCreateCycle(id, r.component_product_id))) {
    qs('#compCycleWarning').style.display = 'block';
    toast('لا يمكن أن يحتوي المنتج المركب على نفسه ضمن مكوّناته', 'error');
    return;
  }
  qs('#compCycleWarning').style.display = 'none';

  try {
    let product;
    if (id) {
      product = await Api.update('products', id, { name, category, sell_price: sellPrice }, name);
      STATE.products = STATE.products.map(p => p.id === id ? product : p);
      await Api.removeWhere('product_components', 'parent_product_id', id);
      STATE.productComponents = STATE.productComponents.filter(c => c.parent_product_id !== id);
    } else {
      product = await Api.insert('products', { name, category, type: 'composite', sell_price: sellPrice, buy_price: 0, cost_price: 0, quantity: 0 }, name);
      STATE.products.push(product);
    }
    const payload = compRows.map(r => ({ parent_product_id: product.id, component_product_id: r.component_product_id, quantity: r.quantity }));
    const inserted = await Api.insertMany('product_components', payload, 'مكونات ' + name);
    STATE.productComponents.push(...(inserted || payload));
    STATE.products.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    renderComposite(); renderSimple(); renderDashboard();
    closeModal('modalComposite');
    toast('تم حفظ المنتج المركب', 'success');
  } catch (err) { toast(productSaveErrorMessage(err), 'error'); }
});

/* =========================================================
   المنتجات — الجاهزة والخدمات
   ========================================================= */
function renderSimple() {
  const rows = STATE.products.filter(p => p.type !== 'manufactured' && p.type !== 'composite');
  qs('#simpleEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#simpleTableBody').innerHTML = rows.map(p => {
    const cost = p.type === 'service' ? Number(p.cost_price) || 0 : Number(p.buy_price) || 0;
    return `<tr>
      <td class="cell-strong">${p.name}</td>
      <td><span class="badge ${p.type === 'service' ? 'badge-service' : 'badge-cat'}">${p.type === 'service' ? 'خدمة' : 'منتج جاهز'}</span></td>
      <td>${categoryBadge(p.category)}</td>
      <td class="cost-only">${money(cost)}</td>
      <td>${money(p.sell_price)} أ.م</td>
      <td class="cost-only">${money(p.sell_price - cost)}</td>
      <td class="${p.type === 'simple' && Number(p.quantity) <= 3 ? 'qty-low' : ''}">${p.type === 'service' ? '—' : (p.quantity ?? 0)}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="editSimple('${p.id}')">تعديل</button>
        <button class="btn-text danger" onclick="deleteProductAny('${p.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}

function applySimpleTypeUI() {
  const type = qs('#simpleType').value;
  if (type === 'service') {
    qs('#simpleCostLabel').textContent = 'التكلفة (اختياري)';
    qs('#simpleQtyField').style.display = 'none';
  } else {
    qs('#simpleCostLabel').textContent = 'سعر الشراء / التكلفة';
    qs('#simpleQtyField').style.display = '';
  }
}
qs('#simpleType').addEventListener('change', applySimpleTypeUI);

qs('#btnNewSimple').addEventListener('click', () => {
  qs('#simpleModalTitle').textContent = 'منتج جاهز / خدمة جديدة';
  qs('#simpleForm').reset();
  qs('#simpleId').value = ''; qs('#simpleType').value = 'simple'; qs('#simpleCategory').value = 'عادي';
  applySimpleTypeUI();
  openModal('modalSimple');
});

window.editSimple = function (id) {
  const p = STATE.products.find(x => x.id === id);
  if (!p) return;
  qs('#simpleModalTitle').textContent = 'تعديل منتج / خدمة';
  qs('#simpleId').value = p.id; qs('#simpleName').value = p.name; qs('#simpleType').value = p.type; qs('#simpleCategory').value = p.category;
  qs('#simpleCost').value = p.type === 'service' ? (p.cost_price || 0) : (p.buy_price || 0);
  qs('#simpleSellPrice').value = p.sell_price;
  qs('#simpleQuantity').value = p.quantity || 0;
  applySimpleTypeUI();
  openModal('modalSimple');
};

/* رسالة عربية مفهومة عند تعذّر الحذف بسبب ارتباط السجل بسجلات أخرى (قيد مفتاح أجنبي) */
function friendlyDeleteError(err) {
  const msg = (err && err.message) || String(err);
  const m = msg.match(/violates foreign key constraint "([^"]+)"\s*(?:\r?\n)?\s*on table "([^"]+)"/i)
         || msg.match(/on table "([^"]+)"/i) && [null, null, msg.match(/on table "([^"]+)"/i)[1]];
  const tableNames = {
    invoice_items: 'فواتير المبيعات', purchase_items: 'فواتير المشتريات',
    product_components: 'منتجات مركبة', product_materials: 'وصفات منتجات',
    supplier_payments: 'دفعات موردين', customer_payments: 'دفعات عملاء',
    purchases: 'المشتريات', invoices: 'المبيعات', expenses: 'المصروفات',
    inventory_losses: 'الخسائر والتالف', stock_movements: 'حركة المخزون',
  };
  if (/violates foreign key constraint/i.test(msg)) {
    const table = m && m[2] ? m[2] : (m && m[1]) || '';
    const label = tableNames[table] || 'سجلات أخرى';
    return `تعذّر الحذف: هذا العنصر مرتبط بـ${label} موجودة فعلاً في النظام. لا يمكن حذفه دون حذف تلك السجلات أولاً — يمكنك بدلاً من ذلك تعديله أو إيقاف استخدامه.`;
  }
  return 'تعذر الحذف: ' + msg;
}

window.deleteProductAny = async function (id) {
  if (!requireManager('حذف المنتجات')) return;
  const usedIn = STATE.productComponents
    .filter(c => c.component_product_id === id)
    .map(c => STATE.products.find(p => p.id === c.parent_product_id)?.name)
    .filter(Boolean);
  const warn = usedIn.length ? `\n\nتنبيه: هذا المنتج يدخل ضمن مكوّنات: ${[...new Set(usedIn)].join('، ')} — وسيُزال منها.` : '';
  if (!confirm('هل تريد حذف هذا المنتج؟' + warn)) return;
  try {
    await Api.remove('products', id, 'منتج');
    await Api.removeWhere('product_materials', 'product_id', id);
    STATE.products = STATE.products.filter(p => p.id !== id);
    STATE.productMaterials = STATE.productMaterials.filter(pm => pm.product_id !== id);
    STATE.productComponents = STATE.productComponents.filter(c => c.parent_product_id !== id && c.component_product_id !== id);
    renderManufactured(); renderSimple(); renderComposite(); renderDashboard();
    toast('تم حذف المنتج', 'success');
  } catch (err) { toast(friendlyDeleteError(err), 'error'); }
};

qs('#btnSaveSimple').addEventListener('click', async () => {
  const id = qs('#simpleId').value;
  const type = qs('#simpleType').value;
  const cost = Number(qs('#simpleCost').value) || 0;
  const payload = {
    name: qs('#simpleName').value.trim(),
    type, category: qs('#simpleCategory').value,
    sell_price: Number(qs('#simpleSellPrice').value) || 0,
    buy_price: type === 'simple' ? cost : 0,
    cost_price: type === 'service' ? cost : 0,
    quantity: type === 'simple' ? (Number(qs('#simpleQuantity').value) || 0) : 0,
  };
  if (!payload.name) { toast('اكتب الاسم', 'error'); return; }
  try {
    if (id) {
      const updated = await Api.update('products', id, payload, payload.name);
      STATE.products = STATE.products.map(p => p.id === id ? updated : p);
    } else {
      const created = await Api.insert('products', payload, payload.name);
      STATE.products.push(created);
    }
    STATE.products.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    renderSimple(); renderDashboard();
    closeModal('modalSimple');
    toast('تم الحفظ', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

/* =========================================================
   المخزون — المواد والأصناف
   ========================================================= */
function renderMaterials(filter = '') {
  const rows = STATE.materials.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()));
  qs('#materialsEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#materialsTableBody').innerHTML = rows.map(m => `
    <tr>
      <td class="cell-strong">${m.name}</td>
      <td>${m.unit}</td>
      <td class="${Number(m.quantity) <= 5 ? 'qty-low' : ''}">${m.quantity}</td>
      <td class="cost-only">${money(m.avg_cost)}</td>
      <td class="cost-only">${money(Number(m.quantity) * Number(m.avg_cost))}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="editMaterial('${m.id}')">تعديل</button>
        <button class="btn-text danger" onclick="deleteMaterial('${m.id}')">حذف</button>
      </td>
    </tr>`).join('');
}
qs('#materialSearch').addEventListener('input', (e) => renderMaterials(e.target.value));

function openMaterialModal() {
  qs('#materialModalTitle').textContent = 'مادة جديدة';
  qs('#materialForm').reset();
  qs('#matId').value = ''; qs('#matUnit').value = 'قطعة'; qs('#matQuantity').value = 0; qs('#matAvgCost').value = 0;
  openModal('modalMaterial');
}
qs('#btnNewMaterial').addEventListener('click', openMaterialModal);
qs('#btnNewMaterial2').addEventListener('click', openMaterialModal);

window.editMaterial = function (id) {
  const m = STATE.materials.find(x => x.id === id);
  if (!m) return;
  qs('#materialModalTitle').textContent = 'تعديل مادة';
  qs('#matId').value = m.id; qs('#matName').value = m.name; qs('#matUnit').value = m.unit; qs('#matQuantity').value = m.quantity; qs('#matAvgCost').value = m.avg_cost;
  openModal('modalMaterial');
};

window.deleteMaterial = async function (id) {
  if (!requireManager('حذف المواد')) return;
  if (!confirm('هل تريد حذف هذه المادة؟ سيؤثر ذلك على وصفات المنتجات المرتبطة بها.')) return;
  try {
    await Api.remove('materials', id, 'مادة');
    STATE.materials = STATE.materials.filter(m => m.id !== id);
    STATE.productMaterials = STATE.productMaterials.filter(pm => pm.material_id !== id);
    renderMaterials(); renderManufactured(); renderDashboard();
    toast('تم حذف المادة', 'success');
  } catch (err) { toast(friendlyDeleteError(err), 'error'); }
};

qs('#btnSaveMaterial').addEventListener('click', async () => {
  const id = qs('#matId').value;
  const payload = {
    name: qs('#matName').value.trim(), unit: qs('#matUnit').value.trim() || 'قطعة',
    quantity: Number(qs('#matQuantity').value) || 0, avg_cost: Number(qs('#matAvgCost').value) || 0,
  };
  if (!payload.name) { toast('اكتب اسم المادة', 'error'); return; }
  try {
    if (id) {
      const updated = await Api.update('materials', id, payload, payload.name);
      STATE.materials = STATE.materials.map(m => m.id === id ? updated : m);
    } else {
      const created = await Api.insert('materials', payload, payload.name);
      STATE.materials.push(created);
    }
    STATE.materials.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    renderMaterials(); renderManufactured(); renderDashboard();
    closeModal('modalMaterial');
    toast('تم حفظ المادة', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

/* ---------- حركة المخزون ---------- */
function renderMovements() {
  const from = qs('#movementFilterFrom').value, to = qs('#movementFilterTo').value, dir = qs('#movementFilterDirection').value;
  const rows = STATE.movements.filter(m =>
    (!from || m.movement_date >= from) && (!to || m.movement_date <= to) && (!dir || m.direction === dir) && m.quantity_before == null
  );
  qs('#movementsEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#movementsTableBody').innerHTML = rows.map(m => `
    <tr>
      <td class="cell-strong">${m.item_name}</td>
      <td class="${m.direction === 'in' ? 'text-success' : 'text-danger'}">${m.direction === 'in' ? 'دخول' : 'خروج'}</td>
      <td>${m.quantity}</td>
      <td class="cell-sub">${m.reason || '—'}</td>
      <td>${fmtDateAr(m.movement_date)}</td>
    </tr>`).join('');
}
['movementFilterFrom', 'movementFilterTo', 'movementFilterDirection'].forEach(id => qs('#' + id).addEventListener('input', renderMovements));

/* ---------- الخسائر والتالف ---------- */
function lossStockOptions() {
  const mats = STATE.materials.map(m => `<option value="material:${m.id}" data-cost="${m.avg_cost}">${m.name} (متوفر: ${m.quantity} ${m.unit})</option>`);
  const prods = STATE.products.filter(p => p.type === 'simple').map(p => `<option value="product:${p.id}" data-cost="${p.buy_price}">${p.name} (متوفر: ${p.quantity})</option>`);
  return `<option value="">اختر الصنف…</option>` + mats.join('') + prods.join('');
}
function applyLossModeUI() {
  const mode = qs('#lossMode').value;
  qs('#lossItemField').style.display = mode === 'stock' ? '' : 'none';
  qs('#lossCustomNameField').style.display = mode === 'stock' ? 'none' : '';
}
qs('#lossMode').addEventListener('change', applyLossModeUI);
qs('#lossItemSelect').addEventListener('change', (e) => {
  const opt = e.target.selectedOptions[0];
  if (opt?.dataset.cost) qs('#lossUnitCost').value = opt.dataset.cost;
});

qs('#btnNewLoss').addEventListener('click', () => {
  qs('#lossForm').reset();
  qs('#lossMode').value = 'stock';
  qs('#lossItemSelect').innerHTML = lossStockOptions();
  qs('#lossQuantity').value = 1; qs('#lossUnitCost').value = 0; qs('#lossDate').value = todayISO();
  applyLossModeUI();
  openModal('modalLoss');
});

qs('#btnSaveLoss').addEventListener('click', async () => {
  const mode = qs('#lossMode').value;
  const qty = Number(qs('#lossQuantity').value) || 0;
  const unitCost = Number(qs('#lossUnitCost').value) || 0;
  const reason = qs('#lossReason').value.trim();
  const date = qs('#lossDate').value || todayISO();
  if (qty <= 0) { toast('أدخل كمية صحيحة', 'error'); return; }

  try {
    let itemType = 'custom', itemId = null, itemName = qs('#lossCustomName').value.trim();
    if (mode === 'stock') {
      const val = qs('#lossItemSelect').value;
      if (!val) { toast('اختر الصنف', 'error'); return; }
      const [type, id] = val.split(':');
      itemType = type; itemId = id;
      if (type === 'material') {
        const mat = STATE.materials.find(m => m.id === id);
        itemName = mat.name;
        const before = Number(mat.quantity) || 0, after = before - qty;
        const updated = await Api.update('materials', id, { quantity: after });
        STATE.materials = STATE.materials.map(m => m.id === id ? updated : m);
        logMovement('material', id, mat.name, 'out', qty, 'خسارة/تالف: ' + (reason || '—'));
      } else {
        const prod = STATE.products.find(p => p.id === id);
        itemName = prod.name;
        const before = Number(prod.quantity) || 0, after = before - qty;
        const updated = await Api.update('products', id, { quantity: after });
        STATE.products = STATE.products.map(p => p.id === id ? updated : p);
        logMovement('product', id, prod.name, 'out', qty, 'خسارة/تالف: ' + (reason || '—'));
      }
    } else if (!itemName) { toast('اكتب اسم الصنف أو البيان', 'error'); return; }

    const loss = await Api.insert('inventory_losses', {
      item_type: itemType, item_id: itemId, item_name: itemName, quantity: qty,
      unit_cost: unitCost, total_cost: qty * unitCost, reason, loss_date: date,
    }, itemName);
    STATE.losses.unshift(loss);
    renderLosses(); renderMaterials(); renderSimple(); renderDashboard();
    closeModal('modalLoss');
    toast('تم تسجيل الخسارة', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

function renderLosses() {
  const from = qs('#lossFilterFrom').value, to = qs('#lossFilterTo').value;
  const rows = STATE.losses.filter(l => (!from || l.loss_date >= from) && (!to || l.loss_date <= to));
  qs('#lossesEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#lossesTableBody').innerHTML = rows.map(l => `
    <tr>
      <td class="cell-strong">${l.item_name}</td>
      <td>${l.quantity}</td>
      <td class="cost-only">${money(l.unit_cost)}</td>
      <td class="cost-only text-danger">${money(l.total_cost)}</td>
      <td class="cell-sub">${l.reason || '—'}</td>
      <td>${fmtDateAr(l.loss_date)}</td>
      <td class="row-actions"><button class="btn-text danger" onclick="deleteLoss('${l.id}')">حذف</button></td>
    </tr>`).join('');
}
['lossFilterFrom', 'lossFilterTo'].forEach(id => qs('#' + id).addEventListener('input', renderLosses));

window.deleteLoss = async function (id) {
  if (!requireManager('حذف سجلات الخسائر')) return;
  if (!confirm('هل تريد حذف سجل الخسارة؟ (لن تتم إعادة الكمية إلى المخزون تلقائيا)')) return;
  try {
    await Api.remove('inventory_losses', id, 'خسارة');
    STATE.losses = STATE.losses.filter(l => l.id !== id);
    renderLosses(); renderDashboard();
    toast('تم الحذف', 'success');
  } catch (err) { toast(friendlyDeleteError(err), 'error'); }
};

/* ---------- الجرد والتسويات ---------- */
function adjustStockOptions() {
  const mats = STATE.materials.map(m => `<option value="material:${m.id}">${m.name} (${m.unit})</option>`);
  const prods = STATE.products.filter(p => p.type === 'simple').map(p => `<option value="product:${p.id}">${p.name}</option>`);
  return `<option value="">اختر الصنف…</option>` + mats.join('') + prods.join('');
}
function currentQtyForSelection(val) {
  if (!val) return null;
  const [type, id] = val.split(':');
  const item = type === 'material' ? STATE.materials.find(m => m.id === id) : STATE.products.find(p => p.id === id);
  return item ? Number(item.quantity) : null;
}
qs('#adjItemSelect').addEventListener('change', (e) => {
  const qty = currentQtyForSelection(e.target.value);
  qs('#adjCurrentQty').value = qty == null ? '' : qty;
});
qs('#btnNewAdjustment').addEventListener('click', () => {
  qs('#adjustmentForm').reset();
  qs('#adjItemSelect').innerHTML = adjustStockOptions();
  qs('#adjCurrentQty').value = ''; qs('#adjDate').value = todayISO();
  openModal('modalAdjustment');
});

qs('#btnSaveAdjustment').addEventListener('click', async () => {
  const val = qs('#adjItemSelect').value;
  if (!val) { toast('اختر الصنف', 'error'); return; }
  const [type, id] = val.split(':');
  const counted = Number(qs('#adjCountedQty').value);
  if (isNaN(counted)) { toast('أدخل الكمية الفعلية', 'error'); return; }
  const date = qs('#adjDate').value || todayISO();
  const reason = qs('#adjReason').value.trim();

  try {
    const table = type === 'material' ? 'materials' : 'products';
    const item = (type === 'material' ? STATE.materials : STATE.products).find(x => x.id === id);
    const before = Number(item.quantity) || 0;
    const diff = counted - before;
    const updated = await Api.update(table, id, { quantity: counted }, item.name);
    if (type === 'material') STATE.materials = STATE.materials.map(m => m.id === id ? updated : m);
    else STATE.products = STATE.products.map(p => p.id === id ? updated : p);

    await window.db.from('inventory_movements').insert([{
      item_type: type, item_id: id, item_name: item.name,
      direction: diff >= 0 ? 'in' : 'out', quantity: Math.abs(diff),
      reason: 'تسوية جرد' + (reason ? ' - ' + reason : ''),
      quantity_before: before, quantity_after: counted, movement_date: date,
    }]);
    STATE.movements = await Api.list('inventory_movements', 'created_at', false, 400);

    renderMaterials(); renderSimple(); renderMovements(); renderAdjustments(); renderDashboard();
    closeModal('modalAdjustment');
    toast('تم حفظ التسوية', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

function renderAdjustments() {
  const rows = STATE.movements.filter(m => m.quantity_before != null);
  qs('#adjustmentsEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#adjustmentsTableBody').innerHTML = rows.map(m => {
    const diff = Number(m.quantity_after) - Number(m.quantity_before);
    return `<tr>
      <td class="cell-strong">${m.item_name}</td>
      <td>${m.quantity_before}</td>
      <td>${m.quantity_after}</td>
      <td class="${diff >= 0 ? 'text-success' : 'text-danger'}">${diff > 0 ? '+' : ''}${diff}</td>
      <td class="cell-sub">${m.reason || '—'}</td>
      <td>${fmtDateAr(m.movement_date)}</td>
    </tr>`;
  }).join('');
}

/* =========================================================
   المشتريات
   ========================================================= */
function purchaseItemOptions(itemType) {
  if (itemType === 'material') return `<option value="">اختر مادة…</option>` + STATE.materials.map(m => `<option value="${m.id}" data-price="${m.avg_cost}">${m.name} (${m.unit})</option>`).join('');
  return `<option value="">اختر منتج جاهز…</option>` + STATE.products.filter(p => p.type === 'simple').map(p => `<option value="${p.id}" data-price="${p.buy_price}">${p.name}</option>`).join('');
}

function addPurchaseRow() {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select class="pur-item-type"><option value="material">مادة خام</option><option value="product">منتج جاهز</option></select></td>
    <td><select class="pur-item-select">${purchaseItemOptions('material')}</select></td>
    <td><input type="number" class="pur-item-qty" min="0.01" step="0.01" value="1"></td>
    <td><input type="number" class="pur-item-price" min="0" step="0.01" value="0"></td>
    <td class="line-total">0.00</td>
    <td><button type="button" class="row-remove">✕</button></td>`;
  qs('#purchaseItemsBody').appendChild(tr);
  const typeSel = tr.querySelector('.pur-item-type'), itemSel = tr.querySelector('.pur-item-select');
  const qty = tr.querySelector('.pur-item-qty'), price = tr.querySelector('.pur-item-price');
  typeSel.addEventListener('change', () => { itemSel.innerHTML = purchaseItemOptions(typeSel.value); price.value = 0; updatePurchaseRowTotal(tr); });
  itemSel.addEventListener('change', () => { const opt = itemSel.selectedOptions[0]; price.value = opt?.dataset.price || 0; updatePurchaseRowTotal(tr); });
  [qty, price].forEach(inp => inp.addEventListener('input', () => updatePurchaseRowTotal(tr)));
  tr.querySelector('.row-remove').addEventListener('click', () => { tr.remove(); updatePurchaseGrandTotal(); });
}
function updatePurchaseRowTotal(tr) {
  const qty = Number(tr.querySelector('.pur-item-qty').value) || 0;
  const price = Number(tr.querySelector('.pur-item-price').value) || 0;
  tr.querySelector('.line-total').textContent = money(qty * price);
  updatePurchaseGrandTotal();
}
function updatePurchaseGrandTotal() {
  let total = 0;
  qsa('#purchaseItemsBody tr').forEach(tr => { total += (Number(tr.querySelector('.pur-item-qty').value) || 0) * (Number(tr.querySelector('.pur-item-price').value) || 0); });
  qs('#purchaseGrandTotal').textContent = money(total) + ' أوقية';
  return total;
}
qs('#btnAddPurchaseRow').addEventListener('click', addPurchaseRow);

qs('#btnNewPurchase').addEventListener('click', () => {
  qs('#purSupplier').value = ''; qs('#purDate').value = todayISO(); qs('#purPaidNow').value = 0;
  qs('#purchaseItemsBody').innerHTML = '';
  addPurchaseRow();
  updatePurchaseGrandTotal();
  openModal('modalPurchase');
});

qs('#btnSavePurchase').addEventListener('click', async () => {
  const supplierName = qs('#purSupplier').value.trim();
  const date = qs('#purDate').value || todayISO();
  const paidNow = Number(qs('#purPaidNow').value) || 0;
  const rows = qsa('#purchaseItemsBody tr').map(tr => ({
    item_type: tr.querySelector('.pur-item-type').value,
    item_id: tr.querySelector('.pur-item-select').value,
    quantity: Number(tr.querySelector('.pur-item-qty').value) || 0,
    price: Number(tr.querySelector('.pur-item-price').value) || 0,
  })).filter(r => r.item_id && r.quantity > 0);

  if (!supplierName) { toast('اكتب اسم المورّد', 'error'); return; }
  if (!rows.length) { toast('أضف صنفا واحدا على الأقل', 'error'); return; }

  try {
    let supplier = STATE.suppliers.find(s => s.name === supplierName);
    if (!supplier) {
      supplier = await Api.insert('suppliers', { name: supplierName, phone: '' }, supplierName);
      STATE.suppliers.push(supplier);
      STATE.suppliers.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }
    const total = rows.reduce((s, r) => s + r.quantity * r.price, 0);
    const purchase = await Api.insert('purchases', { supplier_id: supplier.id, supplier_name: supplierName, purchase_date: date, total, item_count: rows.length }, supplierName);

    const itemRows = rows.map(r => {
      const item = r.item_type === 'material' ? STATE.materials.find(m => m.id === r.item_id) : STATE.products.find(p => p.id === r.item_id);
      const nm = item?.name || '';
      return { purchase_id: purchase.id, item_type: r.item_type, item_id: r.item_id, item_name: nm, product_name: nm, quantity: r.quantity, price: r.price, total: r.quantity * r.price };
    });
    await Api.insertMany('purchase_items', itemRows, 'أصناف شراء');
    STATE.purchaseItems.push(...itemRows);

    for (const r of rows) {
      if (r.item_type === 'material') {
        const mat = STATE.materials.find(m => m.id === r.item_id);
        const newAvg = nextAvgCost(mat.quantity, mat.avg_cost, r.quantity, r.price);
        const updated = await Api.update('materials', mat.id, { quantity: Number(mat.quantity) + r.quantity, avg_cost: newAvg });
        STATE.materials = STATE.materials.map(m => m.id === mat.id ? updated : m);
        logMovement('material', mat.id, mat.name, 'in', r.quantity, 'شراء من: ' + supplierName);
      } else {
        const prod = STATE.products.find(p => p.id === r.item_id);
        const newAvg = nextAvgCost(prod.quantity, prod.buy_price, r.quantity, r.price);
        const updated = await Api.update('products', prod.id, { quantity: Number(prod.quantity) + r.quantity, buy_price: newAvg });
        STATE.products = STATE.products.map(p => p.id === prod.id ? updated : p);
        logMovement('product', prod.id, prod.name, 'in', r.quantity, 'شراء من: ' + supplierName);
      }
    }

    if (paidNow > 0) {
      const pay = await Api.insert('supplier_payments', { supplier_id: supplier.id, purchase_id: purchase.id, amount: paidNow, payment_date: date, note: 'دفعة عند الشراء' }, 'دفعة مورّد');
      STATE.supplierPayments.push(pay);
    }

    STATE.purchases.unshift(purchase);
    renderPurchases(); renderMaterials(); renderSimple(); renderMovements(); renderSuppliers(); renderDashboard();
    closeModal('modalPurchase');
    toast('تم حفظ عملية الشراء', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

function renderPurchases() {
  const from = qs('#purchaseFilterFrom').value, to = qs('#purchaseFilterTo').value;
  const rows = STATE.purchases.filter(p => (!from || p.purchase_date >= from) && (!to || p.purchase_date <= to));
  qs('#purchasesEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#purchasesTableBody').innerHTML = rows.map(p => {
    const paid = purchasePaid(p.id);
    const remaining = Number(p.total || 0) - paid;
    return `<tr class="${p.is_cancelled ? 'row-cancelled' : ''}">
      <td class="cell-strong">${p.supplier_name || '—'}</td>
      <td>${p.item_count ?? '—'}</td>
      <td>${fmtDateAr(p.purchase_date)}</td>
      <td>${money(p.total)} أ.م</td>
      <td class="text-success">${money(paid)}</td>
      <td class="${remaining > 0 ? 'text-danger' : ''}">${money(remaining)}</td>
      <td>${p.is_cancelled ? '<span class="badge badge-status-unpaid">ملغاة</span>' : ''}</td>
      <td class="row-actions">
        ${p.is_cancelled ? '' : `<button class="btn-text" onclick="openPaymentModal('purchase','${p.id}','تسجيل دفعة لعملية الشراء')">دفعة</button>
        <button class="btn-text danger" onclick="deletePurchase('${p.id}')">إلغاء</button>`}
        <button class="btn-text danger" onclick="deletePurchaseForever('${p.id}')">حذف نهائي</button>
      </td>
    </tr>`;
  }).join('');
}
['purchaseFilterFrom', 'purchaseFilterTo'].forEach(id => qs('#' + id).addEventListener('input', renderPurchases));

/* عكس أثر مشتريات ملغاة/محذوفة على المخزون: تُخصم الكمية التي أضافتها هذه العملية
   من المادة أو المنتج (لا تنزل تحت الصفر)، ويُسجَّل ذلك كحركة خروج في المخزون. */
async function reversePurchaseStock(purchaseId, note) {
  const items = STATE.purchaseItems.filter(it => it.purchase_id === purchaseId);
  for (const it of items) {
    const qty = Number(it.quantity || 0);
    if (qty <= 0) continue;
    if (it.item_type === 'material') {
      const mat = STATE.materials.find(m => m.id === it.item_id);
      if (mat) {
        const newQty = Math.max(0, Number(mat.quantity || 0) - qty);
        const updated = await Api.update('materials', mat.id, { quantity: newQty });
        STATE.materials = STATE.materials.map(m => m.id === mat.id ? updated : m);
        logMovement('material', mat.id, mat.name, 'out', qty, note);
      }
    } else {
      const prod = STATE.products.find(p => p.id === it.item_id);
      if (prod) {
        const newQty = Math.max(0, Number(prod.quantity || 0) - qty);
        const updated = await Api.update('products', prod.id, { quantity: newQty });
        STATE.products = STATE.products.map(p => p.id === prod.id ? updated : p);
        logMovement('product', prod.id, prod.name, 'out', qty, note);
      }
    }
  }
}

window.deletePurchase = async function (id) {
  if (!requireManager('إلغاء عمليات الشراء')) return;
  const pur = STATE.purchases.find(p => p.id === id);
  if (pur && pur.is_cancelled) { toast('عملية الشراء هذه ملغاة أصلا', 'error'); return; }
  if (!confirm('هل تريد إلغاء عملية الشراء هذه؟ ستبقى محفوظة للمراجعة، ولن تُحتسب ضمن المشتريات، وستُخصم الكمية التي أضافتها من المخزون.')) return;
  try {
    await reversePurchaseStock(id, 'إلغاء عملية شراء من: ' + (pur ? pur.supplier_name : ''));
    const patch = { is_cancelled: true, cancelled_at: new Date().toISOString(), cancelled_by: STATE.userEmail || null };
    const updated = await Api.update('purchases', id, patch, 'إلغاء عملية شراء');
    STATE.purchases = STATE.purchases.map(p => p.id === id ? updated : p);
    renderPurchases(); renderMaterials(); renderSimple(); renderSuppliers(); renderDashboard(); renderMovements();
    toast('تم إلغاء عملية الشراء وخصم الكمية من المخزون', 'success');
  } catch (err) { toast('تعذر الإلغاء: ' + err.message, 'error'); }
};

window.deletePurchaseForever = async function (id) {
  if (!requireManager('الحذف النهائي لعمليات الشراء')) return;
  const pur = STATE.purchases.find(p => p.id === id);
  if (!pur) return;
  const paidAmt = purchasePaid(id);
  const warn = paidAmt > 0 ? `\n\nتنبيه: على هذه العملية دفعات مسجّلة بقيمة ${money(paidAmt)} أوقية، وستُحذف معها نهائياً.` : '';
  if (!confirm(`حذف نهائي لعملية الشراء من ${pur.supplier_name || '—'} — لا يمكن التراجع عن هذا الإجراء.${warn}\n\nهل أنت متأكد؟`)) return;
  try {
    if (!pur.is_cancelled) {
      await reversePurchaseStock(id, 'حذف نهائي لعملية شراء من: ' + (pur.supplier_name || ''));
    }
    await Api.removeWhere('supplier_payments', 'purchase_id', id);
    await Api.removeWhere('purchase_items', 'purchase_id', id);
    await Api.remove('purchases', id, 'حذف نهائي لعملية شراء');
    STATE.supplierPayments = STATE.supplierPayments.filter(p => p.purchase_id !== id);
    STATE.purchaseItems = STATE.purchaseItems.filter(it => it.purchase_id !== id);
    STATE.purchases = STATE.purchases.filter(p => p.id !== id);
    renderPurchases(); renderMaterials(); renderSimple(); renderSuppliers(); renderDashboard(); renderMovements();
    toast('تم حذف عملية الشراء نهائياً', 'success');
  } catch (err) { toast(friendlyDeleteError(err), 'error'); }
};

/* =========================================================
   المصروفات والعمال
   ========================================================= */
function employeeOptions() {
  return `<option value="">اختر موظفا…</option>` + STATE.employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
}
qs('#expCategory').addEventListener('change', (e) => {
  const show = e.target.value === 'رواتب';
  qs('#expEmployeeField').style.display = show ? '' : 'none';
  if (show) qs('#expEmployee').innerHTML = employeeOptions();
});

function renderExpenses() {
  const from = qs('#expenseFilterFrom').value, to = qs('#expenseFilterTo').value;
  const rows = STATE.expenses.filter(e => (!from || e.expense_date >= from) && (!to || e.expense_date <= to));
  qs('#expensesEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#expensesTableBody').innerHTML = rows.map(e => `
    <tr class="${e.is_cancelled ? 'row-cancelled' : ''}">
      <td class="cell-strong">${e.description}</td>
      <td><span class="badge badge-cat">${e.category || 'أخرى'}</span></td>
      <td>${money(e.amount)} أ.م</td>
      <td>${fmtDateAr(e.expense_date)}</td>
      <td>${e.is_cancelled ? '<span class="badge badge-status-unpaid">ملغى</span>' : ''}</td>
      <td class="row-actions">
        ${e.is_cancelled ? '' : `<button class="btn-text" onclick="editExpense('${e.id}')">تعديل</button>
        <button class="btn-text danger" onclick="deleteExpense('${e.id}')">إلغاء</button>`}
      </td>
    </tr>`).join('');
}
['expenseFilterFrom', 'expenseFilterTo'].forEach(id => qs('#' + id).addEventListener('input', renderExpenses));

function openExpenseModal({ title = 'مصروف جديد', id = '', description = '', category = 'إيجار', employeeId = '', amount = '', date = todayISO() } = {}) {
  qs('#expenseModalTitle').textContent = title;
  qs('#expId').value = id; qs('#expDescription').value = description; qs('#expCategory').value = category;
  qs('#expAmount').value = amount; qs('#expDate').value = date;
  const showEmp = category === 'رواتب';
  qs('#expEmployeeField').style.display = showEmp ? '' : 'none';
  if (showEmp) { qs('#expEmployee').innerHTML = employeeOptions(); if (employeeId) qs('#expEmployee').value = employeeId; }
  openModal('modalExpense');
}
qs('#btnNewExpense').addEventListener('click', () => openExpenseModal());

window.editExpense = function (id) {
  const e = STATE.expenses.find(x => x.id === id);
  if (!e) return;
  openExpenseModal({ title: 'تعديل مصروف', id: e.id, description: e.description, category: e.category || 'أخرى', employeeId: e.employee_id || '', amount: e.amount, date: e.expense_date });
};

window.deleteExpense = async function (id) {
  if (!requireManager('إلغاء المصروفات')) return;
  const exp = STATE.expenses.find(e => e.id === id);
  if (exp && exp.is_cancelled) { toast('هذا المصروف ملغى أصلا', 'error'); return; }
  if (!confirm('هل تريد إلغاء هذا المصروف؟ سيبقى محفوظا للمراجعة ولن يُحتسب ضمن المصروفات.')) return;
  try {
    const patch = { is_cancelled: true, cancelled_at: new Date().toISOString(), cancelled_by: STATE.userEmail || null };
    const updated = await Api.update('expenses', id, patch, 'إلغاء مصروف');
    STATE.expenses = STATE.expenses.map(e => e.id === id ? updated : e);
    renderExpenses(); renderEmployees(); renderDashboard();
    toast('تم إلغاء المصروف', 'success');
  } catch (err) { toast('تعذر الإلغاء: ' + err.message, 'error'); }
};

qs('#btnSaveExpense').addEventListener('click', async () => {
  const id = qs('#expId').value;
  const category = qs('#expCategory').value;
  const payload = {
    description: qs('#expDescription').value.trim(), category,
    amount: Number(qs('#expAmount').value) || 0, expense_date: qs('#expDate').value || todayISO(),
    employee_id: category === 'رواتب' ? (qs('#expEmployee').value || null) : null,
  };
  if (!payload.description) { toast('اكتب بيان المصروف', 'error'); return; }
  try {
    if (id) {
      const updated = await Api.update('expenses', id, payload, payload.description);
      STATE.expenses = STATE.expenses.map(e => e.id === id ? updated : e);
    } else {
      const created = await Api.insert('expenses', payload, payload.description);
      STATE.expenses.unshift(created);
    }
    renderExpenses(); renderEmployees(); renderDashboard();
    closeModal('modalExpense');
    toast('تم حفظ المصروف', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

/* ---------- الموظفون ---------- */
function renderEmployees() {
  qs('#employeesEmptyHint').style.display = STATE.employees.length ? 'none' : 'block';
  qs('#employeesTableBody').innerHTML = STATE.employees.map(emp => {
    const payments = STATE.expenses.filter(e => e.employee_id === emp.id);
    const total = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const last = payments.sort((a, b) => (b.expense_date || '').localeCompare(a.expense_date || ''))[0];
    return `<tr>
      <td class="cell-strong">${emp.name}</td>
      <td>${money(total)} أ.م</td>
      <td>${last ? fmtDateAr(last.expense_date) : '—'}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="openEmployeePayment('${emp.id}')">دفعة جديدة</button>
        <button class="btn-text" onclick="viewEmployeeHistory('${emp.id}')">السجل</button>
        <button class="btn-text danger" onclick="deleteEmployee('${emp.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}
qs('#btnNewEmployee').addEventListener('click', () => { qs('#employeeForm').reset(); openModal('modalEmployee'); });
qs('#btnSaveEmployee').addEventListener('click', async () => {
  const name = qs('#empName').value.trim();
  if (!name) { toast('اكتب اسم الموظف', 'error'); return; }
  try {
    const created = await Api.insert('employees', { name }, name);
    STATE.employees.push(created);
    STATE.employees.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    renderEmployees();
    closeModal('modalEmployee');
    toast('تم إضافة الموظف', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});
window.openEmployeePayment = function (empId) {
  const emp = STATE.employees.find(e => e.id === empId);
  if (!emp) return;
  openExpenseModal({ title: 'دفعة لـ ' + emp.name, description: 'دفعة لـ ' + emp.name, category: 'رواتب', employeeId: empId, amount: '' });
};
window.viewEmployeeHistory = function (empId) {
  const emp = STATE.employees.find(e => e.id === empId);
  if (!emp) return;
  qs('#empHistoryTitle').textContent = 'سجل مدفوعات: ' + emp.name;
  const payments = STATE.expenses.filter(e => e.employee_id === empId).sort((a, b) => (b.expense_date || '').localeCompare(a.expense_date || ''));
  qs('#empHistoryList').innerHTML = payments.length ? payments.map(p => `
    <div class="mini-row"><div><div class="mini-row-title">${fmtDateAr(p.expense_date)}</div></div><div class="mini-row-value">${money(p.amount)} أ.م</div></div>
  `).join('') : `<p class="mini-empty">لا يوجد سجل مدفوعات بعد</p>`;
  openModal('modalEmployeeHistory');
};
window.deleteEmployee = async function (id) {
  if (!requireManager('حذف الموظفين')) return;
  if (!confirm('هل تريد حذف هذا الموظف؟ (تبقى المصروفات السابقة مسجلة)')) return;
  try {
    await Api.remove('employees', id, 'موظف');
    STATE.employees = STATE.employees.filter(e => e.id !== id);
    renderEmployees();
    toast('تم حذف الموظف', 'success');
  } catch (err) { toast(friendlyDeleteError(err), 'error'); }
};

/* =========================================================
   العملاء
   ========================================================= */
function renderCustomers(filter = '') {
  const rows = STATE.customers.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));
  qs('#customersEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#customersTableBody').innerHTML = rows.map(c => {
    const b = customerBalance(c.id);
    return `<tr>
      <td class="cell-strong">${c.name}</td>
      <td>${c.phone || '—'}</td>
      <td>${money(b.invoiced)} أ.م</td>
      <td class="text-success">${money(b.paid)}</td>
      <td class="${b.remaining > 0 ? 'text-danger' : ''}">${money(b.remaining)}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="viewCustomerHistory('${c.id}')">كشف الحساب</button>
        <button class="btn-text" onclick="openPaymentModal('customer','${c.id}','تسجيل دفعة من ${c.name}')">دفعة</button>
        <button class="btn-text" onclick="editCustomer('${c.id}')">تعديل</button>
        <button class="btn-text danger" onclick="deleteCustomer('${c.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}
qs('#customerSearch').addEventListener('input', (e) => renderCustomers(e.target.value));
qs('#btnNewCustomer').addEventListener('click', () => {
  qs('#customerModalTitle').textContent = 'عميل جديد'; qs('#customerForm').reset(); qs('#custId').value = '';
  openModal('modalCustomer');
});
window.editCustomer = function (id) {
  const c = STATE.customers.find(x => x.id === id);
  if (!c) return;
  qs('#customerModalTitle').textContent = 'تعديل عميل'; qs('#custId').value = c.id; qs('#custName').value = c.name; qs('#custPhone').value = c.phone || '';
  openModal('modalCustomer');
};
window.deleteCustomer = async function (id) {
  if (!requireManager('حذف العملاء')) return;
  if (!confirm('هل تريد حذف هذا العميل؟')) return;
  try {
    await Api.remove('customers', id, 'عميل');
    STATE.customers = STATE.customers.filter(c => c.id !== id);
    renderCustomers(); fillDatalists();
    toast('تم حذف العميل', 'success');
  } catch (err) { toast(friendlyDeleteError(err), 'error'); }
};
qs('#btnSaveCustomer').addEventListener('click', async () => {
  const id = qs('#custId').value;
  const payload = { name: qs('#custName').value.trim(), phone: qs('#custPhone').value.trim() };
  if (!payload.name) { toast('اكتب اسم العميل', 'error'); return; }
  try {
    if (id) { const updated = await Api.update('customers', id, payload, payload.name); STATE.customers = STATE.customers.map(c => c.id === id ? updated : c); }
    else { const created = await Api.insert('customers', payload, payload.name); STATE.customers.push(created); }
    STATE.customers.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    renderCustomers(); fillDatalists();
    closeModal('modalCustomer');
    toast('تم حفظ العميل', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

window.viewCustomerHistory = function (id) {
  const c = STATE.customers.find(x => x.id === id);
  if (!c) return;
  qs('#custHistoryTitle').textContent = 'كشف حساب: ' + c.name;
  const b = customerBalance(id);
  qs('#custHistoryRemaining').textContent = money(b.remaining) + ' أوقية';
  const debits = activeInvoices().filter(i => i.customer_id === id).map(i => ({ date: i.invoice_date, label: 'فاتورة #' + i.invoice_number, amount: Number(i.total), type: 'debit' }));
  const credits = STATE.customerPayments.filter(p => p.customer_id === id).map(p => ({ date: p.payment_date, label: p.note || 'دفعة', amount: Number(p.amount), type: 'credit' }));
  const all = [...debits, ...credits].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  qs('#custHistoryList').innerHTML = all.length ? all.map(x => `
    <div class="mini-row ${x.type}"><div><div class="mini-row-title">${x.label}</div><div class="mini-row-sub">${fmtDateAr(x.date)}</div></div>
    <div class="mini-row-value">${x.type === 'debit' ? '+' : '-'}${money(x.amount)} أ.م</div></div>
  `).join('') : `<p class="mini-empty">لا يوجد سجل بعد</p>`;
  openModal('modalCustomerHistory');
};

/* =========================================================
   الموردون
   ========================================================= */
function renderSuppliers(filter = '') {
  const rows = STATE.suppliers.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()));
  qs('#suppliersEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#suppliersTableBody').innerHTML = rows.map(s => {
    const b = supplierBalance(s.id);
    return `<tr>
      <td class="cell-strong">${s.name}</td>
      <td>${s.phone || '—'}</td>
      <td>${money(b.purchased)} أ.م</td>
      <td class="text-success">${money(b.paid)}</td>
      <td class="${b.remaining > 0 ? 'text-danger' : ''}">${money(b.remaining)}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="viewSupplierHistory('${s.id}')">كشف الحساب</button>
        <button class="btn-text" onclick="openPaymentModal('supplier','${s.id}','تسجيل دفعة لـ ${s.name}')">دفعة</button>
        <button class="btn-text" onclick="editSupplier('${s.id}')">تعديل</button>
        <button class="btn-text danger" onclick="deleteSupplier('${s.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}
qs('#supplierSearch').addEventListener('input', (e) => renderSuppliers(e.target.value));
qs('#btnNewSupplier').addEventListener('click', () => {
  qs('#supplierModalTitle').textContent = 'مورّد جديد'; qs('#supplierForm').reset(); qs('#supId').value = '';
  openModal('modalSupplier');
});
window.editSupplier = function (id) {
  const s = STATE.suppliers.find(x => x.id === id);
  if (!s) return;
  qs('#supplierModalTitle').textContent = 'تعديل مورّد'; qs('#supId').value = s.id; qs('#supName').value = s.name; qs('#supPhone').value = s.phone || '';
  openModal('modalSupplier');
};
window.deleteSupplier = async function (id) {
  if (!requireManager('حذف الموردين')) return;
  if (!confirm('هل تريد حذف هذا المورّد؟')) return;
  try {
    await Api.remove('suppliers', id, 'مورّد');
    STATE.suppliers = STATE.suppliers.filter(s => s.id !== id);
    renderSuppliers(); fillDatalists();
    toast('تم حذف المورّد', 'success');
  } catch (err) { toast(friendlyDeleteError(err), 'error'); }
};
qs('#btnSaveSupplier').addEventListener('click', async () => {
  const id = qs('#supId').value;
  const payload = { name: qs('#supName').value.trim(), phone: qs('#supPhone').value.trim() };
  if (!payload.name) { toast('اكتب اسم المورّد', 'error'); return; }
  try {
    if (id) { const updated = await Api.update('suppliers', id, payload, payload.name); STATE.suppliers = STATE.suppliers.map(s => s.id === id ? updated : s); }
    else { const created = await Api.insert('suppliers', payload, payload.name); STATE.suppliers.push(created); }
    STATE.suppliers.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    renderSuppliers(); fillDatalists();
    closeModal('modalSupplier');
    toast('تم حفظ المورّد', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

window.viewSupplierHistory = function (id) {
  const s = STATE.suppliers.find(x => x.id === id);
  if (!s) return;
  qs('#supHistoryTitle').textContent = 'كشف حساب: ' + s.name;
  const b = supplierBalance(id);
  qs('#supHistoryRemaining').textContent = money(b.remaining) + ' أوقية';
  const debits = activePurchases().filter(p => p.supplier_id === id).map(p => ({ date: p.purchase_date, label: 'شراء بتاريخ ' + fmtDateAr(p.purchase_date), amount: Number(p.total), type: 'debit' }));
  const credits = STATE.supplierPayments.filter(p => p.supplier_id === id).map(p => ({ date: p.payment_date, label: p.note || 'دفعة', amount: Number(p.amount), type: 'credit' }));
  const all = [...debits, ...credits].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  qs('#supHistoryList').innerHTML = all.length ? all.map(x => `
    <div class="mini-row ${x.type}"><div><div class="mini-row-title">${x.label}</div><div class="mini-row-sub">${fmtDateAr(x.date)}</div></div>
    <div class="mini-row-value">${x.type === 'debit' ? '+' : '-'}${money(x.amount)} أ.م</div></div>
  `).join('') : `<p class="mini-empty">لا يوجد سجل بعد</p>`;
  openModal('modalSupplierHistory');
};

/* =========================================================
   نافذة دفعة عامة (عميل / مورّد / فاتورة / شراء)
   ========================================================= */
window.openPaymentModal = function (targetType, targetId, title) {
  qs('#paymentModalTitle').textContent = title || 'تسجيل دفعة';
  qs('#payTargetType').value = targetType; qs('#payTargetId').value = targetId;
  qs('#payAmount').value = ''; qs('#payDate').value = todayISO(); qs('#payNote').value = '';
  openModal('modalPayment');
};
qs('#btnSavePayment').addEventListener('click', async () => {
  const targetType = qs('#payTargetType').value, targetId = qs('#payTargetId').value;
  const amount = Number(qs('#payAmount').value) || 0;
  const date = qs('#payDate').value || todayISO();
  const note = qs('#payNote').value.trim();
  if (amount <= 0) { toast('أدخل مبلغا صحيحا', 'error'); return; }
  try {
    if (targetType === 'invoice') {
      const inv = STATE.invoices.find(i => i.id === targetId);
      const remaining = Number(inv.total || 0) - invoicePaid(inv.id);
      if (amount > remaining + 0.009) {
        toast(`المبلغ أكبر من المتبقي على الفاتورة (${money(remaining)} أ.م)`, 'error');
        return;
      }
      const pay = await Api.insert('customer_payments', { customer_id: inv.customer_id, invoice_id: inv.id, amount, payment_date: date, note: note || 'دفعة' }, 'دفعة عميل');
      STATE.customerPayments.push(pay);
      renderInvoices();
    } else if (targetType === 'customer') {
      const pay = await Api.insert('customer_payments', { customer_id: targetId, invoice_id: null, amount, payment_date: date, note: note || 'دفعة' }, 'دفعة عميل');
      STATE.customerPayments.push(pay);
    } else if (targetType === 'purchase') {
      const pur = STATE.purchases.find(p => p.id === targetId);
      const pay = await Api.insert('supplier_payments', { supplier_id: pur.supplier_id, purchase_id: pur.id, amount, payment_date: date, note: note || 'دفعة' }, 'دفعة مورّد');
      STATE.supplierPayments.push(pay);
      renderPurchases();
    } else if (targetType === 'supplier') {
      const pay = await Api.insert('supplier_payments', { supplier_id: targetId, purchase_id: null, amount, payment_date: date, note: note || 'دفعة' }, 'دفعة مورّد');
      STATE.supplierPayments.push(pay);
    }
    renderCustomers(); renderSuppliers(); renderDashboard();
    closeModal('modalPayment');
    toast('تم تسجيل الدفعة', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

/* =========================================================
   التقارير
   ========================================================= */
function renderRankedList(sel, obj, unit, desc) {
  const arr = Object.entries(obj).map(([name, qty]) => ({ name, qty }));
  arr.sort((a, b) => desc ? b.qty - a.qty : a.qty - b.qty);
  const top = arr.slice(0, 8);
  qs(sel).innerHTML = top.length ? top.map(x => `<div class="mini-row"><div class="mini-row-title">${x.name}</div><div class="mini-row-value">${x.qty} ${unit}</div></div>`).join('') : `<p class="mini-empty">لا توجد بيانات كافية</p>`;
}

function runReport() {
  const from = qs('#reportFilterFrom').value, to = qs('#reportFilterTo').value;
  const invDateById = {};
  activeInvoices().forEach(i => invDateById[i.id] = i.invoice_date);
  const itemsInRange = STATE.invoiceItems.filter(it => {
    const d = invDateById[it.invoice_id];
    return d && (!from || d >= from) && (!to || d <= to);
  });

  const cats = ['جملة', 'فردي', 'عادي'];
  const byCat = {}; cats.forEach(c => byCat[c] = { sales: 0, cost: 0 });
  itemsInRange.forEach(it => {
    const cat = byCat[it.category] ? it.category : 'عادي';
    byCat[cat].sales += Number(it.price) * Number(it.quantity);
    byCat[cat].cost += Number(it.cost_price) * Number(it.quantity);
  });
  let grossProfit = 0;
  qs('#profitReportBody').innerHTML = cats.map(c => {
    const v = byCat[c]; const profit = v.sales - v.cost; grossProfit += profit;
    return `<tr><td class="cell-strong">${c}</td><td>${money(v.sales)}</td><td>${money(v.cost)}</td><td>${money(profit)}</td></tr>`;
  }).join('') + `<tr style="font-weight:800;background:#f9f7f2;"><td>الإجمالي</td><td>${money(cats.reduce((s, c) => s + byCat[c].sales, 0))}</td><td>${money(cats.reduce((s, c) => s + byCat[c].cost, 0))}</td><td>${money(grossProfit)}</td></tr>`;

  const lossesTotal = STATE.losses.filter(l => (!from || l.loss_date >= from) && (!to || l.loss_date <= to)).reduce((s, l) => s + Number(l.total_cost || 0), 0);
  const expensesTotal = activeExpenses().filter(e => (!from || e.expense_date >= from) && (!to || e.expense_date <= to)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const netProfit = grossProfit - lossesTotal - expensesTotal;
  qs('#repGrossProfit').textContent = money(grossProfit);
  qs('#repLossesTotal').textContent = money(lossesTotal);
  qs('#repExpensesTotal').textContent = money(expensesTotal);
  qs('#repNetProfit').textContent = money(netProfit);

  const custDebts = STATE.customers.map(c => ({ name: c.name, qty: customerBalance(c.id).remaining })).filter(x => x.qty > 0.01);
  renderRankedList('#repCustomerDebts', Object.fromEntries(custDebts.map(x => [x.name, Math.round(x.qty * 100) / 100])), 'أ.م', true);
  const supDebts = STATE.suppliers.map(s => ({ name: s.name, qty: supplierBalance(s.id).remaining })).filter(x => x.qty > 0.01);
  renderRankedList('#repSupplierDebts', Object.fromEntries(supDebts.map(x => [x.name, Math.round(x.qty * 100) / 100])), 'أ.م', true);

  const soldQty = {};
  itemsInRange.forEach(it => { soldQty[it.product_name] = (soldQty[it.product_name] || 0) + Number(it.quantity || 0); });
  renderRankedList('#repTopSelling', soldQty, 'وحدة', true);

  const invValues = {};
  STATE.materials.forEach(m => { const v = Number(m.quantity) * Number(m.avg_cost); if (v > 0) invValues[m.name] = Math.round(v * 100) / 100; });
  STATE.products.filter(p => p.type === 'simple').forEach(p => { const v = Number(p.quantity) * Number(p.buy_price); if (v > 0) invValues[p.name] = Math.round(v * 100) / 100; });
  renderRankedList('#repInventoryValue', invValues, 'أ.م', true);

  STATE._reportCache = { from, to, byCat, grossProfit, lossesTotal, expensesTotal, netProfit, custDebts, supDebts, soldQty };
}
qs('#btnRunReport').addEventListener('click', runReport);

qs('#btnExportReports').addEventListener('click', () => {
  const c = STATE._reportCache;
  if (!c) { toast('اضغط "تحديث التقرير" أولا', 'error'); return; }
  const rows = [
    { البند: 'مبيعات الجملة', القيمة: c.byCat['جملة'].sales.toFixed(2) },
    { البند: 'تكلفة الجملة', القيمة: c.byCat['جملة'].cost.toFixed(2) },
    { البند: 'مبيعات الفردي', القيمة: c.byCat['فردي'].sales.toFixed(2) },
    { البند: 'تكلفة الفردي', القيمة: c.byCat['فردي'].cost.toFixed(2) },
    { البند: 'مبيعات العادي', القيمة: c.byCat['عادي'].sales.toFixed(2) },
    { البند: 'تكلفة العادي', القيمة: c.byCat['عادي'].cost.toFixed(2) },
    { البند: 'إجمالي الربح قبل المصروفات', القيمة: c.grossProfit.toFixed(2) },
    { البند: 'الخسائر والتالف', القيمة: c.lossesTotal.toFixed(2) },
    { البند: 'المصروفات العامة', القيمة: c.expensesTotal.toFixed(2) },
    { البند: 'صافي ربح المؤسسة', القيمة: c.netProfit.toFixed(2) },
    ...c.custDebts.map(x => ({ البند: 'دين عميل: ' + x.name, القيمة: x.qty.toFixed(2) })),
    ...c.supDebts.map(x => ({ البند: 'دين مورّد: ' + x.name, القيمة: x.qty.toFixed(2) })),
  ];
  exportCSV(`تقرير_زروق_${todayISO()}.csv`, rows);
});

/* =========================================================
   الإعدادات والصلاحيات
   ========================================================= */
function renderSettings() {
  const s = STATE.settings || {};
  qs('#setCompanyName').value = s.company_name || 'مؤسسة زروق للخدمات المطبعية';
  qs('#setPhone').value = s.phone || '';
  qs('#setAddress').value = s.address || '';
  qs('#setLogoUrl').value = s.logo_url || '';
  qs('#logoPreview').src = s.logo_url || '';
  applyRoleUI();
}
qs('#setLogoUrl').addEventListener('input', (e) => { qs('#logoPreview').src = e.target.value; });

qs('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    company_name: qs('#setCompanyName').value.trim(), phone: qs('#setPhone').value.trim(),
    address: qs('#setAddress').value.trim(), logo_url: qs('#setLogoUrl').value.trim(),
  };
  try {
    if (STATE.settings?.id) STATE.settings = await Api.update('settings', STATE.settings.id, payload, 'إعدادات المؤسسة');
    else STATE.settings = await Api.insert('settings', payload, 'إعدادات المؤسسة');
    toast('تم حفظ إعدادات المؤسسة', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

function renderAuditLog() {
  qs('#auditLogList').innerHTML = STATE.auditLog.length ? STATE.auditLog.map(a => `
    <div class="mini-row">
      <div><div class="mini-row-title">${a.action} — ${a.entity}${a.entity_label ? ' (' + a.entity_label + ')' : ''}</div>
      <div class="mini-row-sub">بواسطة: ${a.role === 'manager' ? 'مدير' : 'محاسب'}${a.user_email ? ' — ' + a.user_email : ''}</div></div>
      <div class="mini-row-value" style="font-weight:600;font-size:11.5px;">${new Date(a.created_at).toLocaleString('ar-MA')}</div>
    </div>`).join('') : `<p class="mini-empty">لا توجد عمليات مسجلة بعد</p>`;
}

/* ---------- قوائم Datalist ---------- */
function fillDatalists() {
  qs('#customerNamesList').innerHTML = STATE.customers.map(c => `<option value="${c.name}">`).join('');
  qs('#supplierNamesList').innerHTML = STATE.suppliers.map(s => `<option value="${s.name}">`).join('');
}

/* =========================================================
   بدء التشغيل — يتحقق أولا من وجود جلسة دخول حقيقية
   ========================================================= */
async function init() {
  try {
    const yearEl = qs('#yearNow'); if (yearEl) yearEl.textContent = new Date().getFullYear();
    const invDateEl = qs('#invDate'); if (invDateEl) invDateEl.value = todayISO();
    const purDateEl = qs('#purDate'); if (purDateEl) purDateEl.value = todayISO();
    initSubtabs();

    const { data } = await window.db.auth.getSession();
    if (data.session) {
      await bootAfterLogin(data.session);
    } else {
      showLoginGate();
    }
  } catch (err) {
    /* أي خطأ غير متوقع هنا كان سابقاً يُعلّق شاشة التحميل إلى الأبد؛
       الآن نسجّله ونعرض بوابة الدخول بدل التعليق الصامت */
    console.error('فشل بدء التشغيل:', err);
    showLoginGate('تعذر بدء التشغيل: ' + (err && err.message ? err.message : err));
  } finally {
    const loaderEl = qs('#loader'); if (loaderEl) loaderEl.classList.add('hide');
  }
}
init();
