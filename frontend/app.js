/**
 * AegisIQ Stock Ledger – App Controller
 * Matrix Grid + Detail Drawer Architecture
 */

/* ================= CONFIG ================= */

const isLocalDev =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const API_BASE_URL = isLocalDev
  ? "http://localhost:8888/api"
  : "/.netlify/functions";

const API_URL = `${API_BASE_URL}/ledger`;
const ID_OFFSET = 1000;

/* ================= STATE ================= */

let shareholders = [];
let entities = [];
let stockTypes = [];

/* ================= HELPERS ================= */

const displayId = id => Number(id) + ID_OFFSET;
const accountNumber = (e, s) => `SH-${displayId(s)}`;
const bookEntryId = id => `BE-${displayId(id)}`;

const formatShares = n =>
  Number(n) > 0 ? Number(n).toLocaleString() : "—";

const formatPercentage = (v, t) =>
  t ? ((v / t) * 100).toFixed(1) + "%" : "0%";

const formatDate = d =>
  d ? new Date(d).toLocaleDateString("en-US") : "—";

/* ================= API ================= */

async function apiCall(action, params = {}, method = "GET", body) {
  const url = new URL(API_URL, window.location.origin);
  url.searchParams.set("action", action);

  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined) {
      url.searchParams.set(k, v);
    }
  });

  const res = await fetch(url.toString(), {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) throw new Error("API Error");
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data;
}

/* ================= INIT ================= */

document.addEventListener("DOMContentLoaded", async () => {
  await loadEntities();
  await loadStockTypes();
  
  // Try to load from API, fallback to demo data
  try {
    await loadOwnership();
  } catch (e) {
    // Use demo data if API fails
    shareholders = [];
    renderHoldingsMatrix();
    updateStats();
  }

  document
    .getElementById("mobileMenuToggle")
    ?.addEventListener("click", () =>
      document.getElementById("mobileMenu").classList.toggle("hidden")
    );
});

/* ================= DATA ================= */

async function loadEntities() {
  entities = [{ id: 1, name: "AegisIQ Corp" }];
  populateSelect("entityFilter", true);
  populateSelect("shareholderEntity");
}

async function loadStockTypes() {
  stockTypes = [
    { type: "COMMON", supports_series: false },
    { type: "PREFERRED", supports_series: true, series: ["A", "B"] }
  ];
  populateStockTypeSelects();
}

function populateSelect(id, all = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = all ? `<option value="">All</option>` : "";
  entities.forEach(e => {
    el.innerHTML += `<option value="${e.id}">${e.name}</option>`;
  });
}

function populateStockTypeSelects() {
  ["stockTypeFilter", "issueStockType", "transferStockType"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML =
      id === "stockTypeFilter"
        ? `<option value="">All Stock Types</option>`
        : `<option value="">Select Stock Type</option>`;
    stockTypes.forEach(s => {
      el.innerHTML += `<option value="${s.type}">${s.type}</option>`;
    });
  });
}

async function loadOwnership() {
  const params = {
    search: searchInput.value,
    entity_id: entityFilter.value,
    stock_type: stockTypeFilter.value,
    series: seriesFilter.value,
    status: statusFilter.value
  };

  const data = await apiCall("ownership", params);
  shareholders = normalizeOwnership(data.ownership || []);
  renderHoldingsMatrix();
  updateStats();
}

function normalizeOwnership(rows) {
  const map = new Map();

  rows.forEach(r => {
    if (!map.has(r.shareholder_id)) {
      map.set(r.shareholder_id, {
        id: r.shareholder_id,
        entity_id: 1,
        full_name: r.full_name,
        address: r.address,
        holdings: { common: 0, seriesA: 0, seriesB: 0 },
        total: 0
      });
    }
    const sh = map.get(r.shareholder_id);
    const s = Number(r.current_shares) || 0;

    if (r.stock_type === "COMMON") sh.holdings.common += s;
    if (r.stock_type === "PREFERRED" && r.series === "A")
      sh.holdings.seriesA += s;
    if (r.stock_type === "PREFERRED" && r.series === "B")
      sh.holdings.seriesB += s;

    sh.total =
      sh.holdings.common + sh.holdings.seriesA + sh.holdings.seriesB;
  });

  return [...map.values()];
}

/* ================= MATRIX - DARK EXECUTIVE ================= */

// Demo shareholders data
const demoShareholders = [
  { id: 1, entity_id: 1, full_name: "Jane Holder", address: "101 Market St, Miami, FL", holdings: { common: 250000, seriesA: 1250000, seriesB: 0 }, total: 1500000 },
  { id: 2, entity_id: 1, full_name: "John Smith", address: "450 Park Ave, New York, NY", holdings: { common: 500000, seriesA: 750000, seriesB: 250000 }, total: 1500000 },
  { id: 3, entity_id: 1, full_name: "Acme Ventures LLC", address: "1 Embarcadero Center, San Francisco, CA", holdings: { common: 0, seriesA: 2000000, seriesB: 1000000 }, total: 3000000 },
  { id: 4, entity_id: 1, full_name: "Sarah Chen", address: "888 Brannan St, San Francisco, CA", holdings: { common: 125000, seriesA: 375000, seriesB: 0 }, total: 500000 },
  { id: 5, entity_id: 1, full_name: "Michael O'Brien", address: "225 Franklin St, Boston, MA", holdings: { common: 300000, seriesA: 0, seriesB: 200000 }, total: 500000 },
  { id: 6, entity_id: 1, full_name: "Blue Horizon Partners", address: "2000 Avenue of Stars, Los Angeles, CA", holdings: { common: 0, seriesA: 1500000, seriesB: 500000 }, total: 2000000 },
  { id: 7, entity_id: 1, full_name: "Emily Rodriguez", address: "1200 Brickell Ave, Miami, FL", holdings: { common: 175000, seriesA: 325000, seriesB: 0 }, total: 500000 },
  { id: 8, entity_id: 1, full_name: "TechGrowth Capital", address: "3000 Sand Hill Rd, Menlo Park, CA", holdings: { common: 0, seriesA: 0, seriesB: 2500000 }, total: 2500000 }
];

function renderHoldingsMatrix() {
  const body = document.getElementById("holdingsMatrixBody");
  body.innerHTML = "";

  // Use demo data if no API data
  const data = shareholders.length > 0 ? shareholders : demoShareholders;
  const grandTotal = data.reduce((a, b) => a + b.total, 0);
  const totalCommon = data.reduce((a, b) => a + b.holdings.common, 0);
  const totalSeriesA = data.reduce((a, b) => a + b.holdings.seriesA, 0);
  const totalSeriesB = data.reduce((a, b) => a + b.holdings.seriesB, 0);

  data.forEach((sh) => {
    // Main row
    const row = document.createElement("div");
    row.className = "matrix-row";
    row.dataset.shareholderId = sh.id;
    row.onclick = () => toggleRowExpand(sh.id);

    const pct = grandTotal > 0 ? ((sh.total / grandTotal) * 100).toFixed(1) : 0;

    row.innerHTML = `
      <div class="matrix-cell expand-toggle">
        <svg class="expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>
      <div class="matrix-cell account-col">${accountNumber(sh.entity_id, sh.id)}</div>
      <div class="matrix-cell name-col">${sh.full_name}</div>
      <div class="matrix-cell address-col">${sh.address || '—'}</div>
      <div class="matrix-cell common-col">${formatShares(sh.holdings.common)}</div>
      <div class="matrix-cell series-col">${formatShares(sh.holdings.seriesA)}</div>
      <div class="matrix-cell series-col">${formatShares(sh.holdings.seriesB)}</div>
      <div class="matrix-cell total-col">${formatShares(sh.total)}</div>
      <div class="matrix-cell pct-col">${pct}%</div>
      <div class="matrix-cell actions-col">
        <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); openRowMenu(${sh.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="1"></circle>
            <circle cx="19" cy="12" r="1"></circle>
            <circle cx="5" cy="12" r="1"></circle>
          </svg>
        </button>
      </div>
    `;
    body.appendChild(row);

    // Expandable panel
    const panel = document.createElement("div");
    panel.className = "holdings-expand-panel";
    panel.id = `expand-panel-${sh.id}`;
    panel.innerHTML = buildHoldingsSections(sh);
    body.appendChild(panel);
  });

  // Update footer totals
  const footerCommon = document.getElementById("footerCommon");
  const footerSeriesA = document.getElementById("footerSeriesA");
  const footerSeriesB = document.getElementById("footerSeriesB");
  const footerTotal = document.getElementById("footerTotal");
  
  if (footerCommon) footerCommon.textContent = formatShares(totalCommon);
  if (footerSeriesA) footerSeriesA.textContent = formatShares(totalSeriesA);
  if (footerSeriesB) footerSeriesB.textContent = formatShares(totalSeriesB);
  if (footerTotal) footerTotal.textContent = formatShares(grandTotal);

  // Update stats
  if (data === demoShareholders) {
    document.getElementById("totalShareholdersCount").textContent = data.length;
    document.getElementById("totalSharesCount").textContent = formatShares(grandTotal);
  }
}

function buildHoldingsSections(sh) {
  let html = '';
  
  if (sh.holdings.seriesA > 0) {
    html += buildSection('Series A Preferred', sh.holdings.seriesA, 'seriesA');
  }
  if (sh.holdings.seriesB > 0) {
    html += buildSection('Series B Preferred', sh.holdings.seriesB, 'seriesB');
  }
  if (sh.holdings.common > 0) {
    html += buildSection('Common Stock', sh.holdings.common, 'common');
  }
  
  return html || '<div class="empty-note" style="padding: 20px 32px; color: #64748b;">No holdings</div>';
}

function buildSection(title, shares, type) {
  return `
    <div class="holdings-section">
      <div class="holdings-section-header" onclick="toggleHoldingsSection(this)">
        <div class="holdings-section-title">
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span class="holdings-section-name">${title}</span>
          <span class="holdings-section-shares">- ${shares.toLocaleString()} Shares</span>
        </div>
        <div class="holdings-section-actions">
          <button onclick="event.stopPropagation()">...</button>
        </div>
      </div>
      <table class="book-entries-table">
        <thead>
          <tr>
            <th>Book Entry ID</th>
            <th>Shares</th>
            <th>Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="entry-id">BE-${10000 + Math.floor(Math.random() * 999)}</td>
            <td class="shares-value">${Math.floor(shares * 0.4).toLocaleString()}</td>
            <td class="date-value">06/01/2025</td>
            <td><span class="status-badge active">Active</span></td>
          </tr>
          <tr>
            <td class="entry-id">BE-${10000 + Math.floor(Math.random() * 999)}</td>
            <td class="shares-value">${Math.floor(shares * 0.6).toLocaleString()}</td>
            <td class="date-value">09/15/2025</td>
            <td><span class="status-badge active">Active</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function toggleRowExpand(shareholderId) {
  const row = document.querySelector(`.matrix-row[data-shareholder-id="${shareholderId}"]`);
  const panel = document.getElementById(`expand-panel-${shareholderId}`);
  
  if (row && panel) {
    row.classList.toggle('expanded');
    panel.classList.toggle('open');
  }
}

function toggleHoldingsSection(header) {
  const section = header.closest('.holdings-section');
  if (section) {
    section.classList.toggle('open');
  }
}

function openRowMenu(shareholderId) {
  // Placeholder for row actions menu
  console.log('Open menu for shareholder:', shareholderId);
}

/* ================= DRAWER ================= */

function openDetailDrawerFor(sh) {
  drawerName.textContent = sh.full_name;
  drawerAddress.textContent = sh.address || "—";
  document.querySelector(".drawer-sub").textContent =
    `Shareholder · ${accountNumber(sh.entity_id, sh.id)}`;

  renderDrawerHoldings(sh);
  loadDrawerEntries(sh.id);

  switchDrawerTab("holdings", { currentTarget: drawerTabs[0] });
  detailDrawer.classList.add("open");
}

function renderDrawerHoldings(sh) {
  drawerHoldings.innerHTML = `
    ${sh.holdings.seriesA ? section("Series A Preferred", sh.holdings.seriesA) : ""}
    ${sh.holdings.seriesB ? section("Series B Preferred", sh.holdings.seriesB) : ""}
    ${sh.holdings.common ? section("Common Stock", sh.holdings.common) : ""}
  `;
}

const section = (t, s) => `
  <div class="drawer-section">
    <div class="section-title">${t} – ${s.toLocaleString()} Shares</div>
  </div>
`;

async function loadDrawerEntries(id) {
  drawerEntries.innerHTML = `<div class="empty-note">Loading…</div>`;
  const data = await apiCall("transactions", { shareholder_id: id });

  if (!data.transactions?.length) {
    drawerEntries.innerHTML = `<div class="empty-note">No entries</div>`;
    return;
  }

  drawerEntries.innerHTML = `
    <table class="drawer-table">
      <thead>
        <tr><th>Book Entry</th><th>Shares</th><th>Date</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${data.transactions
          .map(
            t => `
          <tr>
            <td>${bookEntryId(t.id)}</td>
            <td>${t.shares.toLocaleString()}</td>
            <td>${formatDate(t.transaction_date)}</td>
            <td class="status-active">Active</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

/* ================= UI ================= */

function switchDrawerTab(tab, e) {
  document
    .querySelectorAll(".drawer-tab")
    .forEach(t => t.classList.remove("active"));
  document
    .querySelectorAll(".drawer-panel")
    .forEach(p => p.classList.remove("active"));

  document.getElementById(`drawer-${tab}`).classList.add("active");
  e.currentTarget.classList.add("active");
}

function closeDrawer() {
  detailDrawer.classList.remove("open");
}

function applyFilters() {
  loadOwnership();
}

function resetFilters() {
  searchInput.value =
    entityFilter.value =
    stockTypeFilter.value =
    seriesFilter.value =
    statusFilter.value =
      "";
  loadOwnership();
}

function exportCSV() {
  const total = shareholders.reduce((a, s) => a + s.total, 0);
  const rows = shareholders.map(s => [
    accountNumber(s.entity_id, s.id),
    s.full_name,
    s.holdings.common,
    s.holdings.seriesA,
    s.holdings.seriesB,
    s.total,
    formatPercentage(s.total, total)
  ]);

  const csv =
    ["Account #,Shareholder,Common,Series A,Series B,Total,%"]
      .concat(rows.map(r => r.join(",")))
      .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "holdings-matrix.csv";
  a.click();
}

/* ================= STATS ================= */

function updateStats() {
  const data = shareholders.length > 0 ? shareholders : demoShareholders;
  const total = data.reduce((a, s) => a + s.total, 0);
  document.getElementById("totalShareholdersCount").textContent = data.length;
  document.getElementById("totalSharesCount").textContent = formatShares(total);
}

function logout() {
  // Clear auth data from localStorage
  localStorage.removeItem('auth_token');
  localStorage.removeItem('user');
  
  // Redirect to login page
  window.location.href = 'login.html';
}
