/* Single-file browser entry point. */

const initialState = () => ({
  cart: [],
  customer: null,
  discount: 0,
  paid: 0,
  billDate: new Date().toISOString().slice(0, 10),
  selectedRowIndex: -1,
  heldBills: []
});

let state = initialState();
const subscribers = new Set();

function getState() {
  return state;
}

function setState(update) {
  const next = typeof update === 'function' ? update(state) : update;
  state = { ...state, ...next };
  subscribers.forEach((subscriber) => subscriber(state));
}

function subscribe(subscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function resetBill() {
  setState({ cart: [], customer: null, discount: 0, paid: 0, selectedRowIndex: -1 });
}

const THEME_KEY = 'pos-billing:theme';
const PROFILE_KEY = 'pos-billing:profile';

const $ = (id) => document.getElementById(id);

/* ---------- Render ---------- */

function syncInputValue(input, value) {
  if (document.activeElement !== input && input.value !== value) {
    input.value = value;
  }
}

function render(state) {
  renderCart(state);
  renderTotals(state);
  renderHeldCount(state);
  syncCustomerSelect(state);
  syncInputValue($('billDate'), state.billDate);
}

/* ---------- Theme (Theme option in avatar menu) ---------- */

function setTheme(mode) {
  document.documentElement.setAttribute('data-bs-theme', mode);
  localStorage.setItem(THEME_KEY, mode);
  const themeToggle = $('themeToggle');
  if (themeToggle) {
    themeToggle.setAttribute('aria-pressed', mode === 'dark');
    themeToggle.title = `Switch to ${mode === 'dark' ? 'light' : 'dark'} theme`;
  }
}

function initTheme() {
  setTheme(localStorage.getItem(THEME_KEY) || 'light');

  $('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-bs-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  });
}

/* ---------- Mobile menu: forward clicks to the matching desktop button ---------- */
function initForwardClicks() {
  document.querySelectorAll('[data-forward]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelector(btn.dataset.forward)?.click();
    });
  });
}

/* ---------- Account (Account option in avatar menu) ---------- */

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* storage full: the new avatar is shown but not kept after refresh */
  }
}

function applyProfile(profile) {
  const img = document.querySelector('.avatar-img');
  img.src = profile.avatar || 'assets/img/avatar.png';
  img.alt = profile.name || 'Account';
  const profileName = $('profileName');
  if (profileName) profileName.textContent = profile.name || 'Account';
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function initAccount() {
  applyProfile(loadProfile());

  const modal = $('accountModal');
  modal.addEventListener('show.bs.modal', () => {
    $('accountName').value = loadProfile().name || '';
  });

  $('accountForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const profile = loadProfile();
    const name = $('accountName').value.trim();
    const file = $('accountAvatar').files[0];

    if (name) profile.name = name;
    if (file) profile.avatar = await readFileAsDataURL(file);

    saveProfile(profile);
    applyProfile(profile);
    e.target.reset();
    bootstrap.Modal.getInstance(modal)?.hide();
  });
}

/* ---------- Logout ---------- */

function initLogout() {
  $('logoutBtn').addEventListener('click', () => {
    if (confirm('Log out of your account?')) {
      window.location.href = 'login.html';
    }
  });
}

/* ---------- Bill date and summary buttons ---------- */

function initBillDate() {
  $('billDate').addEventListener('change', (e) => {
    setState({ billDate: e.target.value });
  });
}

function initSummaryActions() {
  $('draftBtn').addEventListener('click', () => {
    if (!holdBill()) alert('Add items to the cart before saving a draft.');
  });

  $('saveBtn').addEventListener('click', () => {
    finalizeBill({ print: true });
  });

  $('resetBtn').addEventListener('click', () => {
    const s = getState();
    const hasData = s.cart.length > 0 || s.customer;
    if (hasData && !confirm('Reset this bill? Items and customer will be cleared.')) return;
    resetBill();
  });
}

/* ---------- Start ---------- */

async function init() {
  initTheme();
  initAccount();
  initCart();
  initTotals();
  initSearch();
  initHeld();
  initShortcuts();
  initSummaryActions();
  initBillDate();
  initLogout();

  await Promise.all([loadProducts(), loadCustomers()]);
  initCustomers();

  subscribe(render);
  render(getState());
  focusSearch();
}

init();

/* js/format.js
   Number, money, date, and HTML-escaping helpers. */

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value) {
  return toNumber(value).toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/** "2026-10-11" -> "11/10/2026" */
function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* js/totals.js
   Calculates totals from the cart and renders the summary fields.
   Balance formula (assumed, confirm with client):
   Balance = Previous balance + Net total - Paid */
function computeTotals(state = getState()) {
  const grandTotal = state.cart.reduce((sum, row) => sum + row.price * row.qty, 0);
  const discount = Math.min(Math.max(toNumber(state.discount), 0), grandTotal);
  const netTotal = grandTotal - discount;
  const previousBalance = state.customer?.previousBalance ?? 0;
  const paid = Math.max(toNumber(state.paid), 0);
  const balance = previousBalance + netTotal - paid;
  const overpaid = paid > previousBalance + netTotal;

  return { grandTotal, discount, netTotal, previousBalance, paid, balance, overpaid };
}

const el = (id) => document.getElementById(id);

/** Set an input's value only when the user is not typing in it. */
function syncInput(id, value) {
  const input = el(id);
  if (document.activeElement === input) return;
  const next = Number(value || 0).toFixed(2);
  if (input.value !== next) input.value = next;
}

function renderTotals(state = getState()) {
  const t = computeTotals(state);

  el('prevBalance').value = formatMoney(t.previousBalance);
  el('grandTotal').value = formatMoney(t.grandTotal);
  el('netTotal').value = formatMoney(t.netTotal);
  el('balance').value = formatMoney(t.balance);

  syncInput('discount', state.discount);
  syncInput('paid', state.paid);

  el('paid').classList.toggle('is-invalid', t.overpaid);
}

function initTotals() {
  el('discount').addEventListener('input', (e) => {
    setState({ discount: toNumber(e.target.value) });
  });

  el('paid').addEventListener('input', (e) => {
    setState({ paid: toNumber(e.target.value) });
  });
}
/* js/cart.js
   Cart rows: add, edit qty and price, remove, and arrow-key selection. */
let lastRenderKey = '';

/* ---------- Changes ---------- */

function addItem(product) {
  const { cart } = getState();
  const idx = cart.findIndex((row) => row.id === product.id);

  if (idx >= 0) {
    const updated = cart.map((row, i) => (i === idx ? { ...row, qty: row.qty + 1 } : row));
    setState({ cart: updated, selectedRowIndex: idx });
  } else {
    const row = {
      id: product.id,
      barcode: product.barcode,
      sku: product.sku,
      name: product.name,
      price: Number(product.price),
      qty: 1
    };
    setState({ cart: [...cart, row], selectedRowIndex: cart.length });
  }
}

function updateRow(index, field, value) {
  setState((s) => ({
    cart: s.cart.map((row, i) => (i === index ? { ...row, [field]: value } : row))
  }));
}

function removeRow(index) {
  setState((s) => {
    const cart = s.cart.filter((_, i) => i !== index);
    const selectedRowIndex = cart.length ? Math.min(s.selectedRowIndex, cart.length - 1) : -1;
    return { cart, selectedRowIndex };
  });
}

function removeLast() {
  const { cart } = getState();
  if (cart.length) removeRow(cart.length - 1);
}

function clearCart() {
  setState({ cart: [], selectedRowIndex: -1 });
}

function moveSelection(delta) {
  const { cart, selectedRowIndex } = getState();
  if (!cart.length) return;

  const next = selectedRowIndex < 0
    ? 0
    : Math.min(Math.max(selectedRowIndex + delta, 0), cart.length - 1);

  setState({ selectedRowIndex: next });

  document
    .querySelector(`#cartBody tr[data-index="${next}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}

/** Focus and select a price or qty input in a given row (used by F9 and Ctrl+Z). */
function focusField(index, field) {
  requestAnimationFrame(() => {
    const row = document.querySelector(`#cartBody tr[data-index="${index}"]`);
    const input = row?.querySelector(`[data-field="${field}"]`);
    if (input) {
      input.focus();
      input.select();
    }
  });
}

/* ---------- Rendering ---------- */

function renderCart(state = getState()) {
  const key = JSON.stringify([state.cart, state.selectedRowIndex]);
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  const body = document.getElementById('cartBody');

  if (!state.cart.length) {
    body.innerHTML = `
      <tr class="empty-row">
        <td colspan="7" class="text-center text-body-secondary py-5">
          No items in cart. Scan or type a barcode to begin.
        </td>
      </tr>`;
    return;
  }

  body.innerHTML = state.cart
    .map((row, i) => `
      <tr data-index="${i}" class="${i === state.selectedRowIndex ? 'is-selected' : ''}">
        <td>${escapeHtml(row.barcode)}</td>
        <td>${escapeHtml(row.sku)}</td>
        <td>${escapeHtml(row.name)}</td>
        <td class="text-end">
          <input type="number" class="form-control form-control-sm text-end"
                 data-field="price" value="${row.price}" min="0" step="0.01"
                 aria-label="Price">
        </td>
        <td class="text-center">
          <input type="number" class="form-control form-control-sm text-center qty-input"
                 data-field="qty" value="${row.qty}" min="1" step="1"
                 aria-label="Quantity">
        </td>
        <td class="text-end">${formatMoney(row.price * row.qty)}</td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-link text-danger p-0"
                  data-action="remove" aria-label="Remove row">
            <i class="bi bi-x-lg"></i>
          </button>
        </td>
      </tr>`)
    .join('');
}

/* ---------- Events (event delegation on the table body) ---------- */

function initCart() {
  const body = document.getElementById('cartBody');

  body.addEventListener('change', (e) => {
    const input = e.target.closest('input[data-field]');
    if (!input) return;

    const index = Number(input.closest('tr').dataset.index);

    if (input.dataset.field === 'qty') {
      const qty = Math.max(1, Math.floor(toNumber(input.value)) || 1);
      updateRow(index, 'qty', qty);
    } else {
      updateRow(index, 'price', Math.max(0, toNumber(input.value)));
    }
  });

  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove"]');
    if (!btn) return;
    removeRow(Number(btn.closest('tr').dataset.index));
  });
}
/* js/search.js
   Barcode, SKU, and name lookup. Enter adds the match to the cart. */
let products = [];

async function loadProducts() {
  try {
    const res = await fetch('data/products.json');
    if (!res.ok) throw new Error(res.statusText);
    products = await res.json();
  } catch (err) {
    console.error('Could not load products:', err);
    products = [];
  }
}

function getProducts() {
  return products;
}

/** Exact barcode, then exact SKU, then partial name. */
function findProduct(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  return (
    products.find((p) => p.barcode?.toLowerCase() === q) ||
    products.find((p) => p.sku?.toLowerCase() === q) ||
    products.find((p) => p.name?.toLowerCase().includes(q)) ||
    null
  );
}

function focusSearch({ clear = false } = {}) {
  const input = document.getElementById('searchInput');
  if (clear) input.value = '';
  input.focus();
  input.select();
}

function initSearch() {
  const input = document.getElementById('searchInput');

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    const match = findProduct(input.value);
    if (!match) {
      input.classList.add('is-invalid');
      input.select();
      return;
    }

    addItem(match);
    input.value = '';
    input.classList.remove('is-invalid');
  });

  input.addEventListener('input', () => {
    input.classList.remove('is-invalid');
  });
}
/* js/customers.js
   Customer dropdown and the add-customer modal. */
let customers = [];

async function loadCustomers() {
  try {
    const res = await fetch('data/customers.json');
    if (!res.ok) throw new Error(res.statusText);
    customers = await res.json();
  } catch (err) {
    console.error('Could not load customers:', err);
    customers = [];
  }
  renderOptions();
}

function renderOptions() {
  const select = document.getElementById('customerSelect');
  select.innerHTML =
    '<option value="">-- Select customer --</option>' +
    customers
      .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
      .join('');
  syncCustomerSelect(getState());
}

/** Keep the dropdown showing the customer that is in state. */
function syncCustomerSelect(state) {
  const select = document.getElementById('customerSelect');
  const wanted = state.customer ? String(state.customer.id) : '';
  if (select.value !== wanted) select.value = wanted;
}

function initCustomers() {
  const select = document.getElementById('customerSelect');

  select.addEventListener('change', () => {
    const customer = customers.find((c) => String(c.id) === select.value) || null;
    setState({ customer });
  });

  const form = document.getElementById('customerForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = document.getElementById('customerName').value.trim();
    const phone = document.getElementById('customerPhone').value.trim();
    if (!name) return;

    const customer = { id: `new-${Date.now()}`, name, phone, previousBalance: 0 };
    customers = [...customers, customer];

    renderOptions();
    setState({ customer });

    form.reset();
    bootstrap.Modal.getInstance(document.getElementById('customerModal'))?.hide();
  });
}
/* js/held-bills.js
   Hold the current bill (F6 / Draft) and resume it (Held button).
   Resume takes the most recently held bill first. */
function holdBill() {
  const s = getState();
  if (!s.cart.length) return false;

  const bill = {
    id: String(Date.now()),
    savedAt: new Date().toISOString(),
    cart: s.cart,
    customer: s.customer,
    discount: s.discount,
    paid: s.paid
  };

  setState({ heldBills: [...s.heldBills, bill] });
  resetBill();
  return true;
}

function resumeLastHeldBill() {
  const s = getState();
  if (!s.heldBills.length) return false;

  const bill = s.heldBills[s.heldBills.length - 1];

  setState({
    cart: bill.cart,
    customer: bill.customer,
    discount: bill.discount,
    paid: bill.paid,
    selectedRowIndex: -1,
    heldBills: s.heldBills.slice(0, -1)
  });
  return true;
}

function renderHeldCount(state = getState()) {
  document.getElementById('heldCount').textContent = state.heldBills.length;
}

function initHeld() {
  document.getElementById('heldBtn').addEventListener('click', () => {
    if (getState().cart.length) {
      alert('Hold or save the current bill before resuming another one.');
      return;
    }
    if (!resumeLastHeldBill()) alert('No held bills.');
  });
}
/* js/shortcuts.js
   Keyboard shortcuts. Disabled while a modal is open. */
const isModalOpen = () => !!document.querySelector('.modal.show');

const isTypingIn = (el) =>
  !!el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);

function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (isModalOpen()) return;

    const s = getState();
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.toLowerCase();
    const lastIndex = s.cart.length - 1;

    const run = (fn) => {
      e.preventDefault();
      fn();
    };

    if (key === 'Escape') return run(() => focusSearch());
    if (key === 'F2')     return run(() => focusSearch({ clear: true }));
    if (key === 'F6')     return run(() => holdBill());
    if (key === 'F9')     return run(() => focusField(lastIndex, 'qty'));

    if (ctrl && lower === 'z') {
      const index = s.selectedRowIndex >= 0 ? s.selectedRowIndex : lastIndex;
      return run(() => focusField(index, 'price'));
    }
    if (ctrl && lower === 'd') return run(() => removeLast());
    if (ctrl && lower === 'r') {
      return run(() => {
        if (s.cart.length && confirm('Clear all items from the cart?')) clearCart();
      });
    }
    if (ctrl && lower === 's') return run(() => finalizeBill({ print: false }));
    if (ctrl && lower === 'p') return run(() => finalizeBill({ print: true }));

    if ((key === 'ArrowDown' || key === 'ArrowUp') && !isTypingIn(document.activeElement)) {
      return run(() => moveSelection(key === 'ArrowDown' ? 1 : -1));
    }
  });
}
/* js/print.js
   Finalizes a bill (Pay / Save, Save & Print), saves a sales record,
   and prints a receipt through a hidden iframe (no popup). */
const SALES_KEY = 'pos-billing:sales';

function finalizeBill({ print = false } = {}) {
  const s = getState();

  if (!s.cart.length) {
    alert('Add items to the cart first.');
    return false;
  }

  const totals = computeTotals(s);
  if (totals.overpaid) {
    alert('Customer paid is more than the net total plus previous balance.');
    return false;
  }

  const bill = {
    id: String(Date.now()),
    billDate: s.billDate,
    savedAt: new Date().toISOString(),
    cart: s.cart,
    customer: s.customer,
    discount: s.discount,
    paid: s.paid,
    totals
  };

  saveSale(bill);
  if (print) printReceipt(bill);
  resetBill();
  return true;
}

function saveSale(bill) {
  try {
    const sales = JSON.parse(localStorage.getItem(SALES_KEY) || '[]');
    sales.push(bill);
    localStorage.setItem(SALES_KEY, JSON.stringify(sales));
  } catch {
    /* storage unavailable: the sale still prints */
  }
}

function printReceipt(bill) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  win.document.open();
  win.document.write(buildReceiptHTML(bill));
  win.document.close();

  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 50);
}

function buildReceiptHTML(bill) {
  const t = bill.totals;

  const items = bill.cart
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(r.name)}<br><small>${formatMoney(r.price)} × ${r.qty}</small></td>
          <td class="r">${formatMoney(r.price * r.qty)}</td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font-family: monospace; font-size: 12px; width: 72mm; margin: 0; color: #000; }
    h1 { font-size: 14px; text-align: center; margin: 0 0 2px; }
    .c { text-align: center; }
    .r { text-align: right; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; padding: 2px 0; }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  </style>
</head>
<body>
  <h1>Arif &amp; Brothers</h1>
  <div class="c">Plywood &amp; Hardware</div>
  <div class="c">Qasim Road Bahawalnagar</div>
  <hr>
  <div>Date: ${formatDate(bill.billDate)}</div>
  <div>Customer: ${escapeHtml(bill.customer?.name ?? 'Walk-in customer')}</div>
  <hr>
  <table>${items}</table>
  <hr>
  <table>
    <tr><td>Grand total</td><td class="r">${formatMoney(t.grandTotal)}</td></tr>
    <tr><td>Discount</td><td class="r">${formatMoney(t.discount)}</td></tr>
    <tr><td>Net total</td><td class="r">${formatMoney(t.netTotal)}</td></tr>
    <tr><td>Previous balance</td><td class="r">${formatMoney(t.previousBalance)}</td></tr>
    <tr><td>Paid</td><td class="r">${formatMoney(t.paid)}</td></tr>
    <tr><td><b>Balance</b></td><td class="r"><b>${formatMoney(t.balance)}</b></td></tr>
  </table>
  <hr>
  <div class="c">Thank you for your business</div>
</body>
</html>`;
}