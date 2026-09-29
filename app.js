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
  qs('#loader').classList.remove('hide');
  try {
    await loadAll();
  } catch (err) {
    console.error(err);
    toast('تعذر تحميل البيانات: تحقق من جداول قاعدة البيانات', 'error');
  } finally {
    qs('#loader').classList.add('hide');
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

window.db.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    STATE.session = null; STATE.role = null; STATE.userEmail = null;
    showLoginGate();
  }
});

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

window.printInvoice = function (invoiceId) {
  const inv = STATE.invoices.find(i => i.id === invoiceId);
  if (!inv) return;
  const items = STATE.invoiceItems.filter(it => it.invoice_id === invoiceId);
  const paidAmt = invoicePaid(invoiceId);
  const remainingAmt = Number(inv.total || 0) - paidAmt;
  const statusInfo = inv.is_cancelled ? { label: 'ملغاة', cls: '' } : invoiceStatusInfo(inv);
  const s = STATE.settings || {};
  const logo = s.logo_url ? `<img src="${s.logo_url}" style="height:64px;object-fit:contain">` : '';
  qs('#printArea').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #33529e;padding-bottom:16px;margin-bottom:20px;">
      <div><h1 style="margin:0;font-size:22px;">${s.company_name || 'مؤسسة زروق للخدمات المطبعية'}</h1>
      <p style="margin:4px 0 0;color:#555;font-size:12.5px;">${s.address || ''} ${s.phone ? ' | هاتف: ' + s.phone : ''}</p></div>
      ${logo}
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:18px;font-size:13.5px;">
      <div><strong>فاتورة رقم:</strong> ${inv.invoice_number}<br><strong>التاريخ:</strong> ${fmtDateAr(inv.invoice_date)}</div>
      <div><strong>العميل:</strong> ${inv.customer_name || '—'}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#f1f1f1;">
        <th style="padding:8px;border:1px solid #ccc;">المنتج</th><th style="padding:8px;border:1px solid #ccc;">الكمية</th>
        <th style="padding:8px;border:1px solid #ccc;">سعر الوحدة</th><th style="padding:8px;border:1px solid #ccc;">الإجمالي</th></tr></thead>
      <tbody>${items.map(it => `<tr>
          <td style="padding:8px;border:1px solid #ccc;">${it.product_name}</td>
          <td style="padding:8px;border:1px solid #ccc;text-align:center;">${it.quantity}</td>
          <td style="padding:8px;border:1px solid #ccc;text-align:center;">${money(it.price)}</td>
          <td style="padding:8px;border:1px solid #ccc;text-align:center;">${money(it.total)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div style="text-align:left;margin-top:16px;font-size:16px;font-weight:bold;">الإجمالي الكلي: ${money(inv.total)} أوقية</div>
    <div style="margin-top:10px;font-size:13.5px;border-top:1px dashed #999;padding-top:10px;">
      <div style="display:flex;justify-content:space-between;padding:3px 0;"><span>المبلغ المدفوع</span><strong style="color:#1a7f37;">${money(paidAmt)} أوقية</strong></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;"><span>المبلغ المتبقي</span><strong style="color:${remainingAmt > 0 ? '#c0392b' : '#1a7f37'};">${money(remainingAmt)} أوقية</strong></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;"><span>حالة الفاتورة</span><strong>${statusInfo.label}</strong></div>
    </div>
    <p style="margin-top:40px;text-align:center;color:#888;font-size:11.5px;">شكرا لتعاملكم مع ${s.company_name || 'مؤسسة زروق للخدمات المطبعية'}</p>`;
  window.print();
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
  qs('#yearNow').textContent = new Date().getFullYear();
  qs('#invDate').value = todayISO();
  qs('#purDate').value = todayISO();
  initSubtabs();

  const { data } = await window.db.auth.getSession();
  if (data.session) {
    await bootAfterLogin(data.session);
  } else {
    qs('#loader').classList.add('hide');
    showLoginGate();
  }
}
init();
