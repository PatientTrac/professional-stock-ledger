/**
 * AegisIQ Stock Ledger – Unified Frontend Controller
 * Database-driven grid with dynamic columns from entity_stock_types + entity_stock_series
 * Two-pane detail drawer with Holdings & Book Entries tabs
 * Role-based access control
 */

const isLocalDev =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const API_BASE_URL = isLocalDev
  ? "http://localhost:8888/api"
  : "/.netlify/functions";

/* ================= GLOBAL STATE ================= */
const state = {
  user: null,
  token: null,
  entities: [],
  stockTypes: [],
  stockSeries: [],
  gridColumns: [],
  visibleColumns: [],
  gridData: [],
  shareholderBookEntries: {}, // Cache: shareholderId -> { columnId -> [bookEntries] }
  columnTotals: {},
  grandTotal: 0,
  expandedRows: new Set(),
  activeDetailTab: {}, // shareholderId -> 'holdings' | 'book-entries'
  expandedStockTypes: {}, // shareholderId -> Set of stock type ids
  sortOrder: 'asc', // 'asc' or 'desc'
  sortField: 'full_name',
  transferHoldings: [], // Holdings for transfer modal
  cancelHoldings: [],   // Holdings for cancel modal
  filters: {
    entityId: null,
    stockTypeId: null,
    seriesId: null,
    status: '',
    search: '',
    transactionType: ''
  }
};

/* ================= AUTH HELPERS ================= */
function getAuthToken() {
  return localStorage.getItem('auth_token');
}

function getCurrentUser() {
  const userStr = localStorage.getItem('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

function isSuperAdmin() {
  const user = getCurrentUser();
  return user?.role === 'SUPER_ADMIN';
}

function isAdmin() {
  const user = getCurrentUser();
  return user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
}

function logout() {
  // Use Session manager for proper cleanup
  if (typeof Session !== 'undefined') {
    Session.logout();
  } else {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    sessionStorage.clear();
    window.location.href = 'login.html';
  }
}

/* ================= API HELPER ================= */
async function apiCall(path, options = {}) {
  const token = getAuthToken();
  
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });

  if (res.status === 401) {
    logout();
    return null;
  }

  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || 'API Error');
  }
  return data;
}

/* ================= INITIALIZATION ================= */
document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  const token = getAuthToken();
  const user = getCurrentUser();
  
  if (!token || !user) {
    window.location.href = 'login.html';
    return;
  }

  // Initialize session timeout management
  if (typeof Session !== 'undefined') {
    Session.init();
  }

  state.token = token;
  state.user = user;
  state.filters.entityId = user.entity_id;

  updateUserDisplay();
  setupRoleBasedUI();
  setupUserDropdown();
  setupMobileMenu();

  try {
    await Promise.all([
      loadEntities(),
      loadStockTypes()
    ]);
    
    await loadOwnership();
  } catch (error) {
    console.error('Init error:', error);
    showToast('Failed to load application data', 'error');
  }
}

/* ================= USER DISPLAY ================= */
function updateUserDisplay() {
  const user = state.user;
  if (!user) return;

  const avatar = document.getElementById('userAvatar');
  if (avatar) {
    const initials = (user.full_name || user.email || 'U')
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
    avatar.textContent = initials;
  }

  const userName = document.getElementById('userName');
  if (userName) userName.textContent = user.full_name || user.email;

  const userEmail = document.getElementById('userEmail');
  if (userEmail) userEmail.textContent = user.email;
  
  const userRole = document.getElementById('userRole');
  if (userRole) userRole.textContent = user.role;
}

function setupRoleBasedUI() {
  const entityFilter = document.getElementById('entityFilter');
  
  if (!isSuperAdmin() && entityFilter) {
    entityFilter.style.display = 'none';
  }

  const adminButton = document.getElementById('adminButton');
  if (adminButton) {
    adminButton.classList.toggle('hidden', !isAdmin());
  }

  // Show admin toolbar for admin users
  const adminToolbar = document.getElementById('adminToolbar');
  if (adminToolbar) {
    adminToolbar.classList.toggle('hidden', !isAdmin());
  }
}

/* ================= USER DROPDOWN ================= */
function setupUserDropdown() {
  const userDropdown = document.getElementById('userDropdown');
  const userTrigger = document.getElementById('userTrigger');
  
  if (userTrigger && userDropdown) {
    userTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('open');
    });
    
    document.addEventListener('click', (e) => {
      if (!userDropdown.contains(e.target)) {
        userDropdown.classList.remove('open');
      }
    });
  }
}

/* ================= MOBILE MENU ================= */
function setupMobileMenu() {
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const mobileMenu = document.getElementById('mobileMenu');
  
  if (mobileMenuToggle && mobileMenu) {
    mobileMenuToggle.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
    });
  }
}

/* ================= ENTITIES ================= */
async function loadEntities() {
  try {
    const data = await apiCall('/entities?action=list');
    state.entities = data.entities || [];
    
    if (isSuperAdmin()) {
      const entityFilter = document.getElementById('entityFilter');
      if (entityFilter) {
        entityFilter.innerHTML = '<option value="">All Entities</option>';
        state.entities.forEach(entity => {
          const opt = document.createElement('option');
          opt.value = entity.id;
          opt.textContent = entity.name;
          if (entity.id === state.filters.entityId) opt.selected = true;
          entityFilter.appendChild(opt);
        });
      }
    }
    
    await loadEntityInfo();
  } catch (error) {
    console.error('Error loading entities:', error);
  }
}

async function loadEntityInfo() {
  const entityId = state.filters.entityId || state.user.entity_id;
  
  try {
    const data = await apiCall(`/entities?action=get&entityId=${entityId}`);
    const entity = data.entity;
    
    if (entity) {
      const entityName = document.getElementById('entityName');
      if (entityName) entityName.textContent = entity.name || entity.legal_name;
      
      const entityIdEl = document.getElementById('entityId');
      if (entityIdEl) entityIdEl.textContent = entity.id;
      
      const entityAddress = document.getElementById('entityAddress');
      if (entityAddress) {
        const addressParts = [entity.address, entity.city, entity.state, entity.zip_code, entity.country].filter(Boolean);
        entityAddress.textContent = addressParts.join(', ') || 'N/A';
      }
      
      const entityEmail = document.getElementById('entityEmail');
      if (entityEmail) entityEmail.textContent = entity.email || 'N/A';
      
      const entityPhone = document.getElementById('entityPhone');
      if (entityPhone) entityPhone.textContent = entity.phone || 'N/A';
    }
  } catch (error) {
    console.error('Error loading entity info:', error);
  }
}

async function handleEntityChange() {
  const entityFilter = document.getElementById('entityFilter');
  if (entityFilter && isSuperAdmin()) {
    const newEntityId = entityFilter.value || state.user.entity_id;
    if (newEntityId !== state.filters.entityId) {
      state.filters.entityId = newEntityId;
      await loadStockTypes();
      await loadEntityInfo();
      await loadOwnership();
    }
  }
}

/* ================= STOCK TYPES & SERIES ================= */
async function loadStockTypes() {
  const entityId = state.filters.entityId || state.user.entity_id;
  
  try {
    const data = await apiCall(`/stockTypes?action=list-types&entity_id=${entityId}`);
    state.stockTypes = (data.stock_types || []).filter(t => t.is_active);
    
    const stockTypeFilter = document.getElementById('stockTypeFilter');
    if (stockTypeFilter) {
      stockTypeFilter.innerHTML = '<option value="">All Stock Types</option>';
      state.stockTypes.forEach(st => {
        const opt = document.createElement('option');
        opt.value = st.id;
        opt.textContent = st.display_name;
        opt.dataset.supportsSeries = st.supports_series;
        stockTypeFilter.appendChild(opt);
      });
    }
    
    const seriesFilter = document.getElementById('seriesFilter');
    if (seriesFilter) {
      seriesFilter.innerHTML = '<option value="">All Series</option>';
      seriesFilter.disabled = true;
    }
  } catch (error) {
    console.error('Error loading stock types:', error);
  }
}

async function handleStockTypeChange() {
  const stockTypeFilter = document.getElementById('stockTypeFilter');
  const seriesFilter = document.getElementById('seriesFilter');
  
  const selectedId = stockTypeFilter.value;
  state.filters.stockTypeId = selectedId || null;
  
  const selectedOption = stockTypeFilter.options[stockTypeFilter.selectedIndex];
  const supportsSeries = selectedOption?.dataset.supportsSeries === 'true';
  
  if (!selectedId || !supportsSeries) {
    seriesFilter.innerHTML = '<option value="">All Series</option>';
    seriesFilter.disabled = true;
    state.filters.seriesId = null;
    await loadOwnership();
    return;
  }
  
  try {
    const data = await apiCall(`/stockTypes?action=list-series&entity_stock_type_id=${selectedId}`);
    state.stockSeries = (data.series || []).filter(s => s.is_active);
    
    seriesFilter.innerHTML = '<option value="">All Series</option>';
    state.stockSeries.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.series;
      seriesFilter.appendChild(opt);
    });
    seriesFilter.disabled = false;
  } catch (error) {
    console.error('Error loading series:', error);
    seriesFilter.innerHTML = '<option value="">All Series</option>';
    seriesFilter.disabled = true;
  }
  
  await loadOwnership();
}

/* ================= OWNERSHIP GRID ================= */
async function loadOwnership() {
  const entityId = isSuperAdmin() && state.filters.entityId 
    ? state.filters.entityId 
    : state.user.entity_id;
  
  let url = `/reports?action=ownership-report&entity_id=${entityId}`;
  
  if (state.filters.stockTypeId) {
    url += `&entity_stock_type_id=${state.filters.stockTypeId}`;
  }
  if (state.filters.seriesId) {
    url += `&entity_stock_series_id=${state.filters.seriesId}`;
  }
  if (state.filters.status) {
    url += `&status=${state.filters.status}`;
  }
  
  // Show loading state
  showGridLoader();
  
  try {
    const data = await apiCall(url);
    const report = data.report;
    
    state.gridColumns = report.columns || [];
    state.gridData = report.shareholders || [];
    state.columnTotals = report.column_totals || {};
    state.grandTotal = report.grand_total || 0;
    state.expandedRows.clear();
    state.activeDetailTab = {};
    state.expandedStockTypes = {};
    state.shareholderBookEntries = {};
    
    calculateVisibleColumns();
    
    // Pre-load book entries for all shareholders on grid load
    await preloadBookEntries();
    
    const totalShareholdersCount = document.getElementById('totalShareholdersCount');
    if (totalShareholdersCount) totalShareholdersCount.textContent = report.total_shareholders || 0;
    
    const totalSharesCount = document.getElementById('totalSharesCount');
    if (totalSharesCount) totalSharesCount.textContent = formatNumber(state.grandTotal);
    
    renderGrid();
  } catch (error) {
    console.error('Error loading ownership:', error);
    showToast('Failed to load ownership data', 'error');
  }
}

async function preloadBookEntries() {
  // Pre-load book entries from the database for all shareholders on grid load
  const entityId = isSuperAdmin() && state.filters.entityId 
    ? state.filters.entityId 
    : state.user.entity_id;
  
  // Load book entries for each shareholder in parallel
  const promises = state.gridData.map(async (sh) => {
    try {
      const data = await apiCall(`/ledger?action=list-book-entries&entity_id=${entityId}&shareholder_id=${sh.shareholder_id}`);
      state.shareholderBookEntries[sh.shareholder_id] = data.entries || [];
    } catch (error) {
      console.error(`Error loading book entries for shareholder ${sh.shareholder_id}:`, error);
      state.shareholderBookEntries[sh.shareholder_id] = [];
    }
  });
  
  await Promise.all(promises);
}

function calculateVisibleColumns() {
  state.visibleColumns = state.gridColumns.filter(col => {
    return state.gridData.some(sh => (sh.holdings[col.id] || 0) > 0);
  });
}

function renderGrid() {
  const container = document.getElementById('holdingsMatrixBody');
  if (!container) return;
  
  let filteredData = [...state.gridData];
  
  // Apply search filter
  if (state.filters.search) {
    const search = state.filters.search.toLowerCase();
    filteredData = filteredData.filter(sh => 
      (sh.full_name || '').toLowerCase().includes(search) ||
      (sh.external_id || '').toLowerCase().includes(search) ||
      String(sh.shareholder_id).includes(search)
    );
  }
  
  // Apply sorting
  filteredData.sort((a, b) => {
    const aVal = (a[state.sortField] || '').toLowerCase();
    const bVal = (b[state.sortField] || '').toLowerCase();
    const cmp = aVal.localeCompare(bVal);
    return state.sortOrder === 'asc' ? cmp : -cmp;
  });
  
  renderGridHeader();
  
  if (filteredData.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
        <span>No shareholders found</span>
      </div>
    `;
    renderGridFooter();
    return;
  }
  
  let html = '';
  filteredData.forEach((sh, idx) => {
    const isExpanded = state.expandedRows.has(sh.shareholder_id);
    html += renderShareholderRow(sh, idx, isExpanded);
    if (isExpanded) {
      html += renderDetailPanel(sh);
    }
  });
  
  container.innerHTML = html;
  renderGridFooter();
}

function renderGridHeader() {
  const header = document.getElementById('matrixHeader');
  if (!header) return;
  
  let html = `
    <div class="grid-cell cell-expand"></div>
    <div class="grid-cell cell-account">Account #</div>
    <div class="grid-cell cell-name">Shareholder Name</div>
    <div class="grid-cell cell-address">Address</div>
  `;
  
  state.visibleColumns.forEach(col => {
    html += `<div class="grid-cell cell-shares" title="${col.stock_type}${col.series ? ' ' + col.series : ''}">${col.header}</div>`;
  });
  
  html += `
    <div class="grid-cell cell-total">Total</div>
    <div class="grid-cell cell-pct">%</div>
    <div class="grid-cell cell-actions">Actions</div>
  `;
  
  header.innerHTML = html;
}

function renderShareholderRow(sh, idx, isExpanded) {
  const address = [sh.address, sh.city, sh.state, sh.zip_code].filter(Boolean).join(', ');
  const pct = state.grandTotal > 0 ? ((sh.total_shares / state.grandTotal) * 100).toFixed(2) : '0.00';
  const expandedClass = isExpanded ? 'expanded' : '';
  const rowClass = idx % 2 === 0 ? 'row-even' : 'row-odd';
  
  let html = `<div class="grid-row ${rowClass} ${expandedClass}" data-shareholder-id="${sh.shareholder_id}" onclick="toggleRow(${sh.shareholder_id})">`;
  
  html += `
    <div class="grid-cell cell-expand">
      <button class="expand-btn" onclick="event.stopPropagation(); toggleRow(${sh.shareholder_id})">
        <svg class="chevron-icon ${isExpanded ? 'rotated' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    </div>
  `;
  
  html += `<div class="grid-cell cell-account">${escapeHtml(sh.external_id || String(sh.shareholder_id))}</div>`;
  html += `<div class="grid-cell cell-name">${escapeHtml(sh.full_name)}</div>`;
  html += `<div class="grid-cell cell-address" title="${escapeHtml(address)}">${escapeHtml(truncate(address, 25))}</div>`;
  
  state.visibleColumns.forEach(col => {
    const shares = sh.holdings[col.id] || 0;
    html += `<div class="grid-cell cell-shares">${shares > 0 ? formatNumber(shares) : '—'}</div>`;
  });
  
  html += `<div class="grid-cell cell-total">${formatNumber(sh.total_shares)}</div>`;
  html += `<div class="grid-cell cell-pct">${pct}%</div>`;
  
  html += `<div class="grid-cell cell-actions" onclick="event.stopPropagation()">`;
  html += `<button class="btn-icon" onclick="viewShareholder(${sh.shareholder_id})" title="View Details">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  </button>`;
  if (isAdmin()) {
    html += `<button class="btn-icon" onclick="editShareholder(${sh.shareholder_id})" title="Edit">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    </button>`;
  }
  html += `</div>`;
  html += `</div>`;
  
  return html;
}

function renderDetailPanel(sh) {
  const activeTab = state.activeDetailTab[sh.shareholder_id] || 'details';
  
  // Group holdings by stock type
  const holdingsByType = {};
  
  state.gridColumns.forEach(col => {
    const shares = sh.holdings[col.id] || 0;
    if (shares > 0) {
      const typeKey = col.entity_stock_type_id;
      if (!holdingsByType[typeKey]) {
        holdingsByType[typeKey] = {
          id: typeKey,
          stock_type: col.stock_type,
          display_name: col.display_name,
          supports_series: col.supports_series,
          series: [],
          total: 0
        };
      }
      holdingsByType[typeKey].series.push({
        id: col.id,
        series: col.series,
        shares: shares
      });
      holdingsByType[typeKey].total += shares;
    }
  });
  
  // Get book entries (preloaded from DB on grid init)
  const allBookEntries = getBookEntriesForShareholder(sh.shareholder_id);
  
  // Build shareholder details
  const fullAddress = [sh.address, sh.city, sh.state, sh.zip_code, sh.country].filter(Boolean).join(', ') || 'N/A';
  const shareholderType = sh.shareholder_type || 'INDIVIDUAL';
  const initials = (sh.full_name || 'U')
    .split(' ')
    .map(n => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
  
  let html = `<div class="detail-panel" data-detail-for="${sh.shareholder_id}">`;
  html += `<div class="detail-content">`;
  
  // Tab Navigation - Shareholder Details first, then Book Entries
  html += `
    <div class="detail-tabs">
      <button class="detail-tab ${activeTab === 'details' ? 'active' : ''}" onclick="switchDetailTab(${sh.shareholder_id}, 'details')">Shareholder Details</button>
      <button class="detail-tab ${activeTab === 'book-entries' ? 'active' : ''}" onclick="switchDetailTab(${sh.shareholder_id}, 'book-entries')">Book Entries</button>
    </div>
  `;
  
  // Shareholder Details Tab Content
  html += `<div class="tab-content ${activeTab === 'details' ? 'active' : ''}" id="tab-details-${sh.shareholder_id}">`;
  html += `
    <div class="shareholder-details-card">
      <div class="shareholder-avatar-section">
        <div class="shareholder-avatar-large">${initials}</div>
        <span class="shareholder-type-badge ${shareholderType.toLowerCase()}">${shareholderType}</span>
      </div>
      <div class="shareholder-info-section">
        <div class="shareholder-info-row">
          <div class="shareholder-info-item">
            <span class="info-label">Shareholder ID</span>
            <span class="info-value mono">${escapeHtml(sh.external_id || String(sh.shareholder_id))}</span>
          </div>
          <div class="shareholder-info-item">
            <span class="info-label">Full Name</span>
            <span class="info-value">${escapeHtml(sh.full_name)}</span>
          </div>
        </div>
        <div class="shareholder-info-row">
          <div class="shareholder-info-item full-width">
            <span class="info-label">Full Address</span>
            <span class="info-value">${escapeHtml(fullAddress)}</span>
          </div>
        </div>
        <div class="shareholder-info-row">
          <div class="shareholder-info-item">
            <span class="info-label">Email</span>
            <span class="info-value">${escapeHtml(sh.email || 'N/A')}</span>
          </div>
          <div class="shareholder-info-item">
            <span class="info-label">Phone</span>
            <span class="info-value">${escapeHtml(sh.phone || 'N/A')}</span>
          </div>
        </div>
        <div class="shareholder-info-row">
          <div class="shareholder-info-item">
            <span class="info-label">Tax ID</span>
            <span class="info-value mono">${escapeHtml(sh.tax_id || 'N/A')}</span>
          </div>
          <div class="shareholder-info-item">
            <span class="info-label">Total Shares</span>
            <span class="info-value gold">${formatNumber(sh.total_shares)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Holdings Summary within Details
  html += `<div class="holdings-breakdown">`;
  html += `<h4 class="holdings-breakdown-title">Holdings Breakdown</h4>`;
  Object.values(holdingsByType).forEach(holding => {
    const pct = sh.total_shares > 0 ? ((holding.total / sh.total_shares) * 100).toFixed(1) : '0.0';
    html += `
      <div class="holding-item">
        <span class="holding-name">${escapeHtml(holding.display_name)}</span>
        <span class="holding-shares">${formatNumber(holding.total)} <span class="shares-pct">(${pct}%)</span></span>
      </div>
    `;
  });
  html += `</div>`;
  html += `</div>`; // End details tab
  
  html += `<div class="tab-content ${activeTab === 'book-entries' ? 'active' : ''}" id="tab-book-entries-${sh.shareholder_id}">`;
  
  if (allBookEntries.length === 0) {
    html += `<div class="empty-book-entries">No book entries found for this shareholder.</div>`;
  } else {
    html += `
      <table class="book-entries-full-table">
        <thead>
          <tr>
            <th>Transaction ID</th>
            <th>Type</th>
            <th>Stock Type</th>
            <th>Series</th>
            <th>Shares</th>
            <th>Certificate #</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    allBookEntries.forEach(entry => {
      const transactionType = entry.transaction_type || 'ISSUANCE';
      const typeClass = transactionType.toLowerCase();
      html += `
        <tr>
          <td class="mono">${entry.id}</td>
          <td><span class="type-badge ${typeClass}">${transactionType}</span></td>
          <td>${escapeHtml(entry.stock_type_name || '')}</td>
          <td>${escapeHtml(entry.series || '-')}</td>
          <td>${formatNumber(entry.shares)}</td>
          <td class="mono">${escapeHtml(entry.certificate_number || '-')}</td>
          <td>${formatDate(entry.transaction_date)}</td>
        </tr>
      `;
    });
    
    html += `
        </tbody>
      </table>
    `;
  }
  html += `</div>`; // End book-entries tab
  
  html += `</div>`; // detail-content
  html += `</div>`; // detail-panel
  
  return html;
}

function getBookEntriesForShareholder(shareholderId) {
  // Return cached book entries from preloaded API data
  return state.shareholderBookEntries[shareholderId] || [];
}

function renderGridFooter() {
  const footer = document.getElementById('matrixFooter');
  if (!footer) return;
  
  let html = `
    <div class="grid-cell cell-expand"></div>
    <div class="grid-cell cell-account"></div>
    <div class="grid-cell cell-name"><strong>TOTALS</strong></div>
    <div class="grid-cell cell-address"></div>
  `;
  
  state.visibleColumns.forEach(col => {
    const total = state.columnTotals[col.id] || 0;
    html += `<div class="grid-cell cell-shares"><strong>${formatNumber(total)}</strong></div>`;
  });
  
  html += `
    <div class="grid-cell cell-total"><strong>${formatNumber(state.grandTotal)}</strong></div>
    <div class="grid-cell cell-pct"><strong>100%</strong></div>
    <div class="grid-cell cell-actions"></div>
  `;
  
  footer.innerHTML = html;
}

function toggleRow(shareholderId) {
  if (state.expandedRows.has(shareholderId)) {
    state.expandedRows.delete(shareholderId);
  } else {
    state.expandedRows.add(shareholderId);
    // Initialize tab to 'details' if not set
    if (!state.activeDetailTab[shareholderId]) {
      state.activeDetailTab[shareholderId] = 'details';
    }
  }
  renderGrid();
}

/* ================= GRID LOADER ================= */
function showGridLoader() {
  const container = document.getElementById('holdingsMatrixBody');
  if (container) {
    container.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <span>Loading ownership data...</span>
      </div>
    `;
  }
}

function hideGridLoader() {
  // Grid loader is hidden automatically when renderGrid() is called
}

function switchDetailTab(shareholderId, tabName) {
  state.activeDetailTab[shareholderId] = tabName;
  
  // Update tab UI without full re-render
  const panel = document.querySelector(`[data-detail-for="${shareholderId}"]`);
  if (panel) {
    panel.querySelectorAll('.detail-tab').forEach(tab => {
      tab.classList.toggle('active', tab.textContent.toLowerCase().replace(' ', '-') === tabName);
    });
    panel.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id.includes(tabName));
    });
  }
}

function toggleStockType(shareholderId, stockTypeId) {
  if (!state.expandedStockTypes[shareholderId]) {
    state.expandedStockTypes[shareholderId] = new Set();
  }
  
  const set = state.expandedStockTypes[shareholderId];
  if (set.has(stockTypeId)) {
    set.delete(stockTypeId);
  } else {
    set.add(stockTypeId);
  }
  
  // Update UI without full re-render
  const entriesSection = document.getElementById(`entries-${shareholderId}-${stockTypeId}`);
  const toggleIcon = entriesSection?.previousElementSibling?.querySelector('.stock-type-toggle');
  
  if (entriesSection) {
    entriesSection.classList.toggle('open');
  }
  if (toggleIcon) {
    toggleIcon.classList.toggle('open');
  }
}

/* ================= FILTERS ================= */
async function applyFilters() {
  const stockTypeFilter = document.getElementById('stockTypeFilter');
  const seriesFilter = document.getElementById('seriesFilter');
  const statusFilter = document.getElementById('statusFilter');
  const searchInput = document.getElementById('searchInput');
  const transactionTypeFilter = document.getElementById('transactionTypeFilter');
  
  state.filters.stockTypeId = stockTypeFilter?.value || null;
  state.filters.seriesId = seriesFilter?.value || null;
  state.filters.status = statusFilter?.value || '';
  state.filters.search = searchInput?.value || '';
  state.filters.transactionType = transactionTypeFilter?.value || '';
  
  await loadOwnership();
}

function resetFilters() {
  const entityFilter = document.getElementById('entityFilter');
  const stockTypeFilter = document.getElementById('stockTypeFilter');
  const seriesFilter = document.getElementById('seriesFilter');
  const statusFilter = document.getElementById('statusFilter');
  const searchInput = document.getElementById('searchInput');
  const transactionTypeFilter = document.getElementById('transactionTypeFilter');
  
  state.filters.entityId = state.user.entity_id;
  state.filters.stockTypeId = null;
  state.filters.seriesId = null;
  state.filters.status = '';
  state.filters.search = '';
  state.filters.transactionType = '';
  state.sortOrder = 'asc';
  state.sortField = 'full_name';
  
  if (entityFilter) entityFilter.value = isSuperAdmin() ? '' : state.user.entity_id;
  if (stockTypeFilter) stockTypeFilter.value = '';
  if (seriesFilter) {
    seriesFilter.value = '';
    seriesFilter.disabled = true;
  }
  if (statusFilter) statusFilter.value = '';
  if (searchInput) searchInput.value = '';
  if (transactionTypeFilter) transactionTypeFilter.value = '';
  
  updateSortButton();
  loadOwnership();
}

function toggleSortOrder() {
  state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
  updateSortButton();
  renderGrid();
}

function updateSortButton() {
  const sortBtn = document.getElementById('sortBtn');
  if (sortBtn) {
    const isDesc = state.sortOrder === 'desc';
    sortBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="${isDesc ? '19' : '5'}" x2="12" y2="${isDesc ? '5' : '19'}"></line>
        <polyline points="${isDesc ? '5 12 12 5 19 12' : '19 12 12 19 5 12'}"></polyline>
      </svg>
      Sort ${isDesc ? 'Z-A' : 'A-Z'}
    `;
  }
}

/* ================= EXPORT ================= */
function exportCSV() {
  // Export book entries as individual rows
  const allBookEntries = [];
  
  // Collect all book entries from state
  Object.keys(state.shareholderBookEntries).forEach(shareholderId => {
    const entries = state.shareholderBookEntries[shareholderId];
    entries.forEach(entry => {
      allBookEntries.push(entry);
    });
  });
  
  if (allBookEntries.length === 0) {
    showToast('No book entries to export', 'warning');
    return;
  }
  
  // Build CSV headers
  const headers = [
    'Book Entry ID',
    'Shareholder ID',
    'Shareholder Name',
    'Stock Type',
    'Shares',
    'Date',
    'Status'
  ];
  
  // Build CSV rows
  const rows = allBookEntries.map(entry => [
    entry.id,
    entry.shareholder_id,
    `"${(entry.shareholder_name || '').replace(/"/g, '""')}"`,
    `"${(entry.stock_type_name || '').replace(/"/g, '""')}"`,
    entry.shares,
    entry.date,
    entry.status
  ]);
  
  // Combine headers and rows
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
  
  // Create and download blob
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `book_entries_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(downloadUrl);
  
  showToast('Book entries exported successfully', 'success');
}

/* ================= SHAREHOLDER ACTIONS ================= */
function viewShareholder(id) {
  console.log('View shareholder:', id);
  showToast('Shareholder statement coming soon', 'warning');
}

function editShareholder(id) {
  console.log('Edit shareholder:', id);
  const sh = state.gridData.find(s => s.shareholder_id === id);
  if (sh) {
    openShareholderModal(sh);
  }
}

function openCreateShareholderModal() {
  openShareholderModal(null);
}

function openShareholderModal(shareholder = null) {
  const modal = document.getElementById('shareholderModal');
  const title = document.getElementById('modalTitle');
  const form = document.getElementById('shareholderForm');
  
  if (!modal || !form) return;
  
  // Reset form
  form.reset();
  document.getElementById('formShareholderId').value = shareholder?.shareholder_id || '';
  
  if (shareholder) {
    title.textContent = 'Edit Shareholder';
    document.getElementById('formFullName').value = shareholder.full_name || '';
    document.getElementById('formExternalId').value = shareholder.external_id || '';
    document.getElementById('formEmail').value = shareholder.email || '';
    document.getElementById('formPhone').value = shareholder.phone || '';
    document.getElementById('formAddress').value = shareholder.address || '';
    document.getElementById('formCity').value = shareholder.city || '';
    document.getElementById('formState').value = shareholder.state || '';
    document.getElementById('formZipCode').value = shareholder.zip_code || '';
    document.getElementById('formShareholderType').value = shareholder.shareholder_type || 'INDIVIDUAL';
    document.getElementById('formTaxId').value = shareholder.tax_id || '';
  } else {
    title.textContent = 'Add Shareholder';
  }
  
  modal.classList.remove('hidden');
}

function closeShareholderModal() {
  const modal = document.getElementById('shareholderModal');
  if (modal) modal.classList.add('hidden');
}

async function handleShareholderSubmit(event) {
  event.preventDefault();
  
  const shareholderId = document.getElementById('formShareholderId').value;
  const isEdit = !!shareholderId;
  
  const payload = {
    full_name: document.getElementById('formFullName').value,
    external_id: document.getElementById('formExternalId').value || null,
    email: document.getElementById('formEmail').value || null,
    phone: document.getElementById('formPhone').value || null,
    address: document.getElementById('formAddress').value || null,
    city: document.getElementById('formCity').value || null,
    state: document.getElementById('formState').value || null,
    zip_code: document.getElementById('formZipCode').value || null,
    shareholder_type: document.getElementById('formShareholderType').value,
    tax_id: document.getElementById('formTaxId').value || null,
    entity_id: state.filters.entityId || state.user.entity_id
  };
  
  if (isEdit) {
    payload.id = shareholderId;
  }
  
  try {
													
    await apiCall('/shareholders?action=' + (isEdit ? 'update' : 'create'), {
      method: isEdit ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    
    closeShareholderModal();
    showToast(isEdit ? 'Shareholder updated' : 'Shareholder created', 'success');
    await loadOwnership();
  } catch (error) {
    console.error('Shareholder save error:', error);
    showToast(error.message || 'Failed to save shareholder', 'error');
  }
}

/* ================= TOAST NOTIFICATIONS ================= */
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

/* ================= UTILITY FUNCTIONS ================= */
function formatNumber(n) {
  if (n === null || n === undefined) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    month: '2-digit', 
    day: '2-digit', 
    year: 'numeric' 
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Close modal on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllModals();
  }
});

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeAllModals();
  }
});

function closeAllModals() {
  closeShareholderModal();
  closeModal('issueSharesModal');
  closeModal('transferStockModal');
  closeModal('cancelStockModal');
  closeModal('reverseSplitModal');
  closeModal('capTableModal');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('hidden');
}

/* ================= ISSUE SHARES ================= */
function openIssueSharesModal() {
  const form = document.getElementById('issueSharesForm');
  if (form) form.reset();
  
  populateShareholderDropdown('issueShareholder');
  populateStockTypeDropdown('issueStockType');
  
  document.getElementById('issueDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('issueSeries').innerHTML = '<option value="">N/A</option>';
  document.getElementById('issueSeries').disabled = true;
  
  openModal('issueSharesModal');
}

async function handleIssueStockTypeChange() {
  const stockTypeSelect = document.getElementById('issueStockType');
  const seriesSelect = document.getElementById('issueSeries');
  
  const selectedOption = stockTypeSelect.options[stockTypeSelect.selectedIndex];
  const supportsSeries = selectedOption?.dataset.supportsSeries === 'true';
  
  if (!supportsSeries) {
    seriesSelect.innerHTML = '<option value="">N/A</option>';
    seriesSelect.disabled = true;
    return;
  }
  
  await loadSeriesForDropdown(stockTypeSelect.value, seriesSelect);
}

async function handleIssueSharesSubmit(event) {
  event.preventDefault();
  
  const payload = {
    shareholder_id: document.getElementById('issueShareholder').value,
    entity_stock_type_id: document.getElementById('issueStockType').value,
    entity_stock_series_id: document.getElementById('issueSeries').value || null,
    shares: parseInt(document.getElementById('issueShares').value),
    transaction_date: document.getElementById('issueDate').value || null,
    certificate_number: document.getElementById('issueCertificate').value || null,
    notes: document.getElementById('issueNotes').value || null
  };
  
  try {
    await apiCall('/ledger?action=issue-shares', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    closeModal('issueSharesModal');
    showToast('Shares issued successfully', 'success');
    await loadOwnership();
  } catch (error) {
    showToast(error.message || 'Failed to issue shares', 'error');
  }
}

/* ================= TRANSFER STOCK ================= */
function openTransferStockModal() {
  const form = document.getElementById('transferStockForm');
  if (form) form.reset();
  
  populateShareholderDropdown('transferFromShareholder');
  populateShareholderDropdown('transferToShareholder');
  
  document.getElementById('transferDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('transferStockType').innerHTML = '<option value="">Select from shareholder first...</option>';
  document.getElementById('transferStockType').disabled = true;
  document.getElementById('transferSeries').innerHTML = '<option value="">N/A</option>';
  document.getElementById('transferSeries').disabled = true;
  document.getElementById('transferToType').value = 'existing';
  document.getElementById('newShareholderFields').classList.add('hidden');
  document.getElementById('existingReceiverGroup').style.display = 'block';
  
  openModal('transferStockModal');
}

// Load stock types available to the selected sender
async function handleTransferFromShareholderChange() {
  const fromId = document.getElementById('transferFromShareholder').value;
  const stockTypeSelect = document.getElementById('transferStockType');
  const seriesSelect = document.getElementById('transferSeries');
  const toSelect = document.getElementById('transferToShareholder');
  
  // Reset stock type and series
  stockTypeSelect.innerHTML = '<option value="">Loading...</option>';
  stockTypeSelect.disabled = true;
  seriesSelect.innerHTML = '<option value="">N/A</option>';
  seriesSelect.disabled = true;
  
  if (!fromId) {
    stockTypeSelect.innerHTML = '<option value="">Select from shareholder first...</option>';
    return;
  }
  
  // Disable the same shareholder in "To" dropdown
  Array.from(toSelect.options).forEach(opt => {
    opt.disabled = opt.value === fromId;
  });
  // If currently selected "to" is the same as "from", deselect it
  if (toSelect.value === fromId) {
    toSelect.value = '';
  }
  
  try {
    const entityId = state.filters.entityId || state.user.entity_id;
    const data = await apiCall(`/ledger?action=shareholder-holdings&shareholder_id=${fromId}&entity_id=${entityId}`);
    const holdings = data.holdings || [];
    
    if (holdings.length === 0) {
      stockTypeSelect.innerHTML = '<option value="">No shares available</option>';
      return;
    }
    
    // Group holdings by stock type
    const stockTypeMap = new Map();
    holdings.forEach(h => {
      if (!stockTypeMap.has(h.entity_stock_type_id)) {
        stockTypeMap.set(h.entity_stock_type_id, {
          id: h.entity_stock_type_id,
          display_name: h.display_name,
          stock_type: h.stock_type,
          supports_series: h.supports_series,
          series: []
        });
      }
      if (h.entity_stock_series_id) {
        stockTypeMap.get(h.entity_stock_type_id).series.push({
          id: h.entity_stock_series_id,
          series: h.series,
          shares: h.current_shares
        });
      } else {
        stockTypeMap.get(h.entity_stock_type_id).shares = h.current_shares;
      }
    });
    
    // Populate stock type dropdown with available shares
    stockTypeSelect.innerHTML = '<option value="">Select stock type...</option>';
    stockTypeMap.forEach(st => {
      const opt = document.createElement('option');
      opt.value = st.id;
      let label = st.display_name;
      if (!st.supports_series && st.shares) {
        label += ` (${formatNumber(st.shares)} available)`;
      }
      opt.textContent = label;
      opt.dataset.supportsSeries = st.supports_series;
      opt.dataset.holdings = JSON.stringify(st.series);
      stockTypeSelect.appendChild(opt);
    });
    stockTypeSelect.disabled = false;
    
    // Store holdings for series population
    state.transferHoldings = holdings;
  } catch (error) {
    console.error('Error loading shareholder holdings:', error);
    stockTypeSelect.innerHTML = '<option value="">Error loading holdings</option>';
  }
}

async function handleTransferStockTypeChange() {
  const stockTypeSelect = document.getElementById('transferStockType');
  const seriesSelect = document.getElementById('transferSeries');
  
  const selectedOption = stockTypeSelect.options[stockTypeSelect.selectedIndex];
  const supportsSeries = selectedOption?.dataset.supportsSeries === 'true';
  
  if (!supportsSeries) {
    seriesSelect.innerHTML = '<option value="">N/A</option>';
    seriesSelect.disabled = true;
    return;
  }
  
  // Load series from stored holdings
  const holdings = state.transferHoldings || [];
  const stockTypeId = stockTypeSelect.value;
  const seriesHoldings = holdings.filter(h => 
    String(h.entity_stock_type_id) === String(stockTypeId) && h.entity_stock_series_id
  );
  
  if (seriesHoldings.length === 0) {
    seriesSelect.innerHTML = '<option value="">No series available</option>';
    seriesSelect.disabled = true;
    return;
  }
  
  seriesSelect.innerHTML = '<option value="">Select series...</option>';
  seriesHoldings.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.entity_stock_series_id;
    opt.textContent = `${s.series} (${formatNumber(s.current_shares)} available)`;
    seriesSelect.appendChild(opt);
  });
  seriesSelect.disabled = false;
}

function handleTransferToTypeChange() {
  const toType = document.getElementById('transferToType').value;
  const existingGroup = document.getElementById('existingReceiverGroup');
  const newFields = document.getElementById('newShareholderFields');
  
  if (toType === 'existing') {
										 
										 
															   
		  
    existingGroup.style.display = 'block';
    newFields.classList.add('hidden');
  } else {
    existingGroup.style.display = 'none';
    newFields.classList.remove('hidden');
  }
}

async function handleTransferStockSubmit(event) {
  event.preventDefault();
  
  const toType = document.getElementById('transferToType').value;
  const fromId = document.getElementById('transferFromShareholder').value;
  let toShareholderId = document.getElementById('transferToShareholder').value;
  
  // Validate from/to are different
  if (toType === 'existing' && fromId === toShareholderId) {
    showToast('Cannot transfer shares to the same shareholder', 'error');
    return;
  }
  
  // If creating new shareholder, create them first
  if (toType === 'new') {
    const newShareholderName = document.getElementById('transferNewName').value;
    const newShareholderEmail = document.getElementById('transferNewEmail').value;
    
    if (!newShareholderName) {
      showToast('Receiver name is required', 'error');
      return;
    }
    
    try {
      const newSh = await apiCall('/shareholders?action=create', {
        method: 'POST',
        body: JSON.stringify({
          full_name: newShareholderName,
          email: newShareholderEmail || null,
          entity_id: state.filters.entityId || state.user.entity_id
        })
      });
      toShareholderId = newSh.shareholder.id;
    } catch (error) {
      showToast('Failed to create new shareholder: ' + error.message, 'error');
      return;
    }
  }
  
  const notes = buildTransferNotes();
  
  const payload = {
    from_shareholder_id: fromId,
    to_shareholder_id: toShareholderId,
    entity_stock_type_id: document.getElementById('transferStockType').value,
    entity_stock_series_id: document.getElementById('transferSeries').value || null,
    shares: parseInt(document.getElementById('transferShares').value),
    transaction_date: document.getElementById('transferDate').value || null,
    notes
  };
  
  try {
    await apiCall('/ledger?action=transfer-shares', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    closeModal('transferStockModal');
    showToast('Stock transferred successfully', 'success');
    await loadOwnership();
  } catch (error) {
    showToast(error.message || 'Failed to transfer stock', 'error');
  }
}

function buildTransferNotes() {
  const notes = [];
  if (document.getElementById('transferNotaryVerified').checked) notes.push('Notary Verified');
  if (document.getElementById('transferStockPower').checked) notes.push('Stock Power Verified');
  if (document.getElementById('transferLetterOfInstruction').checked) notes.push('Letter of Instruction (DV)');
  const additionalNotes = document.getElementById('transferNotes').value;
  if (additionalNotes) notes.push(additionalNotes);
  return notes.join('; ') || null;
}

/* ================= CANCEL STOCK ================= */
function openCancelStockModal() {
  const form = document.getElementById('cancelStockForm');
  if (form) form.reset();
  
  populateShareholderDropdown('cancelShareholder');
  
  document.getElementById('cancelDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('cancelStockType').innerHTML = '<option value="">Select shareholder first...</option>';
  document.getElementById('cancelStockType').disabled = true;
  document.getElementById('cancelSeries').innerHTML = '<option value="">N/A</option>';
  document.getElementById('cancelSeries').disabled = true;
  
  openModal('cancelStockModal');
}

// Load stock types available to the selected shareholder for cancellation
async function handleCancelShareholderChange() {
  const shareholderId = document.getElementById('cancelShareholder').value;
  const stockTypeSelect = document.getElementById('cancelStockType');
  const seriesSelect = document.getElementById('cancelSeries');
  
  // Reset stock type and series
  stockTypeSelect.innerHTML = '<option value="">Loading...</option>';
  stockTypeSelect.disabled = true;
  seriesSelect.innerHTML = '<option value="">N/A</option>';
  seriesSelect.disabled = true;
  
  if (!shareholderId) {
    stockTypeSelect.innerHTML = '<option value="">Select shareholder first...</option>';
    return;
  }
  
  try {
    const entityId = state.filters.entityId || state.user.entity_id;
    const data = await apiCall(`/ledger?action=shareholder-holdings&shareholder_id=${shareholderId}&entity_id=${entityId}`);
    const holdings = data.holdings || [];
    
    if (holdings.length === 0) {
      stockTypeSelect.innerHTML = '<option value="">No shares available</option>';
      return;
    }
    
    // Group holdings by stock type
    const stockTypeMap = new Map();
    holdings.forEach(h => {
      if (!stockTypeMap.has(h.entity_stock_type_id)) {
        stockTypeMap.set(h.entity_stock_type_id, {
          id: h.entity_stock_type_id,
          display_name: h.display_name,
          stock_type: h.stock_type,
          supports_series: h.supports_series,
          series: []
        });
      }
      if (h.entity_stock_series_id) {
        stockTypeMap.get(h.entity_stock_type_id).series.push({
          id: h.entity_stock_series_id,
          series: h.series,
          shares: h.current_shares
        });
      } else {
        stockTypeMap.get(h.entity_stock_type_id).shares = h.current_shares;
      }
    });
    
    // Populate stock type dropdown with available shares
    stockTypeSelect.innerHTML = '<option value="">Select stock type...</option>';
    stockTypeMap.forEach(st => {
      const opt = document.createElement('option');
      opt.value = st.id;
      let label = st.display_name;
      if (!st.supports_series && st.shares) {
        label += ` (${formatNumber(st.shares)} available)`;
      }
      opt.textContent = label;
      opt.dataset.supportsSeries = st.supports_series;
      stockTypeSelect.appendChild(opt);
    });
    stockTypeSelect.disabled = false;
    
    // Store holdings for series population
    state.cancelHoldings = holdings;
  } catch (error) {
    console.error('Error loading shareholder holdings:', error);
    stockTypeSelect.innerHTML = '<option value="">Error loading holdings</option>';
  }
}

async function handleCancelStockTypeChange() {
  const stockTypeSelect = document.getElementById('cancelStockType');
  const seriesSelect = document.getElementById('cancelSeries');
  
  const selectedOption = stockTypeSelect.options[stockTypeSelect.selectedIndex];
  const supportsSeries = selectedOption?.dataset.supportsSeries === 'true';
  
  if (!supportsSeries) {
    seriesSelect.innerHTML = '<option value="">N/A</option>';
    seriesSelect.disabled = true;
    return;
  }
  
  // Load series from stored holdings
  const holdings = state.cancelHoldings || [];
  const stockTypeId = stockTypeSelect.value;
  const seriesHoldings = holdings.filter(h => 
    String(h.entity_stock_type_id) === String(stockTypeId) && h.entity_stock_series_id
  );
  
  if (seriesHoldings.length === 0) {
    seriesSelect.innerHTML = '<option value="">No series available</option>';
    seriesSelect.disabled = true;
    return;
  }
  
  seriesSelect.innerHTML = '<option value="">Select series...</option>';
  seriesHoldings.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.entity_stock_series_id;
    opt.textContent = `${s.series} (${formatNumber(s.current_shares)} available)`;
    seriesSelect.appendChild(opt);
  });
  seriesSelect.disabled = false;
}

async function handleCancelStockSubmit(event) {
  event.preventDefault();
  
  const notes = [];
  if (document.getElementById('cancelNotaryVerified').checked) notes.push('Notary Verified');
  if (document.getElementById('cancelStockPower').checked) notes.push('Stock Power Verified');
  if (document.getElementById('cancelLetterOfInstruction').checked) notes.push('Letter of Instruction (DV)');
  const reason = document.getElementById('cancelNotes').value;
  if (reason) notes.push('Reason: ' + reason);
  
  const payload = {
    shareholder_id: document.getElementById('cancelShareholder').value,
    entity_stock_type_id: document.getElementById('cancelStockType').value,
    entity_stock_series_id: document.getElementById('cancelSeries').value || null,
    shares: parseInt(document.getElementById('cancelShares').value),
    transaction_date: document.getElementById('cancelDate').value || null,
    notes: notes.join('; ') || null
  };
  
  try {
    await apiCall('/ledger?action=cancel-shares', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    closeModal('cancelStockModal');
    showToast('Stock cancelled successfully', 'success');
    await loadOwnership();
  } catch (error) {
    showToast(error.message || 'Failed to cancel stock', 'error');
  }
}

/* ================= REVERSE SPLIT ================= */
function openReverseSplitModal() {
  const form = document.getElementById('reverseSplitForm');
  if (form) form.reset();
  
  populateStockTypeDropdown('splitStockType');
  
  document.getElementById('splitEffectiveDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('splitSeries').innerHTML = '<option value="">All Series</option>';
  document.getElementById('splitSeries').disabled = true;
  document.getElementById('splitOldShares').value = 10;
  document.getElementById('splitNewShares').value = 1;
  
  openModal('reverseSplitModal');
}

async function handleSplitStockTypeChange() {
  const stockTypeSelect = document.getElementById('splitStockType');
  const seriesSelect = document.getElementById('splitSeries');
  
  const selectedOption = stockTypeSelect.options[stockTypeSelect.selectedIndex];
  const supportsSeries = selectedOption?.dataset.supportsSeries === 'true';
  
  if (!supportsSeries) {
    seriesSelect.innerHTML = '<option value="">N/A</option>';
    seriesSelect.disabled = true;
    return;
  }
  
  await loadSeriesForDropdown(stockTypeSelect.value, seriesSelect);
}

async function handleReverseSplitSubmit(event) {
  event.preventDefault();
  
  const oldShares = parseInt(document.getElementById('splitOldShares').value);
  const newShares = parseInt(document.getElementById('splitNewShares').value);
  
  if (oldShares <= newShares) {
    showToast('For a reverse split, old shares must be greater than new shares', 'warning');
    return;
  }
  
  // Note: Reverse split would need a dedicated API endpoint
  const payload = {
    entity_stock_type_id: document.getElementById('splitStockType').value,
    entity_stock_series_id: document.getElementById('splitSeries').value || null,
    old_shares: oldShares,
    new_shares: newShares,
    effective_date: document.getElementById('splitEffectiveDate').value,
    board_resolution_verified: document.getElementById('splitBoardResolution').checked,
    sos_amendment_verified: document.getElementById('splitAmendmentSOS').checked,
    notes: document.getElementById('splitNotes').value || null
  };
  
  showToast('Reverse split functionality requires backend implementation', 'warning');
  console.log('Reverse split payload:', payload);
  closeModal('reverseSplitModal');
}

/* ================= PRINT ================= */
function printLedger() {
  window.print();
}

/* ================= CAP TABLE ================= */
function openCapTableModal() {
  const form = document.getElementById('capTableForm');
  if (form) form.reset();
  
  document.getElementById('capTableAsOfDate').value = new Date().toISOString().split('T')[0];
  
  openModal('capTableModal');
}

async function handleCapTableSubmit(event) {
  event.preventDefault();
  
  const format = document.getElementById('capTableFormat').value;
  
  if (format === 'csv') {
    exportCSV();
    closeModal('capTableModal');
    return;
  }
  
  if (format === 'preview') {
    showToast('Cap table preview - see grid below', 'info');
    closeModal('capTableModal');
    return;
  }
  
  if (format === 'pdf') {
    showToast('PDF generation requires backend implementation', 'warning');
    closeModal('capTableModal');
    return;
  }
}

/* ================= DROPDOWN HELPERS ================= */
function populateShareholderDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  
  select.innerHTML = '<option value="">Select shareholder...</option>';
  state.gridData.forEach(sh => {
    const opt = document.createElement('option');
    opt.value = sh.shareholder_id;
    opt.textContent = `${sh.full_name} (${sh.external_id || sh.shareholder_id})`;
    select.appendChild(opt);
  });
}

function populateStockTypeDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  
  select.innerHTML = '<option value="">Select stock type...</option>';
  state.stockTypes.forEach(st => {
    const opt = document.createElement('option');
    opt.value = st.id;
    opt.textContent = st.display_name;
    opt.dataset.supportsSeries = st.supports_series;
    select.appendChild(opt);
  });
}

async function loadSeriesForDropdown(stockTypeId, seriesSelect) {
  seriesSelect.innerHTML = '<option value="">Loading...</option>';
  seriesSelect.disabled = true;
  
  try {
    const data = await apiCall(`/stockTypes?action=list-series&entity_stock_type_id=${stockTypeId}`);
    const series = (data.series || []).filter(s => s.is_active);
    
    seriesSelect.innerHTML = '<option value="">Select series...</option>';
    series.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.series;
      seriesSelect.appendChild(opt);
    });
    seriesSelect.disabled = false;
  } catch (error) {
    console.error('Error loading series:', error);
    seriesSelect.innerHTML = '<option value="">Error loading series</option>';
  }
}