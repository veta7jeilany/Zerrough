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

window.printInvoice = function (invoiceId) {
  const inv = STATE.invoices.find(i => i.id === invoiceId);
  if (!inv) return;
  const items = STATE.invoiceItems.filter(it => it.invoice_id === invoiceId);
  const paidAmt = invoicePaid(invoiceId);
  const remainingAmt = Number(inv.total || 0) - paidAmt;
  const badge = invoicePrintStatusBadge(inv);
  const s = STATE.settings || {};
  const logoSrc = s.logo_url || ('data:image/png;base64,' + ZAROUQ_LOGO_B64);
  const customer = STATE.customers.find(c => c.name === inv.customer_name);
  const customerPhone = customer && customer.phone ? customer.phone : '';

  const rowsHtml = items.map((it, idx) => `
    <tr style="background:${idx % 2 ? '#eef2fb' : '#ffffff'};">
      <td style="padding:10px 8px;text-align:center;border:1px solid #dbe2f0;color:#1857b0;font-weight:700;">${idx + 1}</td>
      <td style="padding:10px 8px;border:1px solid #dbe2f0;">${it.product_name}</td>
      <td style="padding:10px 8px;text-align:center;border:1px solid #dbe2f0;">${fmtQty(it.quantity)}</td>
      <td style="padding:10px 8px;text-align:center;border:1px solid #dbe2f0;">${money(it.price)}</td>
      <td style="padding:10px 8px;text-align:center;border:1px solid #dbe2f0;font-weight:700;">${money(it.total)}</td>
    </tr>`).join('');

  qs('#printArea').innerHTML = `
  <div style="max-width:800px;margin:0 auto;font-family:'Cairo','Tahoma',sans-serif;color:#16213e;direction:rtl;position:relative;overflow:hidden;">

    <!-- ====== شريط زخرفي قطري أعلى اليمين ====== -->
    <div style="position:absolute;top:-40px;right:-70px;width:230px;height:230px;background:#dce6fa;clip-path:polygon(30% 0,100% 0,100% 100%);z-index:0;"></div>
    <div style="position:absolute;top:-40px;right:-70px;width:230px;height:230px;background:linear-gradient(135deg,#1857b0,#123a7a);clip-path:polygon(55% 0,100% 0,100% 70%);z-index:0;"></div>

    <div style="position:relative;z-index:1;padding:6px 4px 0;">

    <!-- ====== الترويسة ====== -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
      <div style="flex:1;text-align:right;padding-top:6px;">
        <h1 style="margin:0;font-size:23px;color:#123a7a;font-weight:800;">${s.company_name || 'مؤسسة زروق للطباعة وملابس التخرج'}</h1>
        <p style="margin:6px 0 0;font-size:12px;color:#1857b0;font-weight:700;">${s.tagline || 'طباعة رقمية&nbsp;&nbsp;•&nbsp;&nbsp;ملابس التخرج&nbsp;&nbsp;•&nbsp;&nbsp;دروع التكريم'}</p>
        <p style="margin:2px 0 0;font-size:12px;color:#1857b0;font-weight:700;">${s.tagline2 || 'الهدايا الإشهارية'}</p>
        ${s.address ? `<p style="margin:8px 0 0;font-size:12px;color:#555;">📍 ${s.address}</p>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:14px;flex-shrink:0;">
        <div style="width:2px;align-self:stretch;background:#cdd7ee;"></div>
        <img src="${logoSrc}" style="height:82px;object-fit:contain;">
      </div>
    </div>

    <!-- ====== عنوان الفاتورة ====== -->
    <div style="display:flex;align-items:center;gap:14px;margin:22px 0 20px;">
      <div style="flex:1;height:2px;background:#1857b0;"></div>
      <div style="text-align:center;">
        <div style="font-size:26px;font-weight:800;color:#123a7a;">فاتورة مبيعات</div>
        <div style="font-size:12px;letter-spacing:3px;color:#1857b0;margin-top:2px;">SALES INVOICE</div>
      </div>
      <div style="flex:1;height:2px;background:#1857b0;"></div>
    </div>

    <!-- ====== معلومات العميل والفاتورة ====== -->
    <div style="display:flex;gap:14px;margin-bottom:18px;">
      <div style="flex:1;border:1px solid #cdd7ee;border-radius:8px;padding:12px 14px;font-size:12.5px;">
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#555;">اسم العميل</span><strong>${inv.customer_name || '—'}</strong></div>
        ${customerPhone ? `<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#555;">رقم الهاتف</span><strong>${customerPhone}</strong></div>` : ''}
      </div>
      <div style="flex:1;border:1px solid #cdd7ee;border-radius:8px;padding:12px 14px;font-size:12.5px;">
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#555;">رقم الفاتورة</span><strong>${inv.invoice_number}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:#555;">التاريخ</span><strong>${fmtDateAr(inv.invoice_date)}</strong></div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;"><span style="color:#555;">حالة الدفع</span>
          <span style="background:${badge.bg};color:#fff;padding:2px 14px;border-radius:20px;font-weight:700;font-size:11.5px;">${badge.label}</span>
        </div>
      </div>
    </div>

    <!-- ====== جدول الأصناف ====== -->
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:18px;">
      <thead>
        <tr style="background:#123a7a;color:#fff;">
          <th style="padding:9px 8px;">م</th>
          <th style="padding:9px 8px;">الصنف / الوصف</th>
          <th style="padding:9px 8px;">الكمية</th>
          <th style="padding:9px 8px;">سعر الوحدة</th>
          <th style="padding:9px 8px;">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <!-- ====== الإجمالي والملاحظات ====== -->
    <div style="display:flex;gap:14px;">
      <div style="flex:1;border:1px solid #cdd7ee;border-radius:8px;overflow:hidden;font-size:13px;">
        <div style="display:flex;justify-content:space-between;padding:9px 14px;background:#eef2fb;"><span>المجموع الكلي</span><strong>${money(inv.total)} أوقية</strong></div>
        <div style="display:flex;justify-content:space-between;padding:9px 14px;"><span>المبلغ المدفوع</span><strong style="color:#1a7f37;">${money(paidAmt)} أوقية</strong></div>
        <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#123a7a;color:#fff;"><span>المتبقي</span><strong>${money(remainingAmt)} أوقية</strong></div>
      </div>
      <div style="flex:1;border:1px solid #cdd7ee;border-radius:8px;padding:12px 14px;font-size:11.5px;color:#444;">
        <div style="font-weight:800;color:#123a7a;margin-bottom:6px;">ملاحظات</div>
        <div style="line-height:1.9;">
          • شكرا لاختياركم مؤسسة زروق.<br>
          • يرجى التأكد من صحة البيانات قبل استلام الطلب.<br>
          • يمكنكم التواصل معنا في أي وقت عبر وسائل الاتصال المذكورة.
        </div>
      </div>
    </div>

    <!-- ====== التذييل ====== -->
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:30px;padding-top:14px;border-top:1px solid #cdd7ee;font-size:11.5px;color:#444;">
      <div style="text-align:center;">
        <div style="margin-bottom:34px;">ختم وتوقيع المؤسسة</div>
        <div style="width:160px;border-top:1px solid #999;"></div>
      </div>
      <div style="text-align:left;">
        ${s.phone ? `<div>📞 ${s.phone}</div>` : ''}
        ${s.address ? `<div style="margin-top:2px;">📍 ${s.address}</div>` : ''}
        <div style="margin-top:2px;font-weight:700;color:#1857b0;">مؤسسة زروق</div>
      </div>
    </div>
    </div>

    <!-- ====== شريط زخرفي قطري أسفل الصفحة ====== -->
    <div style="position:relative;height:34px;margin-top:26px;background:linear-gradient(100deg,#123a7a,#1857b0 65%,#2e6fd6);clip-path:polygon(0 40%,100% 0,100% 100%,0 100%);z-index:0;">
      <div style="position:absolute;left:0;bottom:0;width:26px;height:14px;background:#d3402b;clip-path:polygon(0 100%,100% 100%,0 0);"></div>
    </div>
  </div>`;
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
