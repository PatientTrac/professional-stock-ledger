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

const ID_OFFSET = 1000;

/* ================= STATE ================= */

let shareholders = [];
let entities = [];
let stockTypes = [];
let allSeries = []; // series for selected stock type
let currentUser = null; // logged in user

/* ================= USER HELPERS ================= */

function getCurrentUser() {
  if (currentUser) return currentUser;
  const userStr = localStorage.getItem('user');
  if (!userStr) return null;
  try {
    currentUser = JSON.parse(userStr);
    return currentUser;
  } catch {
    return null;
  }
}

function isSuperAdmin() {
  const user = getCurrentUser();
  return user && user.role === 'SUPER_ADMIN';
}

function getUserEntityId() {
  const user = getCurrentUser();
  return user ? user.entity_id : null;
}

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

async function apiCall(endpoint, action, params = {}, method = "GET", body) {
  const url = new URL(`${API_BASE_URL}/${endpoint}`, window.location.origin);
  url.searchParams.set("action", action);

  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined) {
      url.searchParams.set(k, v);
    }
  });

  const token = localStorage.getItem('auth_token');

  try {
    const res = await fetch(url.toString(), {
      method,
      headers: {
        'Content-Type': 'application/json',
		'Cache-Control': 'no-store, no-cache, must-revalidate',
		'Pragma': 'no-cache',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (res.status === 401) {
      console.warn("Unauthorized – logging out...");
      alert("Your session has expired. Please log in again.");
      logout();
      return;
    }

    if (!res.ok) {
      throw new Error(`API Error: ${res.status}`);
    }

    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data;

  } catch (err) {
    console.error("API call failed:", err);
    throw err;
  }
}

/* ================= INIT ================= */

document.addEventListener("DOMContentLoaded", async () => {
  // Check auth
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  const user = getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  try {
    // Setup UI based on user role
    setupRoleBasedUI(user);
    
    // Load reference data first
    await Promise.all([
      loadEntities(),
      loadStockTypes()
    ]);
    
    // Set initial entity filter based on role
    const entityFilter = document.getElementById("entityFilter");
    if (!isSuperAdmin() && user.entity_id) {
      // Non-super admins: set their entity and disable filter
      entityFilter.value = user.entity_id;
    }
    
    // Load initial entity header
    const selectedEntity = entityFilter.value || (isSuperAdmin() ? "" : user.entity_id);
    await loadEntityInfo(selectedEntity);

    // Load ownership data
    await loadOwnership();
  } catch (e) {
    console.error("Initialization failed:", e);
    shareholders = [];
    renderHoldingsMatrix();
    updateStats();
  }
  
  // Event listeners
  document.getElementById("entityFilter").addEventListener("change", async () => {
    const selectedId = document.getElementById("entityFilter").value;
    await loadEntityInfo(selectedId);
    await loadOwnership();
  });

  document.getElementById("mobileMenuToggle")?.addEventListener("click", () =>
    document.getElementById("mobileMenu").classList.toggle("hidden")
  );

  // User dropdown toggle
  const userTrigger = document.getElementById('userTrigger');
  const userDropdown = document.getElementById('userDropdown');

  if (userTrigger && userDropdown) {
    userTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!userDropdown.contains(e.target)) {
        userDropdown.classList.remove('open');
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        userDropdown.classList.remove('open');
      }
    });
  }
});

/* ================= ROLE-BASED UI ================= */

function setupRoleBasedUI(user) {
  const entityFilterContainer = document.getElementById('entityFilter')?.closest('.filter-group') 
    || document.getElementById('entityFilter')?.parentElement;
  const entityFilterEl = document.getElementById('entityFilter');
  
  // Display user info in header dropdown
  const userNameEl = document.getElementById('userName');
  const userAvatarEl = document.getElementById('userAvatar');
  const userEmailEl = document.getElementById('userEmail');
  const userRoleEl = document.getElementById('userRole');
  
  if (userNameEl) {
    userNameEl.textContent = user.full_name || user.email.split('@')[0];
  }
  
  if (userAvatarEl) {
    // Generate initials from full_name or email
    const name = user.full_name || user.email;
    const initials = name
      .split(/[\s@]/)  // Split by space or @
      .filter(Boolean)
      .slice(0, 2)
      .map(n => n[0])
      .join('')
      .toUpperCase();
    userAvatarEl.textContent = initials || '??';
  }
  
  if (userEmailEl) {
    userEmailEl.textContent = user.email;
  }
  
  if (userRoleEl) {
    userRoleEl.textContent = user.role.replace(/_/g, ' ');
  }
  
  if (isSuperAdmin()) {
    // Super admin can see and use entity filter
    if (entityFilterEl) {
      entityFilterEl.style.display = 'block';
      entityFilterEl.disabled = false;
    }
  } else {
    // Non-super admins: hide entity filter completely
    if (entityFilterEl) {
      entityFilterEl.style.display = 'none';
    }
  }
}

/* ================= DATA LOADING ================= */

async function loadEntities() {
  try {
    const data = await apiCall("entities", "list");

    if (!data || !Array.isArray(data.entities)) {
      throw new Error("Invalid entities response");
    }

    entities = data.entities;
    populateEntityDropdowns();
  } catch (err) {
    console.error("Failed to load entities:", err);
    entities = [];
    populateEntityDropdowns();
  }
}

function populateEntityDropdowns() {
  // Main filter dropdown
  const filterDropdown = document.getElementById("entityFilter");
  if (filterDropdown) {
    filterDropdown.innerHTML = `<option value="">All Entities</option>`;
    entities.forEach(e => {
      filterDropdown.innerHTML += `<option value="${e.id}">${e.name}</option>`;
    });
  }

  // Create shareholder modal dropdown
  const shareholderDropdown = document.getElementById("shareholderEntity");
  if (shareholderDropdown) {
    shareholderDropdown.innerHTML = `<option value="">Select Entity</option>`;
    entities.forEach(e => {
      shareholderDropdown.innerHTML += `<option value="${e.id}">${e.name}</option>`;
    });
  }
}

async function loadEntityInfo(entityId) {
  try {
    // Default state (All Entities)
    document.getElementById("entityName").textContent = "All Entities";

    // Clear fields
    document.getElementById("entityId").textContent = "";
    document.getElementById("entityAddress").textContent = "";
    document.getElementById("entityEmail").textContent = "";
    document.getElementById("entityPhone").textContent = "";

    if (!entityId) return;

    const data = await apiCall("entities", "get", { entityId });

    if (!data?.entity) return;

    const e = data.entity;

    document.getElementById("entityName").textContent = e.name || "—";
    document.getElementById("entityId").textContent = e.id || "—";

    // Build address line
    const addressParts = [
      e.address,
      e.city,
      e.state,
      e.zip_code,
      e.country
    ].filter(Boolean);

    document.getElementById("entityAddress").textContent =
      addressParts.join(", ") || "—";

    document.getElementById("entityEmail").textContent = e.email || "—";
    document.getElementById("entityPhone").textContent = e.phone || "—";

  } catch (err) {
    console.error("Failed to load entity info:", err);
    document.getElementById("entityName").textContent = "Entity not found";
  }
}

async function loadStockTypes() {
  try {
    // Get entity_id from user's token or use first entity
    const entityId = entities.length > 0 ? entities[0].id : null;
    
    if (entityId) {
      const data = await apiCall("stockTypes", "list-types", { entity_id: entityId });
      
      if (data && Array.isArray(data.stock_types)) {
        stockTypes = data.stock_types;
      }
    }
  } catch (err) {
    console.error("Failed to load stock types:", err);
    // Fallback to defaults
    stockTypes = [];
  }
  
  populateStockTypeDropdowns();
}

function populateStockTypeDropdowns() {
  const dropdownIds = ["stockTypeFilter", "issueStockType", "transferStockType"];
  
  dropdownIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    
    el.innerHTML = id === "stockTypeFilter"
      ? `<option value="">All Stock Types</option>`
      : `<option value="">Select Stock Type</option>`;
    
    stockTypes.forEach(s => {
      el.innerHTML += `<option value="${s.stock_type}" data-supports-series="${s.supports_series}">${s.display_name || s.stock_type}</option>`;
    });
  });
}

async function loadSeriesForStockType(stockTypeId) {
  if (!stockTypeId) {
    allSeries = [];
    populateSeriesDropdown();
    return;
  }

  try {
    const data = await apiCall("stockTypes", "list-series", { entity_stock_type_id: stockTypeId });
    
    if (data && Array.isArray(data.series)) {
      allSeries = data.series.filter(s => s.is_active);
    } else {
      allSeries = [];
    }
  } catch (err) {
    console.error("Failed to load series:", err);
    allSeries = [];
  }
  
  populateSeriesDropdown();
}

function populateSeriesDropdown() {
  const seriesFilter = document.getElementById("seriesFilter");
  if (!seriesFilter) return;
  
  seriesFilter.innerHTML = `<option value="">All Series</option>`;
  allSeries.forEach(s => {
    seriesFilter.innerHTML += `<option value="${s.series}">${s.series}</option>`;
  });
}

function handleStockTypeChange() {
  const stockTypeFilter = document.getElementById("stockTypeFilter");
  const selectedValue = stockTypeFilter.value;
  
  // Find the selected stock type to get its ID and check if it supports series
  const selectedType = stockTypes.find(s => s.stock_type === selectedValue);
  
  if (selectedType && selectedType.supports_series) {
    loadSeriesForStockType(selectedType.id);
    document.getElementById("seriesFilter").disabled = false;
  } else {
    allSeries = [];
    populateSeriesDropdown();
    document.getElementById("seriesFilter").value = "";
    document.getElementById("seriesFilter").disabled = !selectedType?.supports_series;
  }
  
  applyFilters();
}

async function loadOwnership() {
  const user = getCurrentUser();
  
  // Determine entity_id based on role
  let entityId = document.getElementById("entityFilter").value;
  if (!isSuperAdmin() && user?.entity_id) {
    // Non-super admins can only see their entity's data
    entityId = user.entity_id;
  }
  
  const params = {
    search: document.getElementById("searchInput").value,
    entity_id: entityId,
    stock_type: document.getElementById("stockTypeFilter").value,
    series: document.getElementById("seriesFilter").value,
    status: document.getElementById("statusFilter").value
  };

  try {
    const data = await apiCall("ledger", "ownership", params);
    shareholders = normalizeOwnership(data.ownership || []);
  } catch (err) {
    console.error("Failed to load ownership:", err);
    shareholders = [];
  }
  
  renderHoldingsMatrix();
  updateStats();
}

function normalizeOwnership(rows) {
  const map = new Map();

  rows.forEach(r => {
    if (!map.has(r.shareholder_id)) {
      map.set(r.shareholder_id, {
        id: r.shareholder_id,
        entity_id: r.entity_id,
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

/* ================= HOLDINGS MATRIX ================= */

function renderHoldingsMatrix() {
  const body = document.getElementById("holdingsMatrixBody");
  body.innerHTML = "";

  const data = shareholders;
  const grandTotal = data.reduce((a, b) => a + b.total, 0);
  const totalCommon = data.reduce((a, b) => a + b.holdings.common, 0);
  const totalSeriesA = data.reduce((a, b) => a + b.holdings.seriesA, 0);
  const totalSeriesB = data.reduce((a, b) => a + b.holdings.seriesB, 0);

  data.forEach((sh) => {
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
  console.log('Open menu for shareholder:', shareholderId);
}

/* ================= DRAWER ================= */

function openDetailDrawerFor(sh) {
  document.getElementById("drawerName").textContent = sh.full_name;
  document.getElementById("drawerAddress").textContent = sh.address || "—";
  document.querySelector(".drawer-sub").textContent =
    `Shareholder · ${accountNumber(sh.entity_id, sh.id)}`;

  renderDrawerHoldings(sh);
  loadDrawerEntries(sh.id);

  const drawerTabs = document.querySelectorAll(".drawer-tab");
  switchDrawerTab("holdings", { currentTarget: drawerTabs[0] });
  document.getElementById("detailDrawer").classList.add("open");
}

function renderDrawerHoldings(sh) {
  const drawerHoldings = document.getElementById("drawer-holdings");
  if (!drawerHoldings) return;
  
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
  const drawerEntries = document.getElementById("drawer-entries");
  if (!drawerEntries) return;
  
  drawerEntries.innerHTML = `<div class="empty-note">Loading…</div>`;
  
  try {
    const data = await apiCall("ledger", "transactions", { shareholder_id: id });

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
  } catch (err) {
    console.error("Failed to load drawer entries:", err);
    drawerEntries.innerHTML = `<div class="empty-note">Failed to load entries</div>`;
  }
}

/* ================= UI ================= */

function switchDrawerTab(tab, e) {
  document.querySelectorAll(".drawer-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".drawer-panel").forEach(p => p.classList.remove("active"));

  document.getElementById(`drawer-${tab}`).classList.add("active");
  e.currentTarget.classList.add("active");
}

function closeDrawer() {
  document.getElementById("detailDrawer").classList.remove("open");
}

function applyFilters() {
  loadOwnership();
}

function resetFilters() {
  const user = getCurrentUser();
  
  document.getElementById("searchInput").value = "";
  document.getElementById("stockTypeFilter").value = "";
  document.getElementById("seriesFilter").value = "";
  document.getElementById("seriesFilter").disabled = true;
  document.getElementById("statusFilter").value = "";
  
  // Only reset entity filter for super admins
  if (isSuperAdmin()) {
    document.getElementById("entityFilter").value = "";
    loadEntityInfo("");
  } else if (user?.entity_id) {
    document.getElementById("entityFilter").value = user.entity_id;
    loadEntityInfo(user.entity_id);
  }
  
  allSeries = [];
  populateSeriesDropdown();
  loadOwnership();
}

function exportCSV() {
  const total = shareholders.reduce((a, s) => a + s.total, 0);
  const rows = shareholders.map(s => [
    accountNumber(s.entity_id, s.id),
    `"${s.full_name}"`,
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
  a.download = `holdings-matrix-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

/* ================= STATS ================= */

function updateStats() {
  const data = shareholders;
  const total = data.reduce((a, s) => a + s.total, 0);
  document.getElementById("totalShareholdersCount").textContent = data.length;
  document.getElementById("totalSharesCount").textContent = formatShares(total);
}

/* ================= MODALS ================= */

function openCreateShareholderModal() {
  document.getElementById("createShareholderModal").classList.add("open");
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove("open");
}

async function submitCreateShareholder(event) {
  event.preventDefault();
  
  const body = {
    full_name: document.getElementById("shareholderName").value,
    email: document.getElementById("shareholderEmail").value,
    tax_id: document.getElementById("shareholderTaxId").value,
    address: document.getElementById("shareholderAddress").value,
    entity_id: document.getElementById("shareholderEntity").value,
    shareholder_type: document.getElementById("shareholderType").value
  };

  try {
    await apiCall("ledger", "create-shareholder", {}, "POST", body);
    closeModal("createShareholderModal");
    document.getElementById("createShareholderForm").reset();
    await loadOwnership();
    showToast("Shareholder created successfully", "success");
  } catch (err) {
    console.error("Failed to create shareholder:", err);
    showToast("Failed to create shareholder", "error");
  }
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => toast.remove(), 3000);
}

/* ================= AUTH ================= */

function logout() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('user');
  window.location.href = 'login.html';
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}