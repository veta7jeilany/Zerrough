/* =========================================================
   app.js — مؤسسة زروق للخدمات المطبعية
   النسخة المحدّثة: تصنيف المبيعات، المنتجات المصنّعة ووصفاتها،
   المنتجات المركبة، المخزون بالمواد، الخسائر والتالف، الجرد، 
   الموردون، العمال، تقرير الأرباح المفصّل، الصلاحيات الدقيقة.
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

/* ================= الصلاحيات (عبر تسجيل الدخول الحقيقي) ================= */
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

/* حاجز حماية يمنع أي عملية تعديل حساسة أو حذف إن لم يكن المستخدم مديرا */
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
  } catch (e) { /* تجاهل */ }
}

/* ================= طبقة الوصول لقاعدة البيانات ================= */
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
  } catch (e) { /* تجاهل */ }
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

/* ================= المصادقة (Supabase Auth) ================= */
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

/* ================= تحميل كل البيانات ================= */
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

  renderDashboard(); renderInvoices(); renderManufactured(); renderSimple(); renderComposite();
  renderMaterials(); renderMovements(); renderLosses(); renderAdjustments(); renderPurchases();
  renderExpenses(); renderEmployees(); renderCustomers(); renderSuppliers(); renderSettings();
  renderAuditLog(); fillDatalists();
}

/* ================= حسابات مشتركة (أرصدة، تكاليف) ================= */
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
function invoiceStatusInfo(invoice) {
  const total = Number(invoice.total || 0);
  const paid = invoicePaid(invoice.id);
  if (paid <= 0) return { label: 'غير مدفوعة', cls: 'badge-status-unpaid' };
  if (paid >= total - 0.009) return { label: 'مدفوعة بالكامل', cls: 'badge-status-paid' };
  return { label: 'مدفوعة جزئيا', cls: 'badge-status-partial' };
}

/* السجلات "النشطة" فقط (غير الملغاة) */
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
    const day = now.getDay();
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
  return { from: null, to: null };
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

/* ================= المنتجات المركبة (الأطقم) — نظام عام تكراري ================= */
function productUnitCost(product, visited = new Set()) {
  if (!product) return 0;
  if (product.type === 'manufactured') return manufacturedUnitCost(product.id);
  if (product.type === 'simple') return Number(product.buy_price) || 0;
  if (product.type === 'service') return Number(product.cost_price) || 0;
  if (product.type === 'composite') {
    if (visited.has(product.id)) return 0;
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

/* تفكيك منتج (بكمية) إلى "أوراق": مواد خام، أو منتجات جاهزة لخصمها من المخزون */
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
    if (visited.has(product.id)) return out;
    const next = new Set(visited); next.add(product.id);
    STATE.productComponents.filter(c => c.parent_product_id === product.id).forEach(c => {
      const child = STATE.products.find(p => p.id === c.component_product_id);
      expandProductToLeaves(child, Number(c.quantity || 0) * qty, next, out);
    });
  }
  return out;
}

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

/* ================= لوحة التحكم ================= */
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

/* ================= المبيعات والفواتير ================= */
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
  updateInv
