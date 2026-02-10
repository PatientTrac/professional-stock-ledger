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
  roles: { SUPER_ADMIN: 'SUPER_ADMIN', ADMIN: 'ADMIN', USER: 'USER' }
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
  isAdmin() { const u = this.getUser(); return u?.role === CONFIG.roles.SUPER_ADMIN || u?.role === CONFIG.roles.ADMIN; },
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
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      },
      ...options
    };
    try {
      const res = await fetch(`${CONFIG.API_BASE_URL}${path}`, config);
      if (res.status === 401) { Auth.logout(); return null; }

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
    const toggle = document.getElementById('mobileMenuToggle');
    const menu = document.getElementById('mobileMenu');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', () => menu.classList.toggle('hidden'));
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
  },

  /* ---- TABS ---- */
  switchTab(tabName) {
    this.state.currentTab = tabName;
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tabName}`));
    const filterBar = document.getElementById('adminEntityFilterBar');
    if (filterBar) filterBar.style.display = ['shareholders', 'stock-types', 'users'].includes(tabName) ? 'flex' : 'none';

    if (tabName === 'shareholders') this.loadShareholders();
    else if (tabName === 'stock-types') this.loadStockTypes();
    else if (tabName === 'users') this.loadUsers();
    else if (tabName === 'entities') this.renderEntitiesTable();
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
        <td><div class="table-actions"><button class="btn-table edit" onclick="AdminApp.editShareholder(${sh.id})" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-table danger" onclick="AdminApp.deleteShareholder(${sh.id}, '${UI.escapeHtml(sh.full_name).replace(/'/g, "\\'")}')" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></div></td>
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

  openDeleteShareholderModal(id, name) {
  document.getElementById('deleteShareholderName').textContent = `"${name}"`;

  const confirmBtn = document.getElementById('confirmDeleteShareholderBtn');

  // Remove old click handlers (important)
  confirmBtn.onclick = null;

  confirmBtn.onclick = async () => {
    try {
      await API.delete(`/shareholders?action=delete&id=${id}`);
      UI.toast('Shareholder deleted/deactivated', 'success');
      UI.closeModal('deleteShareholderModal');
      await this.loadShareholders();
    } catch (error) {
      UI.toast(error.message || 'Failed to delete shareholder', 'error');
    }
  };

  UI.openModal('deleteShareholderModal');
},

  deleteShareholder(id, name) {
	this.openDeleteShareholderModal(id, name);
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
    let html = '<table class="data-table"><thead><tr><th style="width:40px;"></th><th>Stock Type</th><th>Display Name</th><th>Supports Series</th><th>Status</th><th style="width:100px;">Actions</th></tr></thead><tbody>';
    this.state.stockTypes.forEach(st => {
      const numId = Number(st.id);
      const isExpanded = this.state.expandedStockTypes.has(numId);
      const hasSeries = st.supports_series && st.series && st.series.length > 0;
      html += `<tr class="stock-type-row ${isExpanded ? 'expanded' : ''}" ${st.supports_series ? `onclick="AdminApp.toggleStockTypeRow(${numId})"` : ''} style="cursor:${st.supports_series ? 'pointer' : 'default'}">
        <td>${st.supports_series ? `<svg class="expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transition:transform 0.2s;${isExpanded ? 'transform:rotate(90deg)' : ''}"><polyline points="9 18 15 12 9 6"/></svg>` : ''}</td>
        <td><span class="mono">${UI.escapeHtml(st.stock_type)}</span></td>
        <td>${UI.escapeHtml(st.display_name)}</td>
        <td>${st.supports_series ? `<span class="supports-series-badge">Yes ${hasSeries ? '(' + st.series.length + ')' : ''}</span>` : '<span class="text-muted">No</span>'}</td>
        <td><span class="status-badge ${st.is_active ? 'active' : 'inactive'}"><span class="dot"></span>${st.is_active ? 'Active' : 'Inactive'}</span></td>
        <td onclick="event.stopPropagation()"><div class="table-actions">
        <button class="btn-table edit" onclick="event.stopPropagation(); AdminApp.editStockType(${numId})" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          ${st.supports_series ? `<button class="btn-table" onclick="event.stopPropagation(); AdminApp.openAddSeriesModal(${numId})" title="Add Series"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>` : ''}
        </div></td>
      </tr>`;
      if (st.supports_series) {
        html += `<tr class="series-detail-row ${isExpanded ? 'visible' : ''}" id="series-row-${numId}" style="display:${isExpanded ? 'table-row' : 'none'}"><td colspan="6"><div class="series-detail-content"><div class="series-detail-header"><h4>Series for ${UI.escapeHtml(st.display_name)}</h4></div>`;
        if (st.series && st.series.length > 0) {
          html += '<table class="data-table series-table" style="margin:0;"><thead><tr><th>Series Name</th><th>Status</th><th style="width:60px;">Actions</th></tr></thead><tbody>';
          st.series.forEach(s => {
            html += `<tr class="${s.is_active ? '' : 'inactive-row'}">
              <td>Series ${UI.escapeHtml(s.series)}</td>
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
    document.getElementById('stockTypeActive').checked = st.is_active;
    this.state.isSubmitting = false;
    UI.openModal('stockTypeModal');
  },

  async handleStockTypeSubmit(event) {
    event.preventDefault();
    if (this.state.isSubmitting) return;
    this.state.isSubmitting = true;
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    const id = document.getElementById('stockTypeId').value;
    const isEdit = !!id;
    const codeSelect = document.getElementById('stockTypeCode');
    // Re-enable temporarily so value is accessible
    const wasDisabled = codeSelect.disabled;
    codeSelect.disabled = false;
    const payload = {
      entity_id: this.state.selectedEntityId,
      stock_type: codeSelect.value,
      display_name: document.getElementById('stockTypeDisplayName').value,
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
    document.getElementById('seriesActive').checked = series.is_active;
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
    let html = '<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Entity</th><th>Status</th><th style="width:100px;">Actions</th></tr></thead><tbody>';
    this.state.users.forEach(user => {
      const entity = this.state.entities.find(e => e.id === user.entity_id);
      html += `<tr>
        <td>${UI.escapeHtml(user.full_name)}</td>
        <td class="mono">${UI.escapeHtml(user.email)}</td>
        <td><span class="role-badge ${user.role.toLowerCase()}">${user.role}</span></td>
        <td>${entity ? UI.escapeHtml(entity.name) : '—'}</td>
        <td><span class="status-badge ${user.is_active ? 'active' : 'inactive'}"><span class="dot"></span>${user.is_active ? 'Active' : 'Inactive'}</span></td>
        <td><div class="table-actions"><button class="btn-table edit" onclick="AdminApp.editUser(${user.id})" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-table danger" onclick="AdminApp.deleteUser(${user.id}, '${UI.escapeHtml(user.full_name || user.email).replace(/'/g, "\\'")}')" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></div></td>
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
        <td><div class="table-actions"><button class="btn-table edit" onclick="AdminApp.editEntity(${entity.id})" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-table danger" onclick="AdminApp.deleteEntity(${entity.id}, '${UI.escapeHtml(entity.name).replace(/'/g, "\\'")}')" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></div></td>
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

  /* ---- DELETE USER ---- */
  deleteUser(id, name) {
    this.openDeleteUserModal(id, name);
  },

  openDeleteUserModal(id, name) {
    document.getElementById('deleteUserName').textContent = `"${name}"`;
    const confirmBtn = document.getElementById('confirmDeleteUserBtn');
    confirmBtn.onclick = null;
    confirmBtn.onclick = async () => {
      try {
        await API.delete(`/users?action=delete&id=${id}`);
        UI.toast('User deleted/deactivated', 'success');
        UI.closeModal('deleteUserModal');
        await this.loadUsers();
      } catch (error) {
        UI.toast(error.message || 'Failed to delete user', 'error');
      }
    };
    UI.openModal('deleteUserModal');
  },

  /* ---- DELETE ENTITY ---- */
  deleteEntity(id, name) {
    this.openDeleteEntityModal(id, name);
  },

  openDeleteEntityModal(id, name) {
    document.getElementById('deleteEntityName').textContent = `"${name}"`;
    const confirmBtn = document.getElementById('confirmDeleteEntityBtn');
    confirmBtn.onclick = null;
    confirmBtn.onclick = async () => {
      try {
        await API.delete(`/entities?action=delete&id=${id}`);
        UI.toast('Entity deleted/deactivated', 'success');
        UI.closeModal('deleteEntityModal');
        await this.loadEntities();
        this.renderEntitiesTable();
      } catch (error) {
        UI.toast(error.message || 'Failed to delete entity', 'error');
      }
    };
    UI.openModal('deleteEntityModal');
  }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => AdminApp.init());
