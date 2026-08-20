/* =========================================================
   app.js — مؤسسة زروق للخدمات المطبعية
   منطق التطبيق: جلب البيانات من Supabase، العرض، الإضافة/
   التعديل/الحذف، الفواتير، المشتريات، التقارير، الطباعة.
   ========================================================= */

/* شعار المؤسسة الافتراضي (مدمج) — يُستخدم عند عدم ضبط رابط شعار في الإعدادات */
const DEFAULT_LOGO = "data:image/png;base64,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    const { data, error } = await window.db.from(table).update(patch).eq('id', id).select().single();
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
