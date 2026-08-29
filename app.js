/* =========================================================
   app.js — مؤسسة زروق للخدمات المطبعية
   النسخة المحدّثة: تصنيف المبيعات، المنتجات المصنّعة ووصفاتها،
   المخزون بالمواد، الخسائر والتالف، الجرد، الموردون، العمال،
   تقرير الأرباح المفصّل، الصلاحيات (مدير/محاسب)، سجل العمليات.
   ========================================================= */

/* ---------- تخزين محلي مؤقت لنتائج القاعدة (Cache) ---------- */
const STATE = {
  customers: [], suppliers: [], employees: [],
  materials: [], products: [], productMaterials: [],
  invoices: [], invoiceItems: [], customerPayments: [],
  purchases: [], purchaseItems: [], supplierPayments: [],
  expenses: [], losses: [], movements: [], auditLog: [],
  settings: null, salesChart: null,
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

/* ================= الصلاحيات (مدير / محاسب) ================= */
const ROLE_KEY = 'zerough_role';
function getRole() { return localStorage.getItem(ROLE_KEY) || 'manager'; }
function setRole(r) {
  localStorage.setItem(ROLE_KEY, r);
  applyRoleUI();
}
function applyRoleUI() {
  const role = getRole();
  document.body.classList.toggle('accountant-mode', role === 'accountant');
  document.body.classList.toggle('manager-mode', role === 'manager');
  const label = role === 'manager' ? 'مدير' : 'محاسب';
  qsa('#rolePillTop, #rolePillSide').forEach(el => el.textContent = label);
  const roleLabelEl = qs('#currentRoleLabel');
  if (roleLabelEl) roleLabelEl.textContent = label;
}

/* ================= سجل العمليات (Audit log) ================= */
async function logAudit(action, entity, label) {
  try {
    await window.db.from('audit_log').insert([{ role: getRole(), action, entity, entity_label: String(label || '').slice(0, 140) }]);
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
   تحميل كل البيانات عند بدء التشغيل
   ========================================================= */
async function loadAll() {
  const [customers, suppliers, employees, materials, products, productMaterials,
    invoices, invoiceItems, customerPayments, purchases, purchaseItems, supplierPayments,
    expenses, losses, movements, auditLog, settingsRows] = await Promise.all([
    Api.list('customers', 'name', true),
    Api.list('suppliers', 'name', true),
    Api.list('employees', 'name', true),
    Api.list('materials', 'name', true),
    Api.list('products', 'name', true),
    Api.list('product_materials', 'id', true),
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
    customers, suppliers, employees, materials, products, productMaterials,
    invoices, invoiceItems, customerPayments, purchases, purchaseItems, supplierPayments,
    expenses, losses, movements, auditLog,
    settings: (settingsRows.data && settingsRows.data[0]) || null,
  });

  renderDashboard();
  renderInvoices();
  renderManufactured();
  renderSimple();
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
  const invoiced = STATE.invoices.filter(i => i.customer_id === customerId).reduce((s, i) => s + Number(i.total || 0), 0);
  const paid = STATE.customerPayments.filter(p => p.customer_id === customerId).reduce((s, p) => s + Number(p.amount || 0), 0);
  return { invoiced, paid, remaining: invoiced - paid };
}
function supplierBalance(supplierId) {
  const purchased = STATE.purchases.filter(p => p.supplier_id === supplierId).reduce((s, p) => s + Number(p.total || 0), 0);
  const paid = STATE.supplierPayments.filter(p => p.supplier_id === supplierId).reduce((s, p) => s + Number(p.amount || 0), 0);
  return { purchased, paid, remaining: purchased - paid };
}
function invoicePaid(invoiceId) {
  return STATE.customerPayments.filter(p => p.invoice_id === invoiceId).reduce((s, p) => s + Number(p.amount || 0), 0);
}
function purchasePaid(purchaseId) {
  return STATE.supplierPayments.filter(p => p.purchase_id === purchaseId).reduce((s, p) => s + Number(p.amount || 0), 0);
}
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
function inventoryValueTotal() {
  const matValue = STATE.materials.reduce((s, m) => s + Number(m.quantity || 0) * Number(m.avg_cost || 0), 0);
  const prodValue = STATE.products.filter(p => p.type === 'simple').reduce((s, p) => s + Number(p.quantity || 0) * Number(p.buy_price || 0), 0);
  return matValue + prodValue;
}

/* =========================================================
   لوحة التحكم
   ========================================================= */
function renderDashboard() {
  const totalSales = STATE.invoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const totalCOGS = STATE.invoiceItems.reduce((s, it) => s + Number(it.cost_price || 0) * Number(it.quantity || 0), 0);
  const grossProfit = totalSales - totalCOGS;
  const totalExpenses = STATE.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalLosses = STATE.losses.reduce((s, l) => s + Number(l.total_cost || 0), 0);
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

  const recent = STATE.invoices.slice(0, 6);
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

  // الربح حسب نوع البيع لهذا الشهر
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
  const byCat = { 'جملة': { sales: 0, cost: 0 }, 'فردي': { sales: 0, cost: 0 }, 'عادي': { sales: 0, cost: 0 } };
  STATE.invoiceItems.forEach(it => {
    const inv = STATE.invoices.find(i => i.id === it.invoice_id);
    if (!inv || !inv.invoice_date) return;
    const d = new Date(inv.invoice_date);
    if (`${d.getFullYear()}-${d.getMonth()}` !== monthKey) return;
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
  STATE.invoices.forEach(inv => {
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
    return `
    <tr>
      <td class="cell-strong">${i.invoice_number}</td>
      <td>${i.customer_name || '—'}</td>
      <td>${fmtDateAr(i.invoice_date)}</td>
      <td>${money(i.total)} أ.م</td>
      <td class="text-success">${money(paid)}</td>
      <td class="${remaining > 0 ? 'text-danger' : ''}">${money(remaining)}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="printInvoice('${i.id}')">طباعة</button>
        <button class="btn-text" onclick="openPaymentModal('invoice','${i.id}','تسجيل دفعة على الفاتورة #${i.invoice_number}')">دفعة</button>
        <button class="btn-text danger" onclick="deleteInvoice('${i.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}
['invoiceSearch', 'invoiceFilterCategory', 'invoiceFilterFrom', 'invoiceFilterTo'].forEach(id => qs('#' + id).addEventListener('input', renderInvoices));

window.deleteInvoice = async function (id) {
  if (!confirm('هل تريد حذف هذه الفاتورة؟ (لن يُعاد المخزون المستهلك تلقائيا)')) return;
  try {
    await Api.remove('invoices', id, 'فاتورة');
    await Api.removeWhere('invoice_items', 'invoice_id', id);
    STATE.invoices = STATE.invoices.filter(i => i.id !== id);
    STATE.invoiceItems = STATE.invoiceItems.filter(it => it.invoice_id !== id);
    renderInvoices(); renderDashboard(); renderCustomers();
    toast('تم حذف الفاتورة', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
};

function categoryBadge(cat) {
  const cls = cat === 'جملة' ? 'badge-wholesale' : cat === 'فردي' ? 'badge-individual' : 'badge-regular';
  return `<span class="badge ${cls}">${cat}</span>`;
}

function productOptionsForSale() {
  return `<option value="">اختر منتج/خدمة…</option>` + STATE.products.map(p =>
    `<option value="${p.id}" data-price="${p.sell_price}" data-category="${p.category}">${p.name} (${p.type === 'manufactured' ? 'مصنّع' : p.type === 'service' ? 'خدمة' : 'جاهز'})</option>`
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

qs('#btnNewInvoice').addEventListener('click', () => {
  qs('#invCustomerName').value = '';
  qs('#invDate').value = todayISO();
  qs('#invNumber').value = 'ZR-' + String(STATE.invoices.length + 1).padStart(5, '0');
  qs('#invPaidNow').value = 0;
  qs('#invoiceItemsBody').innerHTML = '';
  addInvoiceRow();
  updateInvoiceGrandTotal();
  openModal('modalInvoice');
});

qs('#btnSaveInvoice').addEventListener('click', async () => {
  const customerName = qs('#invCustomerName').value.trim();
  const date = qs('#invDate').value || todayISO();
  const number = qs('#invNumber').value;
  const paidNow = Number(qs('#invPaidNow').value) || 0;
  const rows = qsa('#invoiceItemsBody tr').map(tr => ({
    product_id: tr.querySelector('.inv-item-product').value,
    category: tr.querySelector('.inv-item-category').value,
    quantity: Number(tr.querySelector('.inv-item-qty').value) || 0,
    price: Number(tr.querySelector('.inv-item-price').value) || 0,
  })).filter(r => r.product_id && r.quantity > 0);

  if (!customerName) { toast('اكتب اسم العميل', 'error'); return; }
  if (!rows.length) { toast('أضف صنفا واحدا على الأقل', 'error'); return; }

  // تحقق من توفر المخزون للمنتجات الجاهزة
  for (const r of rows) {
    const p = STATE.products.find(p => p.id === r.product_id);
    if (p && p.type === 'simple' && Number(p.quantity) < r.quantity) {
      toast(`الكمية غير كافية للمنتج: ${p.name}`, 'error'); return;
    }
  }

  try {
    let customer = STATE.customers.find(c => c.name === customerName);
    if (!customer) {
      customer = await Api.insert('customers', { name: customerName, phone: '' }, customerName);
      STATE.customers.push(customer);
      STATE.customers.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }

    const itemsPayload = rows.map(r => {
      const p = STATE.products.find(p => p.id === r.product_id);
      let costPrice = 0;
      if (p.type === 'manufactured') costPrice = manufacturedUnitCost(p.id);
      else if (p.type === 'simple') costPrice = Number(p.buy_price) || 0;
      else costPrice = Number(p.cost_price) || 0;
      return { ...r, product: p, cost_price: costPrice, total: r.quantity * r.price };
    });
    const total = itemsPayload.reduce((s, r) => s + r.total, 0);

    const invoice = await Api.insert('invoices', {
      invoice_number: number, customer_id: customer.id, customer_name: customerName, invoice_date: date, total,
    }, number);

    const itemRows = itemsPayload.map(r => ({
      invoice_id: invoice.id, product_id: r.product_id, product_name: r.product.name, category: r.category,
      quantity: r.quantity, price: r.price, cost_price: r.cost_price, total: r.total,
    }));
    await Api.insertMany('invoice_items', itemRows, 'أصناف فاتورة #' + number);

    // خصم المخزون
    for (const r of itemsPayload) {
      const p = r.product;
      if (p.type === 'manufactured') {
        const bom = STATE.productMaterials.filter(pm => pm.product_id === p.id);
        for (const b of bom) {
          const mat = STATE.materials.find(m => m.id === b.material_id);
          if (!mat) continue;
          const consumed = Number(b.qty_per_unit || 0) * r.quantity;
          const before = Number(mat.quantity) || 0;
          const after = before - consumed;
          const updated = await Api.update('materials', mat.id, { quantity: after });
          STATE.materials = STATE.materials.map(m => m.id === mat.id ? updated : m);
          logMovement('material', mat.id, mat.name, 'out', consumed, 'بيع: ' + p.name);
        }
      } else if (p.type === 'simple') {
        const before = Number(p.quantity) || 0;
        const after = before - r.quantity;
        const updated = await Api.update('products', p.id, { quantity: after });
        STATE.products = STATE.products.map(x => x.id === p.id ? updated : x);
        logMovement('product', p.id, p.name, 'out', r.quantity, 'بيع');
      }
    }

    if (paidNow > 0) {
      const pay = await Api.insert('customer_payments', { customer_id: customer.id, invoice_id: invoice.id, amount: paidNow, payment_date: date, note: 'دفعة عند إنشاء الفاتورة' }, 'دفعة عميل');
      STATE.customerPayments.push(pay);
    }

    STATE.invoices.unshift(invoice);
    STATE.invoiceItems.push(...itemRows);
    renderInvoices(); renderDashboard(); renderManufactured(); renderSimple(); renderMaterials(); renderMovements(); renderCustomers();
    closeModal('modalInvoice');
    toast('تم حفظ الفاتورة بنجاح', 'success');
  } catch (err) { toast('خطأ أثناء الحفظ: ' + err.message, 'error'); }
});

window.printInvoice = function (invoiceId) {
  const inv = STATE.invoices.find(i => i.id === invoiceId);
  if (!inv) return;
  const items = STATE.invoiceItems.filter(it => it.invoice_id === invoiceId);
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
  tr.querySelector('.row-remove').addEventListener('click', () => tr.remove());
}
qs('#btnAddManuRow').addEventListener('click', () => addManuRow());
qs('#btnNewManufactured').addEventListener('click', () => {
  qs('#manufacturedModalTitle').textContent = 'منتج مصنّع جديد';
  qs('#manuId').value = ''; qs('#manuName').value = ''; qs('#manuCategory').value = 'عادي'; qs('#manuSellPrice').value = '';
  qs('#manuMaterialsBody').innerHTML = '';
  addManuRow();
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
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

/* =========================================================
   المنتجات — الجاهزة والخدمات
   ========================================================= */
function renderSimple() {
  const rows = STATE.products.filter(p => p.type !== 'manufactured');
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

window.deleteProductAny = async function (id) {
  if (!confirm('هل تريد حذف هذا المنتج؟')) return;
  try {
    await Api.remove('products', id, 'منتج');
    await Api.removeWhere('product_materials', 'product_id', id);
    STATE.products = STATE.products.filter(p => p.id !== id);
    STATE.productMaterials = STATE.productMaterials.filter(pm => pm.product_id !== id);
    renderManufactured(); renderSimple(); renderDashboard();
    toast('تم حذف المنتج', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
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
  if (!confirm('هل تريد حذف هذه المادة؟ سيؤثر ذلك على وصفات المنتجات المرتبطة بها.')) return;
  try {
    await Api.remove('materials', id, 'مادة');
    STATE.materials = STATE.materials.filter(m => m.id !== id);
    STATE.productMaterials = STATE.productMaterials.filter(pm => pm.material_id !== id);
    renderMaterials(); renderManufactured(); renderDashboard();
    toast('تم حذف المادة', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
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
  if (!confirm('هل تريد حذف سجل الخسارة؟ (لن تتم إعادة الكمية إلى المخزون تلقائيا)')) return;
  try {
    await Api.remove('inventory_losses', id, 'خسارة');
    STATE.losses = STATE.losses.filter(l => l.id !== id);
    renderLosses(); renderDashboard();
    toast('تم الحذف', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
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
      return { purchase_id: purchase.id, item_type: r.item_type, item_id: r.item_id, item_name: item?.name || '', quantity: r.quantity, price: r.price, total: r.quantity * r.price };
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
    return `<tr>
      <td class="cell-strong">${p.supplier_name || '—'}</td>
      <td>${p.item_count ?? '—'}</td>
      <td>${fmtDateAr(p.purchase_date)}</td>
      <td>${money(p.total)} أ.م</td>
      <td class="text-success">${money(paid)}</td>
      <td class="${remaining > 0 ? 'text-danger' : ''}">${money(remaining)}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="openPaymentModal('purchase','${p.id}','تسجيل دفعة لعملية الشراء')">دفعة</button>
        <button class="btn-text danger" onclick="deletePurchase('${p.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}
['purchaseFilterFrom', 'purchaseFilterTo'].forEach(id => qs('#' + id).addEventListener('input', renderPurchases));

window.deletePurchase = async function (id) {
  if (!confirm('هل تريد حذف عملية الشراء هذه؟ (لن يُعاد المخزون تلقائيا)')) return;
  try {
    await Api.remove('purchases', id, 'شراء');
    await Api.removeWhere('purchase_items', 'purchase_id', id);
    STATE.purchases = STATE.purchases.filter(p => p.id !== id);
    renderPurchases(); renderSuppliers(); renderDashboard();
    toast('تم حذف عملية الشراء', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
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
    <tr>
      <td class="cell-strong">${e.description}</td>
      <td><span class="badge badge-cat">${e.category || 'أخرى'}</span></td>
      <td>${money(e.amount)} أ.م</td>
      <td>${fmtDateAr(e.expense_date)}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="editExpense('${e.id}')">تعديل</button>
        <button class="btn-text danger" onclick="deleteExpense('${e.id}')">حذف</button>
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
  if (!confirm('هل تريد حذف هذا المصروف؟')) return;
  try {
    await Api.remove('expenses', id, 'مصروف');
    STATE.expenses = STATE.expenses.filter(e => e.id !== id);
    renderExpenses(); renderEmployees(); renderDashboard();
    toast('تم حذف المصروف', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
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
  if (!confirm('هل تريد حذف هذا الموظف؟ (تبقى المصروفات السابقة مسجلة)')) return;
  try {
    await Api.remove('employees', id, 'موظف');
    STATE.employees = STATE.employees.filter(e => e.id !== id);
    renderEmployees();
    toast('تم حذف الموظف', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
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
  if (!confirm('هل تريد حذف هذا العميل؟')) return;
  try {
    await Api.remove('customers', id, 'عميل');
    STATE.customers = STATE.customers.filter(c => c.id !== id);
    renderCustomers(); fillDatalists();
    toast('تم حذف العميل', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
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
  const debits = STATE.invoices.filter(i => i.customer_id === id).map(i => ({ date: i.invoice_date, label: 'فاتورة #' + i.invoice_number, amount: Number(i.total), type: 'debit' }));
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
  if (!confirm('هل تريد حذف هذا المورّد؟')) return;
  try {
    await Api.remove('suppliers', id, 'مورّد');
    STATE.suppliers = STATE.suppliers.filter(s => s.id !== id);
    renderSuppliers(); fillDatalists();
    toast('تم حذف المورّد', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
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
  const debits = STATE.purchases.filter(p => p.supplier_id === id).map(p => ({ date: p.purchase_date, label: 'شراء بتاريخ ' + fmtDateAr(p.purchase_date), amount: Number(p.total), type: 'debit' }));
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
  STATE.invoices.forEach(i => invDateById[i.id] = i.invoice_date);
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
  const expensesTotal = STATE.expenses.filter(e => (!from || e.expense_date >= from) && (!to || e.expense_date <= to)).reduce((s, e) => s + Number(e.amount || 0), 0);
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

qs('#btnSwitchAccountant').addEventListener('click', () => { setRole('accountant'); toast('تم التبديل لوضع المحاسب', 'success'); });
qs('#btnSwitchManager').addEventListener('click', () => {
  const pin = window.prompt('أدخل الرمز السري للمدير:');
  if (pin === null) return;
  const correctPin = (STATE.settings && STATE.settings.manager_pin) || '1234';
  if (pin === correctPin) { setRole('manager'); toast('تم التبديل لوضع المدير', 'success'); }
  else toast('رمز غير صحيح', 'error');
});
qs('#pinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (getRole() !== 'manager') { toast('بدّل إلى وضع المدير أولا', 'error'); return; }
  const newPin = qs('#setPin').value.trim();
  if (!newPin) { toast('اكتب رمزا جديدا', 'error'); return; }
  try {
    if (STATE.settings?.id) STATE.settings = await Api.update('settings', STATE.settings.id, { manager_pin: newPin }, 'تحديث الرمز السري');
    else STATE.settings = await Api.insert('settings', { manager_pin: newPin }, 'تحديث الرمز السري');
    qs('#setPin').value = '';
    toast('تم تحديث الرمز السري', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

function renderAuditLog() {
  qs('#auditLogList').innerHTML = STATE.auditLog.length ? STATE.auditLog.map(a => `
    <div class="mini-row">
      <div><div class="mini-row-title">${a.action} — ${a.entity}${a.entity_label ? ' (' + a.entity_label + ')' : ''}</div>
      <div class="mini-row-sub">بواسطة: ${a.role === 'manager' ? 'مدير' : 'محاسب'}</div></div>
      <div class="mini-row-value" style="font-weight:600;font-size:11.5px;">${new Date(a.created_at).toLocaleString('ar-MA')}</div>
    </div>`).join('') : `<p class="mini-empty">لا توجد عمليات مسجلة بعد</p>`;
}

/* ---------- قوائم Datalist ---------- */
function fillDatalists() {
  qs('#customerNamesList').innerHTML = STATE.customers.map(c => `<option value="${c.name}">`).join('');
  qs('#supplierNamesList').innerHTML = STATE.suppliers.map(s => `<option value="${s.name}">`).join('');
}

/* =========================================================
   بدء التشغيل
   ========================================================= */
async function init() {
  qs('#yearNow').textContent = new Date().getFullYear();
  qs('#invDate').value = todayISO();
  qs('#purDate').value = todayISO();
  initSubtabs();
  applyRoleUI();
  qs('#btnToggleRole').addEventListener('click', () => {
    if (getRole() === 'manager') { setRole('accountant'); toast('تم التبديل لوضع المحاسب', 'success'); }
    else {
      const pin = window.prompt('أدخل الرمز السري للمدير:');
      if (pin === null) return;
      const correctPin = (STATE.settings && STATE.settings.manager_pin) || '1234';
      if (pin === correctPin) { setRole('manager'); toast('تم التبديل لوضع المدير', 'success'); }
      else toast('رمز غير صحيح', 'error');
    }
  });
  try {
    await loadAll();
  } catch (err) {
    console.error(err);
    toast('تعذر الاتصال بقاعدة البيانات: تحقق من مفتاح Supabase وتحديث جداول قاعدة البيانات', 'error');
  } finally {
    qs('#loader').classList.add('hide');
  }
}
init();
