/* =========================================================
   app.js — مؤسسة زروق للخدمات المطبعية
   منطق التطبيق: جلب البيانات من Supabase، العرض، الإضافة/
   التعديل/الحذف، الفواتير، المشتريات، التقارير، الطباعة.
   ========================================================= */

/* ---------- تخزين محلي مؤقت لنتائج القاعدة (Cache) ---------- */
const STATE = {
  products: [],
  customers: [],
  invoices: [],
  expenses: [],
  purchases: [],
  settings: null,
  salesChart: null,
};

/* ================= أدوات مساعدة عامة ================= */
const qs  = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('ar-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

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

qsa('.modal-close, [data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
qsa('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('show'); });
});

/* تصدير مصفوفة كائنات إلى ملف CSV وتنزيله */
function exportCSV(filename, rows) {
  if (!rows.length) { toast('لا توجد بيانات لتصديرها', 'error'); return; }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach(r => {
    lines.push(headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
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

/* ---------- قائمة الهاتف ---------- */
function openSidebarMobile() { qs('#sidebar').classList.add('open'); qs('#sidebarOverlay').classList.add('show'); }
function closeSidebarMobile() { qs('#sidebar').classList.remove('open'); qs('#sidebarOverlay').classList.remove('show'); }
qs('#menuToggle').addEventListener('click', openSidebarMobile);
qs('#sidebarOverlay').addEventListener('click', closeSidebarMobile);

/* =========================================================
   طبقة الوصول لقاعدة البيانات (Supabase)
   ========================================================= */
const Api = {
  async list(table, orderCol = 'created_at', ascending = false) {
    const { data, error } = await window.db.from(table).select('*').order(orderCol, { ascending });
    if (error) throw error;
    return data || [];
  },
  async insert(table, row) {
    const { data, error } = await window.db.from(table).insert([row]).select().single();
    if (error) throw error;
    return data;
  },
  async insertMany(table, rows) {
    const { data, error } = await window.db.from(table).insert(rows).select();
    if (error) throw error;
    return data;
  },
  async update(table, id, patch) {
    const { data, error } = await window.db.from(table).update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async remove(table, id) {
    const { error } = await window.db.from(table).delete().eq('id', id);
    if (error) throw error;
  },
};

/* =========================================================
   تحميل كل البيانات عند بدء التشغيل
   ========================================================= */
async function loadAll() {
  const [products, customers, invoices, expenses, purchases, settingsRows] = await Promise.all([
    Api.list('products', 'name', true),
    Api.list('customers', 'name', true),
    Api.list('invoices', 'invoice_date', false),
    Api.list('expenses', 'expense_date', false),
    Api.list('purchases', 'purchase_date', false).catch(() => []), // قد لا يكون الجدول منشأ بعد
    window.db.from('settings').select('*').limit(1),
  ]);
  STATE.products = products;
  STATE.customers = customers;
  STATE.invoices = invoices;
  STATE.expenses = expenses;
  STATE.purchases = purchases;
  STATE.settings = (settingsRows.data && settingsRows.data[0]) || null;

  renderDashboard();
  renderProducts();
  renderCustomers();
  renderInvoices();
  renderExpenses();
  renderPurchases();
  renderSettings();
  fillCustomerDatalist();
}

/* =========================================================
   لوحة التحكم
   ========================================================= */
function renderDashboard() {
  const totalSales = STATE.invoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const totalExpenses = STATE.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  qs('#statSales').textContent = money(totalSales);
  qs('#statExpenses').textContent = money(totalExpenses);
  qs('#statProfit').textContent = money(totalSales - totalExpenses);
  qs('#statInvoiceCount').textContent = STATE.invoices.length;
  qs('#statProductCount').textContent = STATE.products.length;
  qs('#todayDate').textContent = new Date().toLocaleDateString('ar-MA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // آخر 6 فواتير
  const recentWrap = qs('#recentInvoices');
  const recent = STATE.invoices.slice(0, 6);
  recentWrap.innerHTML = recent.length ? recent.map(inv => `
    <div class="mini-row">
      <div>
        <div class="mini-row-title">${inv.customer_name || 'عميل غير محدد'}</div>
        <div class="mini-row-sub">#${inv.invoice_number} · ${fmtDateAr(inv.invoice_date)}</div>
      </div>
      <div class="mini-row-value">${money(inv.total)} د.م</div>
    </div>`).join('') : `<p class="mini-empty">لا توجد فواتير بعد</p>`;

  renderSalesChart();
}

function renderSalesChart() {
  // تجميع المبيعات لآخر 12 شهرا
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
    data: {
      labels: months.map(m => m.label),
      datasets: [{
        label: 'المبيعات',
        data: months.map(m => m.total),
        backgroundColor: '#33529e',
        borderRadius: 5,
        maxBarThickness: 26,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: '#eee9dc' }, beginAtZero: true },
      },
    },
  });
}

/* =========================================================
   المنتجات
   ========================================================= */
function renderProducts(filter = '') {
  const tbody = qs('#productsTableBody');
  const rows = STATE.products.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()));
  qs('#productsEmptyHint').style.display = rows.length ? 'none' : 'block';
  tbody.innerHTML = rows.map(p => {
    const profit = Number(p.sell_price || 0) - Number(p.buy_price || 0);
    const low = Number(p.quantity) <= 3;
    return `
    <tr>
      <td class="cell-strong">${p.name}</td>
      <td>${money(p.buy_price)} د.م</td>
      <td>${money(p.sell_price)} د.م</td>
      <td>${money(profit)} د.م</td>
      <td class="${low ? 'qty-low' : ''}">${p.quantity ?? 0}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="editProduct('${p.id}')">تعديل</button>
        <button class="btn-text danger" onclick="deleteProduct('${p.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}

qs('#productSearch').addEventListener('input', (e) => renderProducts(e.target.value));

qs('#btnNewProduct').addEventListener('click', () => {
  qs('#productModalTitle').textContent = 'منتج جديد';
  qs('#productForm').reset();
  qs('#prodId').value = '';
  openModal('modalProduct');
});

window.editProduct = function (id) {
  const p = STATE.products.find(x => x.id === id);
  if (!p) return;
  qs('#productModalTitle').textContent = 'تعديل منتج';
  qs('#prodId').value = p.id;
  qs('#prodName').value = p.name;
  qs('#prodBuyPrice').value = p.buy_price;
  qs('#prodSellPrice').value = p.sell_price;
  qs('#prodQuantity').value = p.quantity;
  openModal('modalProduct');
};

window.deleteProduct = async function (id) {
  if (!confirm('هل تريد حذف هذا المنتج؟')) return;
  try {
    await Api.remove('products', id);
    STATE.products = STATE.products.filter(p => p.id !== id);
    renderProducts(qs('#productSearch').value);
    renderDashboard();
    toast('تم حذف المنتج', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
};

qs('#btnSaveProduct').addEventListener('click', async () => {
  const id = qs('#prodId').value;
  const payload = {
    name: qs('#prodName').value.trim(),
    buy_price: Number(qs('#prodBuyPrice').value) || 0,
    sell_price: Number(qs('#prodSellPrice').value) || 0,
    quantity: Number(qs('#prodQuantity').value) || 0,
  };
  if (!payload.name) { toast('اكتب اسم المنتج', 'error'); return; }
  try {
    if (id) {
      const updated = await Api.update('products', id, payload);
      STATE.products = STATE.products.map(p => p.id === id ? updated : p);
    } else {
      const created = await Api.insert('products', payload);
      STATE.products.push(created);
    }
    STATE.products.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    renderProducts();
    renderDashboard();
    closeModal('modalProduct');
    toast('تم حفظ المنتج', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

/* =========================================================
   العملاء
   ========================================================= */
function renderCustomers(filter = '') {
  const tbody = qs('#customersTableBody');
  const rows = STATE.customers.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));
  qs('#customersEmptyHint').style.display = rows.length ? 'none' : 'block';
  tbody.innerHTML = rows.map(c => {
    const custInvoices = STATE.invoices.filter(i => i.customer_name === c.name);
    const total = custInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
    return `
    <tr>
      <td class="cell-strong">${c.name}</td>
      <td>${c.phone || '—'}</td>
      <td>${custInvoices.length}</td>
      <td>${money(total)} د.م</td>
      <td class="row-actions">
        <button class="btn-text" onclick="viewCustomerHistory('${c.id}')">السجل</button>
        <button class="btn-text" onclick="editCustomer('${c.id}')">تعديل</button>
        <button class="btn-text danger" onclick="deleteCustomer('${c.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}

qs('#customerSearch').addEventListener('input', (e) => renderCustomers(e.target.value));

qs('#btnNewCustomer').addEventListener('click', () => {
  qs('#customerModalTitle').textContent = 'عميل جديد';
  qs('#customerForm').reset();
  qs('#custId').value = '';
  openModal('modalCustomer');
});

window.editCustomer = function (id) {
  const c = STATE.customers.find(x => x.id === id);
  if (!c) return;
  qs('#customerModalTitle').textContent = 'تعديل عميل';
  qs('#custId').value = c.id;
  qs('#custName').value = c.name;
  qs('#custPhone').value = c.phone || '';
  openModal('modalCustomer');
};

window.deleteCustomer = async function (id) {
  if (!confirm('هل تريد حذف هذا العميل؟')) return;
  try {
    await Api.remove('customers', id);
    STATE.customers = STATE.customers.filter(c => c.id !== id);
    renderCustomers();
    fillCustomerDatalist();
    toast('تم حذف العميل', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
};

window.viewCustomerHistory = function (id) {
  const c = STATE.customers.find(x => x.id === id);
  if (!c) return;
  qs('#custHistoryTitle').textContent = 'سجل مشتريات: ' + c.name;
  const invs = STATE.invoices.filter(i => i.customer_name === c.name);
  qs('#custHistoryList').innerHTML = invs.length ? invs.map(i => `
    <div class="mini-row">
      <div>
        <div class="mini-row-title">فاتورة #${i.invoice_number}</div>
        <div class="mini-row-sub">${fmtDateAr(i.invoice_date)}</div>
      </div>
      <div class="mini-row-value">${money(i.total)} د.م</div>
    </div>`).join('') : `<p class="mini-empty">لا يوجد سجل مشتريات لهذا العميل</p>`;
  openModal('modalCustomerHistory');
};

qs('#btnSaveCustomer').addEventListener('click', async () => {
  const id = qs('#custId').value;
  const payload = { name: qs('#custName').value.trim(), phone: qs('#custPhone').value.trim() };
  if (!payload.name) { toast('اكتب اسم العميل', 'error'); return; }
  try {
    if (id) {
      const updated = await Api.update('customers', id, payload);
      STATE.customers = STATE.customers.map(c => c.id === id ? updated : c);
    } else {
      const created = await Api.insert('customers', payload);
      STATE.customers.push(created);
    }
    STATE.customers.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    renderCustomers();
    fillCustomerDatalist();
    closeModal('modalCustomer');
    toast('تم حفظ العميل', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

function fillCustomerDatalist() {
  qs('#customerNamesList').innerHTML = STATE.customers.map(c => `<option value="${c.name}">`).join('');
}

/* =========================================================
   الفواتير (المبيعات)
   ========================================================= */
function renderInvoices() {
  const term = qs('#invoiceSearch').value.trim().toLowerCase();
  const from = qs('#invoiceFilterFrom').value;
  const to = qs('#invoiceFilterTo').value;

  let rows = STATE.invoices.filter(i =>
    (!term || i.invoice_number?.toLowerCase().includes(term) || i.customer_name?.toLowerCase().includes(term)) &&
    (!from || i.invoice_date >= from) &&
    (!to || i.invoice_date <= to)
  );

  qs('#invoicesEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#invoicesTableBody').innerHTML = rows.map(i => `
    <tr>
      <td class="cell-strong">${i.invoice_number}</td>
      <td>${i.customer_name || '—'}</td>
      <td>${fmtDateAr(i.invoice_date)}</td>
      <td>${money(i.total)} د.م</td>
      <td class="row-actions">
        <button class="btn-text" onclick="printInvoice('${i.id}')">طباعة</button>
        <button class="btn-text danger" onclick="deleteInvoice('${i.id}')">حذف</button>
      </td>
    </tr>`).join('');
}
['invoiceSearch', 'invoiceFilterFrom', 'invoiceFilterTo'].forEach(id =>
  qs('#' + id).addEventListener('input', renderInvoices)
);

window.deleteInvoice = async function (id) {
  if (!confirm('هل تريد حذف هذه الفاتورة؟ سيتم حذف أصنافها أيضا.')) return;
  try {
    await Api.remove('invoices', id);
    STATE.invoices = STATE.invoices.filter(i => i.id !== id);
    renderInvoices(); renderDashboard(); renderCustomers();
    toast('تم حذف الفاتورة', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
};

/* ---- نافذة إنشاء فاتورة ---- */
function productOptions(selected = '') {
  return `<option value="">اختر منتج…</option>` +
    STATE.products.map(p => `<option value="${p.name}" data-price="${p.sell_price}" ${p.name === selected ? 'selected' : ''}>${p.name}</option>`).join('');
}

function addInvoiceRow() {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select class="inv-item-product">${productOptions()}</select></td>
    <td><input type="number" class="inv-item-qty" min="1" value="1"></td>
    <td><input type="number" class="inv-item-price" min="0" step="0.01" value="0"></td>
    <td class="line-total">0.00</td>
    <td><button type="button" class="row-remove">✕</button></td>`;
  qs('#invoiceItemsBody').appendChild(tr);

  const sel = tr.querySelector('.inv-item-product');
  const qty = tr.querySelector('.inv-item-qty');
  const price = tr.querySelector('.inv-item-price');

  sel.addEventListener('change', () => {
    const opt = sel.selectedOptions[0];
    price.value = opt?.dataset.price || 0;
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
    const qty = Number(tr.querySelector('.inv-item-qty').value) || 0;
    const price = Number(tr.querySelector('.inv-item-price').value) || 0;
    total += qty * price;
  });
  qs('#invoiceGrandTotal').textContent = money(total) + ' درهم';
  return total;
}

qs('#btnAddInvoiceRow').addEventListener('click', addInvoiceRow);

qs('#btnNewInvoice').addEventListener('click', () => {
  qs('#invCustomerName').value = '';
  qs('#invDate').value = todayISO();
  qs('#invNumber').value = 'ZR-' + String(STATE.invoices.length + 1).padStart(5, '0');
  qs('#invoiceItemsBody').innerHTML = '';
  addInvoiceRow();
  updateInvoiceGrandTotal();
  openModal('modalInvoice');
});

qs('#btnSaveInvoice').addEventListener('click', async () => {
  const customerName = qs('#invCustomerName').value.trim();
  const date = qs('#invDate').value || todayISO();
  const number = qs('#invNumber').value;
  const rows = qsa('#invoiceItemsBody tr').map(tr => ({
    product_name: tr.querySelector('.inv-item-product').value,
    quantity: Number(tr.querySelector('.inv-item-qty').value) || 0,
    price: Number(tr.querySelector('.inv-item-price').value) || 0,
  })).filter(r => r.product_name && r.quantity > 0);

  if (!customerName) { toast('اكتب اسم العميل', 'error'); return; }
  if (!rows.length) { toast('أضف صنفا واحدا على الأقل', 'error'); return; }

  // تحقق من توفر الكمية
  for (const r of rows) {
    const p = STATE.products.find(p => p.name === r.product_name);
    if (p && Number(p.quantity) < r.quantity) {
      toast(`الكمية غير كافية للمنتج: ${r.product_name}`, 'error');
      return;
    }
  }

  const total = rows.reduce((s, r) => s + r.quantity * r.price, 0);

  try {
    const invoice = await Api.insert('invoices', {
      invoice_number: number, customer_name: customerName, invoice_date: date, total,
    });
    const itemRows = rows.map(r => ({
      invoice_id: invoice.id, product_name: r.product_name, quantity: r.quantity, price: r.price, total: r.quantity * r.price,
    }));
    await Api.insertMany('invoice_items', itemRows);

    // خصم الكمية من المخزون
    for (const r of rows) {
      const p = STATE.products.find(p => p.name === r.product_name);
      if (p) {
        const newQty = Number(p.quantity) - r.quantity;
        const updated = await Api.update('products', p.id, { quantity: newQty });
        STATE.products = STATE.products.map(x => x.id === p.id ? updated : x);
      }
    }

    // إضافة العميل تلقائيا إن لم يكن موجودا
    if (!STATE.customers.find(c => c.name === customerName)) {
      const created = await Api.insert('customers', { name: customerName, phone: '' });
      STATE.customers.push(created);
      STATE.customers.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      fillCustomerDatalist();
    }

    STATE.invoices.unshift(invoice);
    invoice._items = itemRows;
    renderInvoices(); renderDashboard(); renderProducts(); renderCustomers();
    closeModal('modalInvoice');
    toast('تم حفظ الفاتورة بنجاح', 'success');
  } catch (err) { toast('خطأ أثناء الحفظ: ' + err.message, 'error'); }
});

/* ---- طباعة الفاتورة ---- */
window.printInvoice = async function (invoiceId) {
  const inv = STATE.invoices.find(i => i.id === invoiceId);
  if (!inv) return;
  let items = inv._items;
  if (!items) {
    const { data } = await window.db.from('invoice_items').select('*').eq('invoice_id', invoiceId);
    items = data || [];
  }
  const s = STATE.settings || {};
  const logo = s.logo_url ? `<img src="${s.logo_url}" style="height:64px;object-fit:contain">` : '';
  qs('#printArea').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #33529e;padding-bottom:16px;margin-bottom:20px;">
      <div>
        <h1 style="margin:0;font-size:22px;">${s.company_name || 'مؤسسة زروق للخدمات المطبعية'}</h1>
        <p style="margin:4px 0 0;color:#555;font-size:12.5px;">${s.address || ''} ${s.phone ? ' | هاتف: ' + s.phone : ''}</p>
      </div>
      ${logo}
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:18px;font-size:13.5px;">
      <div><strong>فاتورة رقم:</strong> ${inv.invoice_number}<br><strong>التاريخ:</strong> ${fmtDateAr(inv.invoice_date)}</div>
      <div><strong>العميل:</strong> ${inv.customer_name || '—'}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#f1f1f1;">
        <th style="padding:8px;border:1px solid #ccc;text-align:right;">المنتج</th>
        <th style="padding:8px;border:1px solid #ccc;">الكمية</th>
        <th style="padding:8px;border:1px solid #ccc;">سعر الوحدة</th>
        <th style="padding:8px;border:1px solid #ccc;">الإجمالي</th>
      </tr></thead>
      <tbody>
        ${items.map(it => `<tr>
          <td style="padding:8px;border:1px solid #ccc;">${it.product_name}</td>
          <td style="padding:8px;border:1px solid #ccc;text-align:center;">${it.quantity}</td>
          <td style="padding:8px;border:1px solid #ccc;text-align:center;">${money(it.price)}</td>
          <td style="padding:8px;border:1px solid #ccc;text-align:center;">${money(it.total)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="text-align:left;margin-top:16px;font-size:16px;font-weight:bold;">
      الإجمالي الكلي: ${money(inv.total)} درهم
    </div>
    <p style="margin-top:40px;text-align:center;color:#888;font-size:11.5px;">شكرا لتعاملكم مع ${s.company_name || 'مؤسسة زروق للخدمات المطبعية'}</p>
  `;
  window.print();
};

/* =========================================================
   المصروفات
   ========================================================= */
function renderExpenses() {
  const from = qs('#expenseFilterFrom').value;
  const to = qs('#expenseFilterTo').value;
  const rows = STATE.expenses.filter(e => (!from || e.expense_date >= from) && (!to || e.expense_date <= to));
  qs('#expensesEmptyHint').style.display = rows.length ? 'none' : 'block';
  qs('#expensesTableBody').innerHTML = rows.map(e => `
    <tr>
      <td class="cell-strong">${e.description}</td>
      <td><span class="badge badge-cat">${e.category || 'أخرى'}</span></td>
      <td>${e.quantity ?? 1}</td>
      <td>${money(e.amount)} د.م</td>
      <td>${fmtDateAr(e.expense_date)}</td>
      <td class="row-actions">
        <button class="btn-text" onclick="editExpense('${e.id}')">تعديل</button>
        <button class="btn-text danger" onclick="deleteExpense('${e.id}')">حذف</button>
      </td>
    </tr>`).join('');
}
['expenseFilterFrom', 'expenseFilterTo'].forEach(id => qs('#' + id).addEventListener('input', renderExpenses));

qs('#btnNewExpense').addEventListener('click', () => {
  qs('#expenseModalTitle').textContent = 'مصروف جديد';
  qs('#expenseForm').reset();
  qs('#expId').value = '';
  qs('#expDate').value = todayISO();
  qs('#expQuantity').value = 1;
  openModal('modalExpense');
});

window.editExpense = function (id) {
  const e = STATE.expenses.find(x => x.id === id);
  if (!e) return;
  qs('#expenseModalTitle').textContent = 'تعديل مصروف';
  qs('#expId').value = e.id;
  qs('#expDescription').value = e.description;
  qs('#expCategory').value = e.category || 'أخرى';
  qs('#expQuantity').value = e.quantity ?? 1;
  qs('#expAmount').value = e.amount;
  qs('#expDate').value = e.expense_date;
  openModal('modalExpense');
};

window.deleteExpense = async function (id) {
  if (!confirm('هل تريد حذف هذا المصروف؟')) return;
  try {
    await Api.remove('expenses', id);
    STATE.expenses = STATE.expenses.filter(e => e.id !== id);
    renderExpenses(); renderDashboard();
    toast('تم حذف المصروف', 'success');
  } catch (err) { toast('تعذر الحذف: ' + err.message, 'error'); }
};

qs('#btnSaveExpense').addEventListener('click', async () => {
  const id = qs('#expId').value;
  const payload = {
    description: qs('#expDescription').value.trim(),
    category: qs('#expCategory').value,
    quantity: Number(qs('#expQuantity').value) || 1,
    amount: Number(qs('#expAmount').value) || 0,
    expense_date: qs('#expDate').value || todayISO(),
  };
  if (!payload.description) { toast('اكتب بيان المصروف', 'error'); return; }
  try {
    if (id) {
      const updated = await Api.update('expenses', id, payload);
      STATE.expenses = STATE.expenses.map(e => e.id === id ? updated : e);
    } else {
      const created = await Api.insert('expenses', payload);
      STATE.expenses.unshift(created);
    }
    renderExpenses(); renderDashboard();
    closeModal('modalExpense');
    toast('تم حفظ المصروف', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

/* =========================================================
   المشتريات
   ========================================================= */
function renderPurchases() {
  const tbody = qs('#purchasesTableBody');
  qs('#purchasesEmptyHint').style.display = STATE.purchases.length ? 'none' : 'block';
  tbody.innerHTML = STATE.purchases.map(p => `
    <tr>
      <td class="cell-strong">${p.supplier || '—'}</td>
      <td>${p.item_count ?? '—'}</td>
      <td>${fmtDateAr(p.purchase_date)}</td>
      <td>${money(p.total)} د.م</td>
      <td class="row-actions">
        <button class="btn-text danger" onclick="deletePurchase('${p.id}')">حذف</button>
      </td>
    </tr>`).join('');
}

window.deletePurchase = async function (id) {
  if (!confirm('هل تريد حذف عملية الشراء هذه؟')) return;
  try {
    await Api.remove('purchases', id);
    STATE.purchases = STATE.purchases.filter(p => p.id !== id);
    renderPurchases();
    toast('تم حذف عملية الشراء', 'success');
  } catch (err) { toast('تعذر الحذف — تأكد من وجود جدول purchases: ' + err.message, 'error'); }
};

function addPurchaseRow() {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select class="pur-item-product">${productOptions()}</select></td>
    <td><input type="number" class="pur-item-qty" min="1" value="1"></td>
    <td><input type="number" class="pur-item-price" min="0" step="0.01" value="0"></td>
    <td class="line-total">0.00</td>
    <td><button type="button" class="row-remove">✕</button></td>`;
  qs('#purchaseItemsBody').appendChild(tr);

  const sel = tr.querySelector('.pur-item-product');
  const qty = tr.querySelector('.pur-item-qty');
  const price = tr.querySelector('.pur-item-price');

  sel.addEventListener('change', () => {
    const p = STATE.products.find(p => p.name === sel.value);
    price.value = p ? p.buy_price : 0;
    updatePurchaseRowTotal(tr);
  });
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
  qsa('#purchaseItemsBody tr').forEach(tr => {
    const qty = Number(tr.querySelector('.pur-item-qty').value) || 0;
    const price = Number(tr.querySelector('.pur-item-price').value) || 0;
    total += qty * price;
  });
  qs('#purchaseGrandTotal').textContent = money(total) + ' درهم';
  return total;
}

qs('#btnAddPurchaseRow').addEventListener('click', addPurchaseRow);

qs('#btnNewPurchase').addEventListener('click', () => {
  qs('#purSupplier').value = '';
  qs('#purDate').value = todayISO();
  qs('#purchaseItemsBody').innerHTML = '';
  addPurchaseRow();
  updatePurchaseGrandTotal();
  openModal('modalPurchase');
});

qs('#btnSavePurchase').addEventListener('click', async () => {
  const supplier = qs('#purSupplier').value.trim();
  const date = qs('#purDate').value || todayISO();
  const rows = qsa('#purchaseItemsBody tr').map(tr => ({
    product_name: tr.querySelector('.pur-item-product').value,
    quantity: Number(tr.querySelector('.pur-item-qty').value) || 0,
    price: Number(tr.querySelector('.pur-item-price').value) || 0,
  })).filter(r => r.product_name && r.quantity > 0);

  if (!supplier) { toast('اكتب اسم المورّد', 'error'); return; }
  if (!rows.length) { toast('أضف صنفا واحدا على الأقل', 'error'); return; }

  const total = rows.reduce((s, r) => s + r.quantity * r.price, 0);

  try {
    const purchase = await Api.insert('purchases', {
      supplier, purchase_date: date, total, item_count: rows.length,
    });
    const itemRows = rows.map(r => ({
      purchase_id: purchase.id, product_name: r.product_name, quantity: r.quantity, price: r.price, total: r.quantity * r.price,
    }));
    await Api.insertMany('purchase_items', itemRows);

    // زيادة المخزون وتحديث سعر الشراء
    for (const r of rows) {
      const p = STATE.products.find(p => p.name === r.product_name);
      if (p) {
        const updated = await Api.update('products', p.id, {
          quantity: Number(p.quantity) + r.quantity, buy_price: r.price,
        });
        STATE.products = STATE.products.map(x => x.id === p.id ? updated : x);
      }
    }

    STATE.purchases.unshift(purchase);
    renderPurchases(); renderProducts();
    closeModal('modalPurchase');
    toast('تم حفظ عملية الشراء', 'success');
  } catch (err) { toast('خطأ — تأكد من إنشاء جدولي purchases و purchase_items: ' + err.message, 'error'); }
});

/* =========================================================
   الإعدادات
   ========================================================= */
function renderSettings() {
  const s = STATE.settings || {};
  qs('#setCompanyName').value = s.company_name || 'مؤسسة زروق للخدمات المطبعية';
  qs('#setPhone').value = s.phone || '';
  qs('#setAddress').value = s.address || '';
  qs('#setLogoUrl').value = s.logo_url || '';
  const img = qs('#logoPreview');
  img.src = s.logo_url || '';
}

qs('#setLogoUrl').addEventListener('input', (e) => { qs('#logoPreview').src = e.target.value; });

qs('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    company_name: qs('#setCompanyName').value.trim(),
    phone: qs('#setPhone').value.trim(),
    address: qs('#setAddress').value.trim(),
    logo_url: qs('#setLogoUrl').value.trim(),
  };
  try {
    if (STATE.settings?.id) {
      STATE.settings = await Api.update('settings', STATE.settings.id, payload);
    } else {
      STATE.settings = await Api.insert('settings', payload);
    }
    toast('تم حفظ إعدادات المؤسسة', 'success');
  } catch (err) { toast('خطأ: ' + err.message, 'error'); }
});

/* =========================================================
   التقارير
   ========================================================= */
async function runReport() {
  const from = qs('#reportFilterFrom').value;
  const to = qs('#reportFilterTo').value;

  const invs = STATE.invoices.filter(i => (!from || i.invoice_date >= from) && (!to || i.invoice_date <= to));
  const exps = STATE.expenses.filter(e => (!from || e.expense_date >= from) && (!to || e.expense_date <= to));
  const periodSales = invs.reduce((s, i) => s + Number(i.total || 0), 0);
  const periodExpenses = exps.reduce((s, e) => s + Number(e.amount || 0), 0);

  qs('#repPeriodSales').textContent = money(periodSales);
  qs('#repPeriodExpenses').textContent = money(periodExpenses);
  qs('#repPeriodProfit').textContent = money(periodSales - periodExpenses);

  // أصناف الفواتير ضمن الفترة
  let soldQty = {};
  if (invs.length) {
    const ids = invs.map(i => i.id);
    const { data: items } = await window.db.from('invoice_items').select('*').in('invoice_id', ids);
    (items || []).forEach(it => { soldQty[it.product_name] = (soldQty[it.product_name] || 0) + Number(it.quantity || 0); });
  }

  // أصناف المشتريات ضمن الفترة
  let boughtQty = {};
  const purs = STATE.purchases.filter(p => (!from || p.purchase_date >= from) && (!to || p.purchase_date <= to));
  if (purs.length) {
    const ids = purs.map(p => p.id);
    const { data: items } = await window.db.from('purchase_items').select('*').in('purchase_id', ids);
    (items || []).forEach(it => { boughtQty[it.product_name] = (boughtQty[it.product_name] || 0) + Number(it.quantity || 0); });
  }

  renderRankedList('#repTopSelling', soldQty, 'وحدة مباعة', true);
  renderRankedList('#repTopPurchased', boughtQty, 'وحدة مشتراة', true);

  // الأقل حركة: كل المنتجات مرتبة تصاعديا حسب الكمية المباعة (0 تعتبر الأبطأ)
  const lowMovement = STATE.products.map(p => ({ name: p.name, qty: soldQty[p.name] || 0 }))
    .sort((a, b) => a.qty - b.qty).slice(0, 6);
  qs('#repLowMovement').innerHTML = lowMovement.length ? lowMovement.map(x => `
    <div class="mini-row">
      <div class="mini-row-title">${x.name}</div>
      <div class="mini-row-value">${x.qty} وحدة</div>
    </div>`).join('') : `<p class="mini-empty">لا توجد بيانات كافية</p>`;

  STATE._reportCache = { from, to, periodSales, periodExpenses, soldQty, boughtQty };
}

function renderRankedList(sel, obj, unit, desc) {
  const arr = Object.entries(obj).map(([name, qty]) => ({ name, qty }));
  arr.sort((a, b) => desc ? b.qty - a.qty : a.qty - b.qty);
  const top = arr.slice(0, 6);
  qs(sel).innerHTML = top.length ? top.map(x => `
    <div class="mini-row">
      <div class="mini-row-title">${x.name}</div>
      <div class="mini-row-value">${x.qty} ${unit}</div>
    </div>`).join('') : `<p class="mini-empty">لا توجد بيانات كافية</p>`;
}

qs('#btnRunReport').addEventListener('click', runReport);
qs('#btnExportReports').addEventListener('click', () => {
  const c = STATE._reportCache;
  if (!c) { toast('اضغط "تحديث التقرير" أولا', 'error'); return; }
  const rows = [
    { البند: 'مبيعات الفترة', القيمة: c.periodSales.toFixed(2) },
    { البند: 'مصروفات الفترة', القيمة: c.periodExpenses.toFixed(2) },
    { البند: 'ربح الفترة', القيمة: (c.periodSales - c.periodExpenses).toFixed(2) },
    ...Object.entries(c.soldQty).map(([name, qty]) => ({ البند: 'مبيعات منتج: ' + name, القيمة: qty })),
    ...Object.entries(c.boughtQty).map(([name, qty]) => ({ البند: 'مشتريات منتج: ' + name, القيمة: qty })),
  ];
  exportCSV(`تقرير_زروق_${todayISO()}.csv`, rows);
});

/* =========================================================
   بدء التشغيل
   ========================================================= */
async function init() {
  qs('#yearNow').textContent = new Date().getFullYear();
  qs('#invDate').value = todayISO();
  qs('#purDate').value = todayISO();
  try {
    await loadAll();
  } catch (err) {
    console.error(err);
    toast('تعذر الاتصال بقاعدة البيانات: تحقق من مفتاح Supabase في supabase.js', 'error');
  } finally {
    qs('#loader').classList.add('hide');
  }
}
init();
