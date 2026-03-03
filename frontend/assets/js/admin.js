/**
 * AegisIQ Stock Ledger - Admin Panel (Self-contained)
 * All config, auth, API, UI helpers + admin logic in one file.
 */

/* =====================================================
   CONFIG
===================================================== */
const CONFIG = {
  isDev: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
  get API_BASE_URL() {
    return this.isDev ? 'http://localhost:8888/api' : '/.netlify/functions';
  },
  routes: { login: '/login.html', app: '/app.html', admin: '/admin.html' },
  storage: { authToken: 'auth_token', user: 'user' },
  roles: { SUPER_ADMIN: 'SUPER_ADMIN', ENTITY_ADMIN: 'ENTITY_ADMIN', MANAGER: 'MANAGER', VIEWER: 'VIEWER' }
};

/* =====================================================
   AUTH
===================================================== */
const Auth = {
  getToken() { return localStorage.getItem(CONFIG.storage.authToken); },
  getUser() {
    try { return JSON.parse(localStorage.getItem(CONFIG.storage.user)); }
    catch { return null; }
  },
  isAuthenticated() { return !!this.getToken() && !!this.getUser(); },
  isSuperAdmin() { const u = this.getUser(); return u?.role === CONFIG.roles.SUPER_ADMIN; },
  isAdmin() { const u = this.getUser(); return u?.role === CONFIG.roles.SUPER_ADMIN || u?.role === CONFIG.roles.ENTITY_ADMIN; },
  logout() {
    localStorage.removeItem(CONFIG.storage.authToken);
    localStorage.removeItem(CONFIG.storage.user);
    window.location.href = CONFIG.routes.login;
  },
  requireAdmin() {
    if (!this.isAuthenticated()) { window.location.href = CONFIG.routes.login; return false; }
    if (!this.isAdmin()) { window.location.href = CONFIG.routes.app; return false; }
    return true;
  }
};

/* =====================================================
   API
===================================================== */
const API = {
  async request(path, options = {}) {
    const token = Auth.getToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      },
      signal: controller.signal,
      ...options
    };
    try {
      const res = await fetch(`${CONFIG.API_BASE_URL}${path}`, config);
      clearTimeout(timeoutId);
      if (res.status === 401 && !path.includes('/stripe')) { Auth.logout(); return null; }

      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text();
        console.error('Expected JSON but got:', contentType, text.substring(0, 200));
        throw new Error('API returned non-JSON response (status ' + res.status + ')');
      }

      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || 'API Error');
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timed out. Please try again.');
      }
      console.error('API Error:', error);
      throw error;
    }
  },
  async get(path) { return this.request(path, { method: 'GET' }); },
  async post(path, body) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }); },
  async put(path, body) { return this.request(path, { method: 'PUT', body: JSON.stringify(body) }); },
  async delete(path) { return this.request(path, { method: 'DELETE' }); }
};

/* =====================================================
   UI HELPERS
===================================================== */
const UI = {
  escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },
  toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) { alert(message); return; }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 300); }, 3500);
  },
  showLoader(container, msg = 'Loading...') {
    if (!container) return;
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>${msg}</span></div>`;
  },
  openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  },
  closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  },
  updateUserDisplay(user) {
    if (!user) return;
    const initials = (user.full_name || user.email || '--').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const avatarEl = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userName');
    const emailEl = document.getElementById('headerUserEmail');
    const roleEl = document.getElementById('headerUserRole');
    if (avatarEl) avatarEl.textContent = initials;
    if (nameEl) nameEl.textContent = user.full_name || user.email;
    if (emailEl) emailEl.textContent = user.email;
    if (roleEl) roleEl.textContent = user.role;
  },
  setupUserDropdown() {
  const dropdown = document.getElementById('userDropdown');
  const trigger = document.getElementById('userTrigger');
												   

  if (!trigger || !dropdown) return;
  // Toggle on trigger click
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  // Close only when clicking outside
  document.addEventListener('click', () => {
    if (dropdown.classList.contains('open')) {
      dropdown.classList.remove('open');
    }
  });
},
  setupMobileMenu() {
    // Sidebar mobile toggle
    const mobileToggle = document.getElementById('sidebarMobileToggle');
    const sidebar = document.getElementById('adminSidebar');
    if (mobileToggle && sidebar) {
      mobileToggle.addEventListener('click', () => sidebar.classList.toggle('mobile-open'));
    }
    // Sidebar collapse toggle (desktop)
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    if (collapseBtn && sidebar) {
      collapseBtn.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    }
  },
  scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
};

/* =====================================================
   ADMIN APP
===================================================== */
const AdminApp = {
  state: {
    user: null,
    entities: [],
    users: [],
    shareholders: [],
    stockTypes: [],
    selectedEntityId: null,
    currentTab: 'shareholders',
    expandedStockTypes: new Set(),
    isSubmitting: false
  },

  /* ---- INIT ---- */
  async init() {
    if (!Auth.requireAdmin()) return;
    this.state.user = Auth.getUser();
    if (!this.state.user) { Auth.logout(); return; }
    this.state.selectedEntityId = this.state.user.entity_id;

    UI.updateUserDisplay(this.state.user);
    UI.setupUserDropdown();
    UI.setupMobileMenu();
    this.setupRoleBasedUI();

    try { await this.loadEntities(); } catch (e) { console.error('Failed to load entities:', e); UI.toast('Failed to load entities', 'error'); }
    try { await this.loadInitialData(); } catch (e) { console.error('Failed to load initial data:', e); UI.toast('Failed to load initial data', 'error'); }
  },

  setupRoleBasedUI() {
    const entitiesTab = document.getElementById('entitiesTab');
    if (entitiesTab && Auth.isSuperAdmin()) entitiesTab.style.display = 'flex';
    const superAdminOption = document.getElementById('superAdminOption');
    if (superAdminOption && Auth.isSuperAdmin()) superAdminOption.style.display = 'block';
    // Hide entity filter bar for non-super-admin users
    const entityFilterBar = document.getElementById('adminEntityFilterBar');
    if (entityFilterBar && !Auth.isSuperAdmin()) entityFilterBar.style.display = 'none';
  },

  /* ---- TABS ---- */
  switchTab(tabName) {
    this.state.currentTab = tabName;
    // Update sidebar active state
    document.querySelectorAll('.sidebar-item[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tabName}`));

    // Update topbar title
    const titleMap = { 'shareholders': 'Shareholders', 'stock-types': 'Stock Types', 'users': 'Users', 'entities': 'Entity Settings', 'certificates': 'Certificates', 'plan-billing': 'Plan & Billing' };
    const titleEl = document.getElementById('adminPageTitle');
    if (titleEl) titleEl.textContent = titleMap[tabName] || 'Admin';

    // Close mobile sidebar on navigation
    const sidebar = document.getElementById('adminSidebar');
    if (sidebar) sidebar.classList.remove('mobile-open');

    if (tabName === 'shareholders') this.loadShareholders();
    else if (tabName === 'stock-types') this.loadStockTypes();
    else if (tabName === 'users') this.loadUsers();
    else if (tabName === 'entities') this.renderEntitiesTable();
    else if (tabName === 'certificates') this.loadCertificates();
    else if (tabName === 'plan-billing') this.loadPlanBilling();
  },

  /* ---- ENTITIES DATA ---- */
  async loadEntities() {
    const data = await API.get('/entities?action=list&include_inactive=true');
    if (!data) { UI.toast('Session expired.', 'error'); return; }
    this.state.entities = data.entities || [];

    if (this.state.entities.length > 0) {
      const match = this.state.entities.find(e => String(e.id) === String(this.state.selectedEntityId));
      if (!match) this.state.selectedEntityId = this.state.entities[0].id;
    }
    this.populateEntityDropdowns();
  },

  populateEntityDropdowns() {
    const entityFilter = document.getElementById('adminEntityFilter');
    const userEntitySelect = document.getElementById('userEntityId');

    if (entityFilter) {
      entityFilter.innerHTML = '<option value="">Select Entity</option>';
      this.state.entities.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id; opt.textContent = e.name;
        if (String(e.id) === String(this.state.selectedEntityId)) opt.selected = true;
        entityFilter.appendChild(opt);
      });
    }
    if (userEntitySelect) {
      userEntitySelect.innerHTML = '<option value="">Select entity...</option>';
      this.state.entities.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id; opt.textContent = e.name;
        userEntitySelect.appendChild(opt);
      });
    }
  },

  async loadInitialData() {
    if (this.state.selectedEntityId) await this.loadShareholders();
    else this.renderEmptyShareholders();
  },

  handleEntityChange() {
    const select = document.getElementById('adminEntityFilter');
    if (!select) return;
    const val = select.value;
    if (!val) { this.state.selectedEntityId = null; this.state.shareholders = []; this.state.stockTypes = []; this.renderEmptyShareholders(); return; }
    this.state.selectedEntityId = val;
    this.state.shareholders = [];
    this.state.stockTypes = [];
    if (this.state.currentTab === 'shareholders') this.loadShareholders();
    else if (this.state.currentTab === 'stock-types') this.loadStockTypes();
    else if (this.state.currentTab === 'users') this.loadUsers();
    else if (this.state.currentTab === 'certificates') this.loadCertificates();
  },

  /* ---- SHAREHOLDERS ---- */
  async loadShareholders() {
    if (!this.state.selectedEntityId) { this.renderEmptyShareholders(); return; }
    const container = document.getElementById('shareholdersTable');
    UI.showLoader(container, 'Loading shareholders...');
    try {
      const data = await API.get(`/shareholders?action=list&entity_id=${this.state.selectedEntityId}&include_inactive=true`);
      if (!data) { container.innerHTML = '<div class="empty-state"><span>Session expired.</span></div>'; return; }
      this.state.shareholders = Array.isArray(data.shareholders) ? data.shareholders : [];
      this.renderShareholdersTable();
    } catch (error) {
      console.error('Error loading shareholders:', error);
      container.innerHTML = `<div class="empty-state"><span>Failed to load shareholders: ${UI.escapeHtml(error.message)}</span></div>`;
    }
  },

  renderEmptyShareholders() {
    const c = document.getElementById('shareholdersTable');
    c.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><span>Select an entity to view shareholders</span></div>';
  },

  renderShareholdersTable() {
    const container = document.getElementById('shareholdersTable');
    if (this.state.shareholders.length === 0) {
      container.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><span>No shareholders found. Add your first shareholder.</span></div>';
      return;
    }
    let html = '<table class="data-table"><thead><tr><th>Account #</th><th>Name</th><th>Email</th><th>Type</th><th>Status</th><th style="width:100px;">Actions</th></tr></thead><tbody>';
    this.state.shareholders.forEach(sh => {
      html += `<tr>
        <td class="mono">${UI.escapeHtml(sh.external_id || String(sh.id))}</td>
        <td>${UI.escapeHtml(sh.full_name)}</td>
        <td class="mono">${UI.escapeHtml(sh.email || '—')}</td>
        <td><span class="type-badge ${(sh.shareholder_type || 'individual').toLowerCase()}">${sh.shareholder_type || 'INDIVIDUAL'}</span></td>
        <td><span class="status-badge ${sh.is_active ? 'active' : 'inactive'}"><span class="dot"></span>${sh.is_active ? 'Active' : 'Inactive'}</span></td>
        <td><div class="table-actions">
          <button class="btn-table edit" onclick="AdminApp.editShareholder(${sh.id})" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <label class="toggle-switch" title="${sh.is_active ? 'Deactivate' : 'Activate'}">
            <input type="checkbox" ${sh.is_active ? 'checked' : ''} onchange="AdminApp.toggleShareholderStatus(${sh.id}, this.checked)" />
            <span class="toggle-slider"></span>
          </label>
        </div></td>
      </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  },

  openCreateShareholderModal() {
    if (!this.state.selectedEntityId) { UI.toast('Please select an entity first', 'warning'); return; }
    document.getElementById('shareholderModalTitle').textContent = 'Add Shareholder';
    document.getElementById('shareholderForm').reset();
    document.getElementById('shareholderId').value = '';
    document.getElementById('shareholderActive').checked = true;
    this.state.isSubmitting = false;
    UI.openModal('shareholderModal');
  },

  editShareholder(id) {
    const sh = this.state.shareholders.find(s => s.id === id);
    if (!sh) return;
    document.getElementById('shareholderModalTitle').textContent = 'Edit Shareholder';
    document.getElementById('shareholderId').value = sh.id;
    document.getElementById('shareholderFullName').value = sh.full_name || '';
    document.getElementById('shareholderExternalId').value = sh.external_id || '';
    document.getElementById('shareholderEmail').value = sh.email || '';
    document.getElementById('shareholderPhone').value = sh.phone || '';
    document.getElementById('shareholderAddress').value = sh.address || '';
    document.getElementById('shareholderCity').value = sh.city || '';
    document.getElementById('shareholderState').value = sh.state || '';
    document.getElementById('shareholderZipCode').value = sh.zip_code || '';
    document.getElementById('shareholderCountry').value = sh.country || 'US';
    document.getElementById('shareholderType').value = sh.shareholder_type || 'INDIVIDUAL';
    document.getElementById('shareholderTaxId').value = sh.tax_id || '';
    document.getElementById('shareholderActive').checked = sh.is_active;
    this.state.isSubmitting = false;
    UI.openModal('shareholderModal');
  },

  async handleShareholderSubmit(event) {
    event.preventDefault();
    if (this.state.isSubmitting) return;
    this.state.isSubmitting = true;
    const submitBtn = document.getElementById('shareholderSubmitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    const id = document.getElementById('shareholderId').value;
    const isEdit = !!id;
    const payload = {
      full_name: document.getElementById('shareholderFullName').value,
      external_id: document.getElementById('shareholderExternalId').value || null,
      email: document.getElementById('shareholderEmail').value || null,
      phone: document.getElementById('shareholderPhone').value || null,
      address: document.getElementById('shareholderAddress').value || null,
      city: document.getElementById('shareholderCity').value || null,
      state: document.getElementById('shareholderState').value || null,
      zip_code: document.getElementById('shareholderZipCode').value || null,
      country: document.getElementById('shareholderCountry').value || 'US',
      shareholder_type: document.getElementById('shareholderType').value,
      tax_id: document.getElementById('shareholderTaxId').value || null,
      is_active: document.getElementById('shareholderActive').checked,
      entity_id: this.state.selectedEntityId
    };
    if (isEdit) payload.id = id;

    try {
      if (isEdit) await API.put('/shareholders?action=update', payload);
      else await API.post('/shareholders?action=create', payload);
      UI.closeModal('shareholderModal');
      UI.toast(isEdit ? 'Shareholder updated' : 'Shareholder created', 'success');
      await this.loadShareholders();
    } catch (error) {
      UI.toast(error.message || 'Failed to save shareholder', 'error');
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Shareholder'; }
    }
  },

  async toggleShareholderStatus(id, isActive) {
    try {
      await API.put('/shareholders?action=update', { id, is_active: isActive });
      UI.toast(`Shareholder ${isActive ? 'activated' : 'deactivated'}`, 'success');
			 
      await this.loadShareholders();
    } catch (error) {
      UI.toast(error.message || 'Failed to update shareholder status', 'error');
      await this.loadShareholders(); // revert toggle
    }
  },

  /* ---- STOCK TYPES ---- */
  async loadStockTypes() {
    if (!this.state.selectedEntityId) { this.renderEmptyStockTypes(); return; }
    const container = document.getElementById('stockTypesTable');
    UI.showLoader(container, 'Loading stock types...');
    try {
      const data = await API.get(`/stockTypes?action=list-types&entity_id=${this.state.selectedEntityId}`);
      if (!data) return;
      this.state.stockTypes = data.stock_types || [];
      const seriesPromises = this.state.stockTypes.filter(st => st.supports_series).map(async (st) => {
        try {
          const sd = await API.get(`/stockTypes?action=list-series&entity_stock_type_id=${st.id}`);
          st.series = (sd && sd.series) || [];
        } catch { st.series = []; }
      });
      await Promise.all(seriesPromises);
      this.renderStockTypesTable();
    } catch (error) {
      console.error('Error loading stock types:', error);
      container.innerHTML = '<div class="empty-state"><span>Failed to load stock types</span></div>';
    }
  },

  renderEmptyStockTypes() {
    document.getElementById('stockTypesTable').innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg><span>Select an entity to view stock types</span></div>';
  },

  renderStockTypesTable() {
    const container = document.getElementById('stockTypesTable');
    if (this.state.stockTypes.length === 0) {
      container.innerHTML = '<div class="empty-state"><span>No stock types found. Add your first stock type.</span></div>';
      return;
    }
    const fmt = (v) => v !== null && v !== undefined ? Number(v).toLocaleString() : '—';
    const fmtDec = (v) => v !== null && v !== undefined ? parseFloat(v).toFixed(4) : '—';
    let html = '<table class="data-table"><thead><tr><th style="width:40px;"></th><th>Stock Type</th><th>Display Name</th><th>Par Value</th><th>Authorized</th><th>Voting</th><th>Series?</th><th>Status</th><th style="width:120px;">Actions</th></tr></thead><tbody>';
    this.state.stockTypes.forEach(st => {
      const numId = Number(st.id);
      const isExpanded = this.state.expandedStockTypes.has(numId);
      const hasSeries = st.supports_series && st.series && st.series.length > 0;
      const locked = st.is_governance_locked;
      html += `<tr class="stock-type-row ${isExpanded ? 'expanded' : ''}" ${st.supports_series ? `onclick="AdminApp.toggleStockTypeRow(${numId})"` : ''} style="cursor:${st.supports_series ? 'pointer' : 'default'}">
        <td>${st.supports_series ? `<svg class="expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transition:transform 0.2s;${isExpanded ? 'transform:rotate(90deg)' : ''}"><polyline points="9 18 15 12 9 6"/></svg>` : ''}</td>
        <td><span class="mono">${UI.escapeHtml(st.stock_type)}</span>${locked ? ' <span style="color:#e74c3c;font-size:11px;" title="Governance locked - shares issued">🔒</span>' : ''}</td>
        <td>${UI.escapeHtml(st.display_name)}</td>
        <td class="mono">${st.par_value !== null && st.par_value !== undefined ? '$' + fmtDec(st.par_value) : '—'}</td>
        <td class="mono">${fmt(st.authorized_shares)}</td>
        <td>${st.has_voting_rights === false ? '<span class="text-muted">No</span>' : 'Yes'}</td>
        <td>${st.supports_series ? `<span class="supports-series-badge">Yes ${hasSeries ? '(' + st.series.length + ')' : ''}</span>` : '<span class="text-muted">No</span>'}</td>
        <td><span class="status-badge ${st.is_active ? 'active' : 'inactive'}"><span class="dot"></span>${st.is_active ? 'Active' : 'Inactive'}</span></td>
        <td onclick="event.stopPropagation()"><div class="table-actions">
        <button class="btn-table edit" onclick="event.stopPropagation(); AdminApp.editStockType(${numId})" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          ${st.supports_series ? `<button class="btn-table" onclick="event.stopPropagation(); AdminApp.openAddSeriesModal(${numId})" title="Add Series"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>` : ''}
        </div></td>
      </tr>`;
      if (st.supports_series) {
        html += `<tr class="series-detail-row ${isExpanded ? 'visible' : ''}" id="series-row-${numId}" style="display:${isExpanded ? 'table-row' : 'none'}"><td colspan="9"><div class="series-detail-content"><div class="series-detail-header"><h4>Series for ${UI.escapeHtml(st.display_name)}</h4></div>`;
        if (st.series && st.series.length > 0) {
          html += '<table class="data-table series-table" style="margin:0;"><thead><tr><th>Series Name</th><th>Authorized Shares</th><th>Status</th><th style="width:60px;">Actions</th></tr></thead><tbody>';
          st.series.forEach(s => {
            html += `<tr class="${s.is_active ? '' : 'inactive-row'}">
              <td>Series ${UI.escapeHtml(s.series)}</td>
              <td class="mono">${s.authorized_shares !== null && s.authorized_shares !== undefined ? fmt(s.authorized_shares) : '—'}</td>
              <td><span class="status-badge ${s.is_active ? 'active' : 'inactive'}"><span class="dot"></span>${s.is_active ? 'Active' : 'Inactive'}</span></td>
              <td><div class="table-actions"><button class="btn-table edit" onclick="event.stopPropagation(); AdminApp.editSeries(${s.id}, ${numId})" title="Edit Series"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></div></td>
            </tr>`;
          });
          html += '</tbody></table>';
        } else {
          html += '<div class="empty-state" style="padding:20px;"><span>No series defined.</span></div>';
        }
        html += '</div></td></tr>';
      }
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  },

  toggleStockTypeRow(id) {
    // Coerce to number for consistent Set matching
    const numId = Number(id);
    if (this.state.expandedStockTypes.has(numId)) this.state.expandedStockTypes.delete(numId);
    else this.state.expandedStockTypes.add(numId);

    // Toggle visibility directly in DOM instead of full re-render
    const seriesRow = document.getElementById(`series-row-${numId}`);
    const parentRow = seriesRow ? seriesRow.previousElementSibling : null;
    if (seriesRow) {
      const isNowExpanded = this.state.expandedStockTypes.has(numId);
      seriesRow.classList.toggle('visible', isNowExpanded);
      seriesRow.style.display = isNowExpanded ? 'table-row' : 'none';
      if (parentRow) parentRow.classList.toggle('expanded', isNowExpanded);
    }
  },

  openCreateStockTypeModal() {
    if (!this.state.selectedEntityId) { UI.toast('Please select an entity first', 'warning'); return; }
    document.getElementById('stockTypeModalTitle').textContent = 'Add Stock Type';
    document.getElementById('stockTypeForm').reset();
    document.getElementById('stockTypeId').value = '';
    document.getElementById('stockTypeCode').disabled = false;
    document.getElementById('stockTypeActive').checked = true;
    this.state.isSubmitting = false;
    UI.openModal('stockTypeModal');
  },

  editStockType(id) {
    const st = this.state.stockTypes.find(s => Number(s.id) === Number(id));
    if (!st) { console.error('Stock type not found for id:', id); UI.toast('Stock type not found', 'error'); return; }
    document.getElementById('stockTypeModalTitle').textContent = 'Edit Stock Type';
    document.getElementById('stockTypeId').value = st.id;
    const codeSelect = document.getElementById('stockTypeCode');
    codeSelect.value = (st.stock_type || '').toUpperCase();
    codeSelect.disabled = true;
    document.getElementById('stockTypeDisplayName').value = st.display_name;
    document.getElementById('stockTypeParValue').value = st.par_value !== null && st.par_value !== undefined ? st.par_value : '';
    document.getElementById('stockTypeAuthorizedShares').value = st.authorized_shares !== null && st.authorized_shares !== undefined ? st.authorized_shares : '';
    document.getElementById('stockTypeDividendRate').value = st.dividend_rate !== null && st.dividend_rate !== undefined ? st.dividend_rate : '';
    document.getElementById('stockTypeLiquidationPref').value = st.liquidation_preference || '';
    document.getElementById('stockTypeVotingRights').checked = st.has_voting_rights !== false;
    document.getElementById('stockTypeActive').checked = st.is_active;

    // Governance lock handling
    const isLocked = st.is_governance_locked;
    const lockedBadge = document.getElementById('stockTypeLockedBadge');
    const lockNotice = document.getElementById('stockTypeLockNotice');
    if (isLocked) {
      lockedBadge.classList.remove('hidden');
      lockNotice.classList.remove('hidden');
    } else {
      lockedBadge.classList.add('hidden');
      lockNotice.classList.add('hidden');
    }
    // Disable governance fields if locked
    ['stockTypeParValue', 'stockTypeDividendRate', 'stockTypeLiquidationPref', 'stockTypeVotingRights'].forEach(fId => {
      const el = document.getElementById(fId);
      if (el) el.disabled = isLocked;
    });
    document.getElementById('stockTypeAuthorizedShares').disabled = false;
    if (isLocked) {
      document.getElementById('stockTypeAuthorizedShares').min = st.authorized_shares || 0;
    } else {
      document.getElementById('stockTypeAuthorizedShares').min = 0;
    }

    this.state.isSubmitting = false;
    UI.openModal('stockTypeModal');
  },

  async handleStockTypeSubmit(event) {
    event.preventDefault();
    if (this.state.isSubmitting) return;
    this.state.isSubmitting = true;
    const submitBtn = document.getElementById('stockTypeSubmitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    const id = document.getElementById('stockTypeId').value;
    const isEdit = !!id;
    const codeSelect = document.getElementById('stockTypeCode');
												   
    const wasDisabled = codeSelect.disabled;
    codeSelect.disabled = false;
    const payload = {
      entity_id: this.state.selectedEntityId,
      stock_type: codeSelect.value,
      display_name: document.getElementById('stockTypeDisplayName').value,
      par_value: document.getElementById('stockTypeParValue').value || null,
      authorized_shares: document.getElementById('stockTypeAuthorizedShares').value || null,
      dividend_rate: document.getElementById('stockTypeDividendRate').value || null,
      liquidation_preference: document.getElementById('stockTypeLiquidationPref').value || null,
      has_voting_rights: document.getElementById('stockTypeVotingRights').checked,
      is_active: document.getElementById('stockTypeActive').checked
    };
    if (isEdit) payload.id = id;

    try {
      if (isEdit) await API.put('/stockTypes?action=update-type', payload);
      else await API.post('/stockTypes?action=create-type', payload);
      UI.closeModal('stockTypeModal');
      codeSelect.disabled = false;
      UI.toast(isEdit ? 'Stock type updated' : 'Stock type created', 'success');
      await this.loadStockTypes();
    } catch (error) {
      UI.toast(error.message || 'Failed to save stock type', 'error');
      codeSelect.disabled = wasDisabled;
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Stock Type'; }
    }
  },

  /* ---- SERIES ---- */
  openAddSeriesModal(stockTypeId) {
    document.getElementById('seriesModalTitle').textContent = 'Add Series';
    document.getElementById('seriesForm').reset();
    document.getElementById('seriesId').value = '';
    document.getElementById('seriesStockTypeId').value = stockTypeId;
    document.getElementById('seriesActive').checked = true;
    this.state.isSubmitting = false;
    UI.openModal('seriesModal');
  },

  editSeries(seriesId, stockTypeId) {
    const st = this.state.stockTypes.find(s => Number(s.id) === Number(stockTypeId));
    if (!st) { console.error('Stock type not found for id:', stockTypeId); return; }
    const series = (st.series || []).find(s => Number(s.id) === Number(seriesId));
    if (!series) { console.error('Series not found for id:', seriesId); return; }
    document.getElementById('seriesModalTitle').textContent = 'Edit Series';
    document.getElementById('seriesId').value = series.id;
    document.getElementById('seriesStockTypeId').value = stockTypeId;
    document.getElementById('seriesName').value = series.series;
    document.getElementById('seriesAuthorizedShares').value = series.authorized_shares !== null && series.authorized_shares !== undefined ? series.authorized_shares : '';
    this.state.isSubmitting = false;
    UI.openModal('seriesModal');
  },

  async handleSeriesSubmit(event) {
    event.preventDefault();
    if (this.state.isSubmitting) return;
    this.state.isSubmitting = true;
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    const id = document.getElementById('seriesId').value;
    const isEdit = !!id;
    const payload = {
      entity_stock_type_id: document.getElementById('seriesStockTypeId').value,
      series: document.getElementById('seriesName').value,
      authorized_shares: document.getElementById('seriesAuthorizedShares').value || null,
      is_active: document.getElementById('seriesActive').checked
    };
    if (isEdit) payload.id = id;

    try {
      if (isEdit) await API.put('/stockTypes?action=update-series', payload);
      else await API.post('/stockTypes?action=create-series', payload);
      UI.closeModal('seriesModal');
      UI.toast(isEdit ? 'Series updated' : 'Series created', 'success');
      await this.loadStockTypes();
    } catch (error) {
      UI.toast(error.message || 'Failed to save series', 'error');
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Series'; }
    }
  },

  /* ---- USERS ---- */
  async loadUsers() {
    const container = document.getElementById('usersTable');
    UI.showLoader(container, 'Loading users...');
    try {
      let url = '/users?action=list';
      if (this.state.selectedEntityId) url += `&entity_id=${this.state.selectedEntityId}`;
      const data = await API.get(url);
      if (!data) { container.innerHTML = '<div class="empty-state"><span>Session expired.</span></div>'; return; }
      this.state.users = Array.isArray(data.users) ? data.users : [];
      this.renderUsersTable();
    } catch (error) {
      console.error('Error loading users:', error);
      container.innerHTML = `<div class="empty-state"><span>Failed to load users: ${UI.escapeHtml(error.message)}</span></div>`;
    }
  },

  renderUsersTable() {
    const container = document.getElementById('usersTable');
    if (this.state.users.length === 0) {
      container.innerHTML = '<div class="empty-state"><span>No users found.</span></div>';
      return;
    }
    const roleLabels = { 'SUPER_ADMIN': 'Super Admin', 'ENTITY_ADMIN': 'Entity Admin', 'MANAGER': 'Manager', 'VIEWER': 'Viewer', 'ADMIN': 'Admin', 'USER': 'User' };
    let html = '<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Entity</th><th>Status</th><th style="width:100px;">Actions</th></tr></thead><tbody>';
    const currentUserId = this.state.user ? this.state.user.id : null;
    this.state.users.forEach(user => {
      const entity = this.state.entities.find(e => e.id === user.entity_id);
      const isSelf = String(user.id) === String(currentUserId);
      html += `<tr>
        <td>${UI.escapeHtml(user.full_name)}${isSelf ? ' <span class="role-badge viewer" style="font-size:10px;padding:2px 6px;">You</span>' : ''}</td>
        <td class="mono">${UI.escapeHtml(user.email)}</td>
        <td><span class="role-badge ${user.role.toLowerCase()}">${roleLabels[user.role] || user.role}</span></td>
        <td>${entity ? UI.escapeHtml(entity.name) : '—'}</td>
        <td><span class="status-badge ${user.is_active ? 'active' : 'inactive'}"><span class="dot"></span>${user.is_active ? 'Active' : 'Inactive'}</span></td>
        <td><div class="table-actions">
          <button class="btn-table edit" onclick="AdminApp.editUser(${user.id})" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <label class="toggle-switch ${isSelf ? 'disabled' : ''}" title="${isSelf ? 'You cannot deactivate yourself' : (user.is_active ? 'Deactivate' : 'Activate')}">
            <input type="checkbox" ${user.is_active ? 'checked' : ''} ${isSelf ? 'disabled' : ''} onchange="AdminApp.toggleUserStatus(${user.id}, this.checked)" />
            <span class="toggle-slider"></span>
          </label>
        </div></td>
      </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  },

  openCreateUserModal() {
    document.getElementById('userModalTitle').textContent = 'Add User';
    document.getElementById('userForm').reset();
    document.getElementById('userId').value = '';
    document.getElementById('userActive').checked = true;
    document.getElementById('passwordRow').style.display = 'block';
    document.getElementById('userPassword').required = true;
	document.getElementById('userConfirmPassword').required = true;
    document.getElementById('userConfirmPassword').value = '';
    this.clearPasswordErrors();						   
    if (!Auth.isSuperAdmin()) document.getElementById('userEntityId').value = this.state.user.entity_id;
    this.state.isSubmitting = false;
    UI.openModal('userModal');
  },

  editUser(id) {
    const user = this.state.users.find(u => u.id === id);
    if (!user) return;
    document.getElementById('userModalTitle').textContent = 'Edit User';
    document.getElementById('userId').value = user.id;
    document.getElementById('userFullName').value = user.full_name;
    document.getElementById('userEmail').value = user.email;
    document.getElementById('userRole').value = user.role;
    document.getElementById('userEntityId').value = user.entity_id;
    document.getElementById('userActive').checked = user.is_active;
    document.getElementById('passwordRow').style.display = 'block';
    document.getElementById('userPassword').required = false;
    document.getElementById('userPassword').value = '';
	document.getElementById('userConfirmPassword').required = false;
    document.getElementById('userConfirmPassword').value = '';
    this.clearPasswordErrors();
    this.state.isSubmitting = false;
    UI.openModal('userModal');
  },

  async handleUserSubmit(event) {
    event.preventDefault();
    if (this.state.isSubmitting) return;
    this.state.isSubmitting = true;
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    const id = document.getElementById('userId').value;
    const isEdit = !!id;
    const payload = {
      full_name: document.getElementById('userFullName').value,
      email: document.getElementById('userEmail').value,
      role: document.getElementById('userRole').value,
      entity_id: document.getElementById('userEntityId').value,
      is_active: document.getElementById('userActive').checked
    };
    const password = document.getElementById('userPassword').value;
	const confirmPassword = document.getElementById('userConfirmPassword').value;

    if (password) {
      if (!this.validatePassword(password)) {
        this.state.isSubmitting = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save User'; }
        return;
      }
      if (password !== confirmPassword) {
        document.getElementById('confirmPasswordError').textContent = 'Passwords do not match';
        document.getElementById('confirmPasswordError').classList.remove('hidden');
        this.state.isSubmitting = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save User'; }
        return;
      }
      payload.password = password;
    } else if (!isEdit) {
      document.getElementById('passwordError').textContent = 'Password is required';
      document.getElementById('passwordError').classList.remove('hidden');
      this.state.isSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save User'; }
      return;
    }
	if (isEdit) payload.id = id;

    try {
      if (isEdit) await API.put('/users?action=update', payload);
      else await API.post('/users?action=create', payload);
      UI.closeModal('userModal');
      UI.toast(isEdit ? 'User updated' : 'User created', 'success');
      await this.loadUsers();
    } catch (error) {
      UI.toast(error.message || 'Failed to save user', 'error');
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save User'; }
    }
  },

  validatePassword(password) {
    this.clearPasswordErrors();
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
    if (!regex.test(password)) {
      const el = document.getElementById('passwordError');
      el.textContent = 'Must have 8+ chars,at least 1 uppercase, 1 lowercase, 1 number & a special character';
      el.classList.remove('hidden');
      return false;
    }
    return true;
  },

  clearPasswordErrors() {
    ['passwordError', 'confirmPasswordError'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = ''; el.classList.add('hidden'); }
    });
  },

  /* ---- ENTITIES (Super Admin) ---- */
  renderEntitiesTable() {
    const container = document.getElementById('entitiesTable');
    if (this.state.entities.length === 0) {
      container.innerHTML = '<div class="empty-state"><span>No entities found.</span></div>';
      return;
    }
    let html = '<table class="data-table"><thead><tr><th>ID</th><th>Name</th><th>Legal Name</th><th>Email</th><th>Status</th><th style="width:100px;">Actions</th></tr></thead><tbody>';
    this.state.entities.forEach(entity => {
      html += `<tr>
        <td class="mono">${entity.id}</td>
        <td>${UI.escapeHtml(entity.name)}</td>
        <td>${UI.escapeHtml(entity.legal_name || '—')}</td>
        <td class="mono">${UI.escapeHtml(entity.email || '—')}</td>
        <td><span class="status-badge ${entity.is_active ? 'active' : 'inactive'}"><span class="dot"></span>${entity.is_active ? 'Active' : 'Inactive'}</span></td>
        <td><div class="table-actions">
          <button class="btn-table edit" onclick="AdminApp.editEntity(${entity.id})" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <label class="toggle-switch" title="${entity.is_active ? 'Deactivate' : 'Activate'}">
            <input type="checkbox" ${entity.is_active ? 'checked' : ''} onchange="AdminApp.toggleEntityStatus(${entity.id}, this.checked)" />
            <span class="toggle-slider"></span>
          </label>
        </div></td>
      </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  },

  openCreateEntityModal() {
    document.getElementById('entityModalTitle').textContent = 'Add Entity';
    document.getElementById('entityForm').reset();
    document.getElementById('entityId').value = '';
    document.getElementById('entityActive').checked = true;
    document.getElementById('entityCountry').value = 'US';
    this.state.isSubmitting = false;
    UI.openModal('entityModal');
  },

  editEntity(id) {
    const entity = this.state.entities.find(e => e.id === id);
    if (!entity) return;
    document.getElementById('entityModalTitle').textContent = 'Edit Entity';
    document.getElementById('entityId').value = entity.id;
    document.getElementById('entityName').value = entity.name;
    document.getElementById('entityLegalName').value = entity.legal_name || '';
    document.getElementById('entityEmail').value = entity.email || '';
    document.getElementById('entityPhone').value = entity.phone || '';
    document.getElementById('entityAddress').value = entity.address || '';
    document.getElementById('entityCity').value = entity.city || '';
    document.getElementById('entityState').value = entity.state || '';
    document.getElementById('entityZipCode').value = entity.zip_code || '';
    document.getElementById('entityCountry').value = entity.country || 'US';
    document.getElementById('entityTaxId').value = entity.tax_id || '';
    document.getElementById('entityActive').checked = entity.is_active;
    this.state.isSubmitting = false;
    UI.openModal('entityModal');
  },

  async handleEntitySubmit(event) {
    event.preventDefault();
    if (this.state.isSubmitting) return;
    this.state.isSubmitting = true;
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    const id = document.getElementById('entityId').value;
    const isEdit = !!id;
    const payload = {
      name: document.getElementById('entityName').value,
      legal_name: document.getElementById('entityLegalName').value || null,
      email: document.getElementById('entityEmail').value || null,
      phone: document.getElementById('entityPhone').value || null,
      address: document.getElementById('entityAddress').value || null,
      city: document.getElementById('entityCity').value || null,
      state: document.getElementById('entityState').value || null,
      zip_code: document.getElementById('entityZipCode').value || null,
      country: document.getElementById('entityCountry').value || 'US',
      tax_id: document.getElementById('entityTaxId').value || null,
      is_active: document.getElementById('entityActive').checked
    };
    if (isEdit) payload.entityId = id;

    try {
      if (isEdit) await API.put('/entities?action=update', payload);
      else await API.post('/entities?action=create', payload);
      UI.closeModal('entityModal');
      UI.toast(isEdit ? 'Entity updated' : 'Entity created', 'success');
      await this.loadEntities();
      this.renderEntitiesTable();
    } catch (error) {
      UI.toast(error.message || 'Failed to save entity', 'error');
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Entity'; }
    }
  },

  /* ---- TOGGLE USER STATUS ---- */
  async toggleUserStatus(id, isActive) {
    // Prevent self-deactivation
    if (String(id) === String(this.state.user?.id)) {
      UI.toast('You cannot deactivate yourself', 'warning');
      await this.loadUsers();
      return;
    }
    try {
      await API.put('/users?action=update', { id, is_active: isActive });
      UI.toast(`User ${isActive ? 'activated' : 'deactivated'}`, 'success');
      await this.loadUsers();
    } catch (error) {
      UI.toast(error.message || 'Failed to update user status', 'error');
      await this.loadUsers();
    }
  },

  /* ---- TOGGLE ENTITY STATUS ---- */
  async toggleEntityStatus(id, isActive) {
    try {
      await API.put('/entities?action=update', { entityId: id, is_active: isActive });
      UI.toast(`Entity ${isActive ? 'activated' : 'deactivated'}`, 'success');
      await this.loadEntities();
      this.renderEntitiesTable();
    } catch (error) {
      UI.toast(error.message || 'Failed to update entity status', 'error');
      await this.loadEntities();
      this.renderEntitiesTable();
    }
  },

  /* ---- PLAN & BILLING (Seat Management) ---- */
  async loadPlanBilling() {
    const container = document.getElementById('planBillingContent');
    if (!container) return;
    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading plan details...</span></div>';

    try {
      const data = await API.get('/stripe?action=seat-usage');
      if (!data || !data.seat_usage) {
        this.renderNoPlan(container);
        return;
      }
      this.renderPlanBilling(container, data.seat_usage);
    } catch (error) {
      console.error('Plan & Billing not available yet:', error.message);
      this.renderNoPlan(container);
    }
  },

  renderNoPlan(container) {
    container.innerHTML = `
      <div class="plan-card">
        <div class="plan-card-header">
          <div class="plan-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
              <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg>
          </div>
          <div>
            <h3 class="plan-name">No Active Plan</h3>
            <p class="plan-status">Subscribe to unlock full features</p>
          </div>
        </div>
        <div class="plan-card-body">
          <p style="color:var(--text-muted);margin-bottom:1.5rem;">Choose a plan to manage your equity ledger with compliance-grade tools.</p>
          <a href="/pricing.html" class="btn btn-gold">View Plans & Subscribe</a>
        </div>
      </div>
    `;
  },

  renderPlanBilling(container, usage) {
    const seatPercent = usage.seat_limit > 0 ? Math.min(100, Math.round((usage.seats_used / usage.seat_limit) * 100)) : 0;
    const isNearLimit = seatPercent >= 80;
    const isAtLimit = usage.seats_used >= usage.seat_limit;
    const extraSeatCost = usage.plan === 'business' ? '$15' : '$20';

    container.innerHTML = `
      <div class="plan-billing-grid">
        <!-- Plan Card -->
        <div class="plan-card">
          <div class="plan-card-header">
            <div class="plan-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <h3 class="plan-name">${UI.escapeHtml(usage.plan_label)} Plan</h3>
              <p class="plan-status">
                <span class="plan-status-dot ${usage.status === 'active' ? 'active' : ''}"></span>
                ${usage.status === 'active' ? 'Active' : usage.status === 'trialing' ? 'Trial' : usage.status}
              </p>
            </div>
          </div>
          <div class="plan-card-body">
            <div class="plan-actions">
              <button class="btn btn-outline btn-sm" onclick="AdminApp.openBillingPortal()">Manage Billing</button>
              <a href="/pricing.html" class="btn btn-gold btn-sm">Upgrade Plan</a>
            </div>
          </div>
        </div>

        <!-- Seat Usage Card -->
        <div class="plan-card seat-card">
          <div class="plan-card-header">
            <div class="plan-icon seat-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <div>
              <h3 class="plan-name">Seat Usage</h3>
              <p class="plan-status">${usage.seats_used} of ${usage.seat_limit} seats used</p>
            </div>
          </div>
          <div class="plan-card-body">
            <div class="seat-progress-container">
              <div class="seat-progress-bar">
                <div class="seat-progress-fill ${isNearLimit ? 'warning' : ''} ${isAtLimit ? 'danger' : ''}" style="width: ${seatPercent}%"></div>
              </div>
              <div class="seat-progress-labels">
                <span>${usage.seats_used} used</span>
                <span>${usage.seat_limit - usage.seats_used} remaining</span>
              </div>
            </div>
            ${isAtLimit ? `
              <div class="seat-warning">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>Seat limit reached. Upgrade or purchase extra seats (${extraSeatCost}/user/mo).</span>
              </div>
            ` : isNearLimit ? `
              <div class="seat-warning mild">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span>Nearing seat limit. Extra seats available at ${extraSeatCost}/user/mo.</span>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  async openBillingPortal() {
    try {
      const data = await API.get('/stripe?action=portal');
      if (data && data.url) {
        window.open(data.url, '_blank');
      } else {
        UI.toast('Could not open billing portal', 'error');
      }
    } catch (error) {
      UI.toast(error.message || 'Failed to open billing portal', 'error');
    }
  },

  /* ---- CERTIFICATES ---- */
  async loadCertificates() {
    if (!this.state.selectedEntityId) {
      const container = document.getElementById('certificatesTable');
      container.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>Select an entity to view certificates</span></div>';
      return;
    }
    const container = document.getElementById('certificatesTable');
    UI.showLoader(container, 'Loading certificates...');

    const filterStatus = document.getElementById('certFilterStatus')?.value || '';
    const searchTerm = document.getElementById('certSearchInput')?.value?.toLowerCase() || '';

    try {
      let url = `/certificates?action=list&entity_id=${this.state.selectedEntityId}`;
      if (filterStatus) url += `&status=${filterStatus}`;

      const data = await API.get(url);
      let certs = data.certificates || [];

      if (searchTerm) {
        certs = certs.filter(c =>
          (c.shareholder_name || '').toLowerCase().includes(searchTerm) ||
          (c.certificate_number || '').toLowerCase().includes(searchTerm)
        );
      }

      this.state.certificates = certs;
      this.renderCertificatesTable();
    } catch (error) {
      console.error('Error loading certificates:', error);
      container.innerHTML = '<div class="empty-state"><span>Failed to load certificates</span></div>';
    }
  },

  renderCertificatesTable() {
    const container = document.getElementById('certificatesTable');
    const certs = this.state.certificates || [];

    if (certs.length === 0) {
      container.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>No certificates found</span></div>';
      return;
    }

    const fmt = (v) => v !== null && v !== undefined ? Number(v).toLocaleString() : '—';
    const fmtDate = (d) => { if (!d) return 'N/A'; const dt = new Date(d); return dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }); };

    let html = '<table class="data-table"><thead><tr><th>Certificate #</th><th>Shareholder</th><th>Stock Type</th><th>Series</th><th>Shares</th><th>Issue Date</th><th>Status</th><th>Lost/Replaced</th><th style="width:180px;">Actions</th></tr></thead><tbody>';

    certs.forEach(cert => {
      const statusClass = cert.status === 'ISSUED' ? 'active' : (cert.status === 'REPLACED' ? 'warning' : 'inactive');
      const lostInfo = cert.lost_certificate_number ? `<span class="sidebar-badge" style="font-size:9px;" title="Replaces lost cert">Replaces: ${UI.escapeHtml(cert.lost_certificate_number)}</span>` : '';
      const replacedInfo = cert.cancelled_reason === 'LOST' && cert.replaced_by_certificate_id ? '<span class="sidebar-badge" style="font-size:9px;background:var(--warning);">LOST</span>' : '';
      html += `<tr>
        <td class="mono">${UI.escapeHtml(cert.certificate_number)}</td>
        <td>${UI.escapeHtml(cert.shareholder_name)}</td>
        <td>${UI.escapeHtml(cert.stock_type_name || cert.stock_type)}</td>
        <td>${cert.series || 'N/A'}</td>
        <td>${Number(cert.shares).toLocaleString()}</td>
        <td>${fmtDate(cert.issue_date)}</td>
        <td><span class="status-badge ${statusClass}"><span class="dot"></span>${cert.status}</span></td>
        <td>${lostInfo}${replacedInfo}</td>
        <td><div class="table-actions">
          <button class="btn-table" onclick="AdminApp.downloadCertificatePdf(${cert.id})" title="Download PDF">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          ${cert.status === 'ISSUED' && Auth.isAdmin() ? `
            <button class="btn-table danger" onclick="AdminApp.openCancelCertificateModal(${cert.id}, '${UI.escapeHtml(cert.certificate_number)}', '${UI.escapeHtml(cert.shareholder_name)}', ${cert.shares})" title="Cancel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
            </button>
            <button class="btn-table edit" onclick="AdminApp.openReissueCertificateModal(${cert.id}, '${UI.escapeHtml(cert.certificate_number)}', '${UI.escapeHtml(cert.shareholder_name)}', ${cert.shares})" title="Reissue">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="17 1 21 5 17 9"></polyline>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                <polyline points="7 23 3 19 7 15"></polyline>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
              </svg>
            </button>
            <button class="btn-table" onclick="AdminApp.openReportLostModal(${cert.id}, '${UI.escapeHtml(cert.certificate_number)}', '${UI.escapeHtml(cert.shareholder_name)}', ${cert.shares})" title="Report Lost" style="color:var(--warning);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
            </button>
          ` : ''}
          ${cert.cancelled_reason === 'LOST' ? `
            <button class="btn-table" onclick="AdminApp.openGenerateAffidavitModal(${cert.id}, '${UI.escapeHtml(cert.certificate_number)}', '${UI.escapeHtml(cert.shareholder_name)}', ${cert.shares})" title="Generate Affidavit" style="color:var(--gold);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
            </button>
          ` : ''}
          ${cert.replaced_by_certificate_id ? '<span class="sidebar-badge" style="font-size:9px;">Replaced</span>' : ''}
        </div></td>
      </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  },

  openGenerateCertificateModal() {
    if (!this.state.selectedEntityId) { UI.toast('Please select an entity first', 'warning'); return; }
    const form = document.getElementById('generateCertificateForm');
    if (form) form.reset();

    const shSelect = document.getElementById('certShareholder');
    shSelect.innerHTML = '<option value="">Select shareholder...</option>';
    (this.state.shareholders || []).forEach(sh => {
      const opt = document.createElement('option');
      opt.value = sh.id;
      opt.textContent = `${sh.full_name} (${sh.external_id || sh.id})`;
      shSelect.appendChild(opt);
    });

    const stSelect = document.getElementById('certStockType');
    stSelect.innerHTML = '<option value="">Select stock type...</option>';
    (this.state.stockTypes || []).forEach(st => {
      if (!st.is_active) return;
      const opt = document.createElement('option');
      opt.value = st.id;
      opt.textContent = st.display_name;
      opt.dataset.supportsSeries = st.supports_series;
      stSelect.appendChild(opt);
    });

    document.getElementById('certIssueDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('certSeries').innerHTML = '<option value="">N/A</option>';
    document.getElementById('certSeries').disabled = true;
    this.state.isSubmitting = false;
    UI.openModal('generateCertificateModal');
  },

  async handleCertStockTypeChange() {
    const stSelect = document.getElementById('certStockType');
    const seriesSelect = document.getElementById('certSeries');
    const selectedOption = stSelect.options[stSelect.selectedIndex];
    const supportsSeries = selectedOption?.dataset.supportsSeries === 'true';

    if (!supportsSeries) {
      seriesSelect.innerHTML = '<option value="">N/A</option>';
      seriesSelect.disabled = true;
      return;
    }

    seriesSelect.innerHTML = '<option value="">Loading...</option>';
    seriesSelect.disabled = true;

    try {
      const data = await API.get(`/stockTypes?action=list-series&entity_stock_type_id=${stSelect.value}`);
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
      seriesSelect.innerHTML = '<option value="">Error</option>';
    }
  },

  async handleGenerateCertificateSubmit(event) {
    event.preventDefault();
    if (this.state.isSubmitting) return;
    this.state.isSubmitting = true;
    const submitBtn = document.getElementById('certSubmitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Generating...'; }

    const payload = {
      shareholder_id: document.getElementById('certShareholder').value,
      entity_stock_type_id: document.getElementById('certStockType').value,
      entity_stock_series_id: document.getElementById('certSeries').value || null,
      shares: parseInt(document.getElementById('certShares').value),
      issue_date: document.getElementById('certIssueDate').value || null,
      signed_by_name: document.getElementById('certSignedByName').value || null,
      signed_by_title: document.getElementById('certSignedByTitle').value || null,
      countersigned_by_name: document.getElementById('certCountersignedByName').value || null,
      countersigned_by_title: document.getElementById('certCountersignedByTitle').value || null,
    };

    try {
      const result = await API.post('/certificates?action=generate', payload);
      UI.closeModal('generateCertificateModal');
      UI.toast(`Certificate ${result.certificate.certificate_number} generated`, 'success');
      await this.loadCertificates();
      this.downloadCertificatePdf(result.certificate.id);
    } catch (error) {
      UI.toast(error.message || 'Failed to generate certificate', 'error');
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Generate Certificate'; }
    }
  },

  async downloadCertificatePdf(certificateId) {
    const token = Auth.getToken();
    try {
      const res = await fetch(`${CONFIG.API_BASE_URL}/certificates?action=download&certificate_id=${certificateId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        UI.toast(errData.error || 'Failed to download', 'error');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      const a = document.createElement('a');
      a.href = url;
      a.download = `certificate_${certificateId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      UI.toast('Failed to download certificate PDF', 'error');
    }
  },

  openCancelCertificateModal(certId, certNumber, shareholderName, shares) {
    document.getElementById('cancelCertId').value = certId;
    document.getElementById('cancelCertReason').value = '';
    document.getElementById('cancelCertInfo').innerHTML = `
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:16px;">
        <p style="margin:0 0 4px;"><strong>Certificate:</strong> ${UI.escapeHtml(certNumber)}</p>
        <p style="margin:0 0 4px;"><strong>Shareholder:</strong> ${UI.escapeHtml(shareholderName)}</p>
        <p style="margin:0;"><strong>Shares:</strong> ${Number(shares).toLocaleString()}</p>
      </div>`;
    UI.openModal('cancelCertificateModal');
  },

  async handleCancelCertificateSubmit(event) {
    event.preventDefault();
    if (this.state.isSubmitting) return;
    this.state.isSubmitting = true;
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Cancelling...'; }

    try {
      await API.post('/certificates?action=cancel', {
        certificate_id: parseInt(document.getElementById('cancelCertId').value),
        reason: document.getElementById('cancelCertReason').value,
      });
      UI.closeModal('cancelCertificateModal');
      UI.toast('Certificate cancelled', 'success');
      await this.loadCertificates();
    } catch (error) {
      UI.toast(error.message || 'Failed to cancel certificate', 'error');
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Cancel Certificate'; }
    }
  },

  openReissueCertificateModal(certId, certNumber, shareholderName, shares) {
    document.getElementById('reissueCertId').value = certId;
    document.getElementById('reissueReason').value = '';
    document.getElementById('reissueNewShares').value = '';
    document.getElementById('reissueCertInfo').innerHTML = `
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:16px;">
        <p style="margin:0 0 4px;"><strong>Original Certificate:</strong> ${UI.escapeHtml(certNumber)}</p>
        <p style="margin:0 0 4px;"><strong>Shareholder:</strong> ${UI.escapeHtml(shareholderName)}</p>
        <p style="margin:0;"><strong>Shares:</strong> ${Number(shares).toLocaleString()}</p>
      </div>`;

    const select = document.getElementById('reissueNewShareholder');
    select.innerHTML = '<option value="">Same shareholder</option>';
    (this.state.shareholders || []).forEach(sh => {
      const opt = document.createElement('option');
      opt.value = sh.id;
      opt.textContent = `${sh.full_name} (${sh.external_id || sh.id})`;
      select.appendChild(opt);
    });
    UI.openModal('reissueCertificateModal');
  },

  async handleReissueCertificateSubmit(event) {
    event.preventDefault();
    if (this.state.isSubmitting) return;
    this.state.isSubmitting = true;
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Reissuing...'; }

    try {
      const result = await API.post('/certificates?action=reissue', {
        certificate_id: parseInt(document.getElementById('reissueCertId').value),
        reason: document.getElementById('reissueReason').value,
        new_shareholder_id: document.getElementById('reissueNewShareholder').value ? parseInt(document.getElementById('reissueNewShareholder').value) : null,
        new_shares: document.getElementById('reissueNewShares').value ? parseInt(document.getElementById('reissueNewShares').value) : null,
      });
      UI.closeModal('reissueCertificateModal');
      UI.toast(`Certificate reissued: ${result.new_certificate.certificate_number}`, 'success');
      await this.loadCertificates();
      this.downloadCertificatePdf(result.new_certificate.id);
    } catch (error) {
      UI.toast(error.message || 'Failed to reissue certificate', 'error');
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Reissue Certificate'; }
    }
  },

  /* ---- REPORT LOST CERTIFICATE ---- */
  openReportLostModal(certId, certNumber, shareholderName, shares) {
    document.getElementById('lostCertId').value = certId;
    document.getElementById('lostSignedByName').value = '';
    document.getElementById('lostSignedByTitle').value = '';
    document.getElementById('lostCountersignedByName').value = '';
    document.getElementById('lostCountersignedByTitle').value = '';
    document.getElementById('lostCertInfo').innerHTML = `
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:16px;">
        <p style="margin:0 0 4px;"><strong>Certificate:</strong> ${UI.escapeHtml(certNumber)}</p>
        <p style="margin:0 0 4px;"><strong>Shareholder:</strong> ${UI.escapeHtml(shareholderName)}</p>
        <p style="margin:0;"><strong>Shares:</strong> ${Number(shares).toLocaleString()}</p>
      </div>`;
    UI.openModal('reportLostCertificateModal');
  },

  async handleReportLostSubmit(event) {
    event.preventDefault();
    if (this.state.isSubmitting) return;
    this.state.isSubmitting = true;
    const submitBtn = document.getElementById('lostCertSubmitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Processing...'; }

    try {
      const result = await API.post('/certificates?action=report-lost', {
        certificate_id: parseInt(document.getElementById('lostCertId').value),
        signed_by_name: document.getElementById('lostSignedByName').value || null,
        signed_by_title: document.getElementById('lostSignedByTitle').value || null,
        countersigned_by_name: document.getElementById('lostCountersignedByName').value || null,
        countersigned_by_title: document.getElementById('lostCountersignedByTitle').value || null,
      });
      UI.closeModal('reportLostCertificateModal');
      UI.toast(`Lost certificate reported. Replacement: ${result.new_certificate.certificate_number}`, 'success');
      await this.loadCertificates();
      this.downloadCertificatePdf(result.new_certificate.id);
    } catch (error) {
      UI.toast(error.message || 'Failed to report lost certificate', 'error');
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Report Lost & Issue Replacement'; }
    }
  },

  /* ---- LOST CERTIFICATE AFFIDAVIT ---- */
  openGenerateAffidavitModal(certId, certNumber, shareholderName, shares) {
    document.getElementById('affidavitCertId').value = certId;
    document.getElementById('affidavitNarrative').value = '';
    document.getElementById('affidavitSignerName').value = '';
    document.getElementById('affidavitSignerTitle').value = '';
    document.getElementById('affidavitNotaryState').value = '';
    document.getElementById('affidavitNotaryCounty').value = '';
    document.getElementById('affidavitCertInfo').innerHTML = `
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:16px;">
        <p style="margin:0 0 4px;"><strong>Lost Certificate:</strong> ${UI.escapeHtml(certNumber)}</p>
        <p style="margin:0 0 4px;"><strong>Shareholder:</strong> ${UI.escapeHtml(shareholderName)}</p>
        <p style="margin:0;"><strong>Shares:</strong> ${Number(shares).toLocaleString()}</p>
      </div>`;
    UI.openModal('generateAffidavitModal');
  },

  async handleGenerateAffidavitSubmit(event) {
    event.preventDefault();
    if (this.state.isSubmitting) return;
    this.state.isSubmitting = true;
    const submitBtn = document.getElementById('affidavitSubmitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Generating...'; }

    const token = Auth.getToken();
    try {
      const res = await fetch(`${CONFIG.API_BASE_URL}/certificates?action=generate-affidavit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          certificate_id: parseInt(document.getElementById('affidavitCertId').value),
          narrative: document.getElementById('affidavitNarrative').value || null,
          signer_name: document.getElementById('affidavitSignerName').value || null,
          signer_title: document.getElementById('affidavitSignerTitle').value || null,
          notary_state: document.getElementById('affidavitNotaryState').value || null,
          notary_county: document.getElementById('affidavitNotaryCounty').value || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to generate affidavit');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      const a = document.createElement('a');
      a.href = url;
      a.download = `Lost_Certificate_Affidavit.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      UI.closeModal('generateAffidavitModal');
      UI.toast('Lost Certificate Affidavit generated', 'success');
    } catch (error) {
      UI.toast(error.message || 'Failed to generate affidavit', 'error');
    } finally {
      this.state.isSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Generate Affidavit PDF'; }
    }
  }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => AdminApp.init());
