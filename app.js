/* ================================================
   ExpenseFlow — Application Logic (API-backed)
   With: Auth, Dynamic Categories, Reports, CSV Import, Pagination
   ================================================ */

// ---- Configuration ----
// Auto-detect API URL: when served via Django (port 8000), use relative path.
// When served via VS Code Live Server or other static server, point to Django backend.
const API_BASE = (() => {
    const port = window.location.port;
    // If served from Django (default port 8000), use relative URLs
    if (port === '8000') return '/api';
    // Otherwise, point to Django backend at 127.0.0.1
    return 'http://127.0.0.1:8000/api';
})();

const MONTHLY_BUDGET = 50000;

// ---- Utility ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const fmt = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

function toDateStr(d) {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---- Auth Manager ----
class AuthManager {
    constructor() {
        this.accessToken = localStorage.getItem('ef_access');
        this.refreshToken = localStorage.getItem('ef_refresh');
        this.user = JSON.parse(localStorage.getItem('ef_user') || 'null');
    }

    isAuthenticated() {
        return !!this.accessToken;
    }

    saveTokens(tokens, user) {
        this.accessToken = tokens.access;
        this.refreshToken = tokens.refresh;
        this.user = user;
        localStorage.setItem('ef_access', tokens.access);
        localStorage.setItem('ef_refresh', tokens.refresh);
        localStorage.setItem('ef_user', JSON.stringify(user));
    }

    clearTokens() {
        this.accessToken = null;
        this.refreshToken = null;
        this.user = null;
        localStorage.removeItem('ef_access');
        localStorage.removeItem('ef_refresh');
        localStorage.removeItem('ef_user');
    }

    async refreshAccessToken() {
        if (!this.refreshToken) return false;
        try {
            const res = await fetch(`${API_BASE}/auth/token/refresh/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh: this.refreshToken }),
            });
            if (!res.ok) {
                this.clearTokens();
                return false;
            }
            const data = await res.json();
            this.accessToken = data.access;
            if (data.refresh) this.refreshToken = data.refresh;
            localStorage.setItem('ef_access', data.access);
            if (data.refresh) localStorage.setItem('ef_refresh', data.refresh);
            return true;
        } catch {
            this.clearTokens();
            return false;
        }
    }

    async register(username, email, password, password2) {
        const res = await fetch(`${API_BASE}/auth/register/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password, password2 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(this._extractError(data));
        this.saveTokens(data.tokens, data.user);
        return data;
    }

    async login(username, password) {
        const res = await fetch(`${API_BASE}/auth/login/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Login failed.');
        this.saveTokens(data.tokens, data.user);
        return data;
    }

    logout() {
        this.clearTokens();
    }

    _extractError(data) {
        if (typeof data === 'string') return data;
        const messages = [];
        for (const key in data) {
            const val = Array.isArray(data[key]) ? data[key].join(', ') : data[key];
            messages.push(`${key}: ${val}`);
        }
        return messages.join(' | ') || 'Registration failed.';
    }
}

// ---- API Store ----
class ApiStore {
    constructor(auth) {
        this.baseUrl = API_BASE;
        this.auth = auth;
    }

    async _fetch(url, options = {}) {
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        if (this.auth.accessToken) {
            headers['Authorization'] = `Bearer ${this.auth.accessToken}`;
        }
        let res = await fetch(url, { ...options, headers });

        // Token expired — try refresh
        if (res.status === 401 && this.auth.refreshToken) {
            const refreshed = await this.auth.refreshAccessToken();
            if (refreshed) {
                headers['Authorization'] = `Bearer ${this.auth.accessToken}`;
                res = await fetch(url, { ...options, headers });
            }
        }

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`API error ${res.status}: ${err}`);
        }
        if (res.status === 204) return null;
        return res.json();
    }

    async getAll(params = {}) {
        const query = new URLSearchParams();
        if (params.category && params.category !== 'all') query.set('category', params.category);
        if (params.month) query.set('month', params.month);
        if (params.search) query.set('search', params.search);
        if (params.sort) query.set('sort', params.sort);
        if (params.page) query.set('page', params.page);
        const qs = query.toString();
        return this._fetch(`${this.baseUrl}/expenses/${qs ? '?' + qs : ''}`);
    }

    async getById(id) {
        return this._fetch(`${this.baseUrl}/expenses/${id}/`);
    }

    async add(expense) {
        return this._fetch(`${this.baseUrl}/expenses/`, {
            method: 'POST',
            body: JSON.stringify(expense),
        });
    }

    async update(id, data) {
        return this._fetch(`${this.baseUrl}/expenses/${id}/`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async patch(id, data) {
        return this._fetch(`${this.baseUrl}/expenses/${id}/`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async delete(id) {
        return this._fetch(`${this.baseUrl}/expenses/${id}/`, {
            method: 'DELETE',
        });
    }

    async getSummary() {
        return this._fetch(`${this.baseUrl}/expenses/summary/`);
    }

    async getAnalytics() {
        return this._fetch(`${this.baseUrl}/expenses/analytics/`);
    }

    async getCategories() {
        return this._fetch(`${this.baseUrl}/categories/`);
    }

    async getMonthlyReport(month) {
        return this._fetch(`${this.baseUrl}/expenses/report/?month=${month}`);
    }

    async downloadReport(month) {
        const headers = {};
        if (this.auth.accessToken) {
            headers['Authorization'] = `Bearer ${this.auth.accessToken}`;
        }
        const res = await fetch(`${this.baseUrl}/expenses/report/download/?month=${month}`, { headers });
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `expenses_${month}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async importCSV(file) {
        const formData = new FormData();
        formData.append('file', file);
        const headers = {};
        if (this.auth.accessToken) {
            headers['Authorization'] = `Bearer ${this.auth.accessToken}`;
        }
        const res = await fetch(`${this.baseUrl}/expenses/import-csv/`, {
            method: 'POST',
            headers,
            body: formData,
        });
        const data = await res.json();
        if (!res.ok && data.created === undefined) throw new Error('Import failed');
        return data;
    }
}

// ---- Chart Drawing ----
class ChartRenderer {
    static drawBarChart(canvas, data, options = {}) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const padding = { top: 20, right: 20, bottom: 40, left: 60 };
        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        ctx.clearRect(0, 0, w, h);

        if (!data.length) {
            ctx.fillStyle = '#64748b';
            ctx.font = '14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', w / 2, h / 2);
            return;
        }

        const maxVal = Math.max(...data.map(d => d.value)) * 1.15 || 100;
        const barGap = Math.max(4, chartW / data.length * 0.3);
        const barWidth = (chartW - barGap * (data.length + 1)) / data.length;

        // Grid lines
        const gridLines = 5;
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        for (let i = 0; i <= gridLines; i++) {
            const y = padding.top + (chartH / gridLines) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(w - padding.right, y);
            ctx.stroke();

            const val = maxVal - (maxVal / gridLines) * i;
            ctx.fillStyle = '#64748b';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'k' : Math.round(val), padding.left - 10, y + 4);
        }
        ctx.setLineDash([]);

        // Bars
        data.forEach((d, i) => {
            const x = padding.left + barGap + i * (barWidth + barGap);
            const barH = (d.value / maxVal) * chartH;
            const y = padding.top + chartH - barH;

            const grad = ctx.createLinearGradient(x, y, x, padding.top + chartH);
            const baseColor = d.color || '#8b5cf6';
            grad.addColorStop(0, baseColor);
            grad.addColorStop(1, baseColor + '40');

            ctx.fillStyle = grad;
            ctx.beginPath();
            const r = Math.min(4, barWidth / 2);
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + barWidth - r, y);
            ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + r);
            ctx.lineTo(x + barWidth, padding.top + chartH);
            ctx.lineTo(x, padding.top + chartH);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.fill();

            ctx.shadowColor = baseColor;
            ctx.shadowBlur = 10;
            ctx.fillRect(x, y, barWidth, 2);
            ctx.shadowBlur = 0;

            ctx.fillStyle = '#94a3b8';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(d.label, x + barWidth / 2, h - 12);
        });
    }

    static drawDonutChart(canvas, data, options = {}) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height);
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        ctx.scale(dpr, dpr);

        const cx = size / 2;
        const cy = size / 2;
        const outerR = size / 2 - 10;
        const innerR = outerR * 0.65;

        ctx.clearRect(0, 0, size, size);

        if (!data.length) {
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = outerR - innerR;
            ctx.beginPath();
            ctx.arc(cx, cy, (outerR + innerR) / 2, 0, Math.PI * 2);
            ctx.stroke();
            return;
        }

        const total = data.reduce((s, d) => s + d.value, 0);
        let startAngle = -Math.PI / 2;

        data.forEach(d => {
            const sliceAngle = (d.value / total) * Math.PI * 2;
            const endAngle = startAngle + sliceAngle;

            ctx.beginPath();
            ctx.arc(cx, cy, outerR, startAngle, endAngle);
            ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = d.color;
            ctx.fill();

            ctx.strokeStyle = '#0a0e1a';
            ctx.lineWidth = 2;
            ctx.stroke();

            startAngle = endAngle;
        });
    }

    static drawMonthlyChart(canvas, data) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const padding = { top: 20, right: 20, bottom: 40, left: 60 };
        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        ctx.clearRect(0, 0, w, h);

        if (!data.length) {
            ctx.fillStyle = '#64748b';
            ctx.font = '14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', w / 2, h / 2);
            return;
        }

        const maxVal = Math.max(...data.map(d => d.value)) * 1.15 || 100;

        // Grid
        const gridLines = 5;
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        for (let i = 0; i <= gridLines; i++) {
            const y = padding.top + (chartH / gridLines) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(w - padding.right, y);
            ctx.stroke();
            const val = maxVal - (maxVal / gridLines) * i;
            ctx.fillStyle = '#64748b';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'k' : Math.round(val), padding.left - 10, y + 4);
        }
        ctx.setLineDash([]);

        // Area + Line
        const stepX = chartW / (data.length - 1 || 1);

        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top + chartH);
        data.forEach((d, i) => {
            const x = padding.left + i * stepX;
            const y = padding.top + chartH - (d.value / maxVal) * chartH;
            if (i === 0) ctx.lineTo(x, y);
            else {
                const prevX = padding.left + (i - 1) * stepX;
                const prevY = padding.top + chartH - (data[i - 1].value / maxVal) * chartH;
                const cpx = (prevX + x) / 2;
                ctx.bezierCurveTo(cpx, prevY, cpx, y, x, y);
            }
        });
        ctx.lineTo(padding.left + (data.length - 1) * stepX, padding.top + chartH);
        ctx.closePath();
        const areaGrad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
        areaGrad.addColorStop(0, 'rgba(139, 92, 246, 0.2)');
        areaGrad.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = areaGrad;
        ctx.fill();

        ctx.beginPath();
        data.forEach((d, i) => {
            const x = padding.left + i * stepX;
            const y = padding.top + chartH - (d.value / maxVal) * chartH;
            if (i === 0) ctx.moveTo(x, y);
            else {
                const prevX = padding.left + (i - 1) * stepX;
                const prevY = padding.top + chartH - (data[i - 1].value / maxVal) * chartH;
                const cpx = (prevX + x) / 2;
                ctx.bezierCurveTo(cpx, prevY, cpx, y, x, y);
            }
        });
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        data.forEach((d, i) => {
            const x = padding.left + i * stepX;
            const y = padding.top + chartH - (d.value / maxVal) * chartH;

            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#8b5cf6';
            ctx.fill();
            ctx.strokeStyle = '#0a0e1a';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#94a3b8';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(d.label, x, h - 12);
        });
    }
}

// ---- App ----
class ExpenseFlowApp {
    constructor() {
        this.auth = new AuthManager();
        this.store = new ApiStore(this.auth);
        this.currentView = 'dashboard';
        this.editingId = null;
        this.deletingId = null;
        this.selectedCategory = null;
        this.trendPeriod = 'week';
        this.currentPage = 1;
        this.csvFile = null;

        // Cache
        this._summaryCache = null;
        this._analyticsCache = null;
        this._categoriesCache = null;

        this._initAuth();
    }

    // ---- Auth Flow ----
    _initAuth() {
        // Auth form events
        $('#login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this._handleLogin();
        });
        $('#register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this._handleRegister();
        });
        $('#show-register').addEventListener('click', () => {
            this._clearAuthErrors();
            $('#login-card').classList.add('hidden');
            $('#register-card').classList.remove('hidden');
        });
        $('#show-login').addEventListener('click', () => {
            this._clearAuthErrors();
            $('#register-card').classList.add('hidden');
            $('#login-card').classList.remove('hidden');
        });

        if (this.auth.isAuthenticated()) {
            this._showApp();
        } else {
            this._showAuth();
        }
    }

    async _handleLogin() {
        const btn = $('#login-btn');
        const errorDiv = $('#login-error');
        const btnText = btn.querySelector('.btn-text');
        const spinner = $('#login-spinner');

        this._clearAuthErrors();
        btn.disabled = true;
        btnText.textContent = 'Signing in...';
        spinner.classList.remove('hidden');

        try {
            await this.auth.login(
                $('#login-username').value.trim(),
                $('#login-password').value
            );
            this._showApp();
        } catch (err) {
            this._showAuthError(errorDiv, err.message);
        } finally {
            btn.disabled = false;
            btnText.textContent = 'Sign In';
            spinner.classList.add('hidden');
        }
    }

    async _handleRegister() {
        const btn = $('#register-btn');
        const errorDiv = $('#register-error');
        const btnText = btn.querySelector('.btn-text');
        const spinner = $('#register-spinner');

        this._clearAuthErrors();
        btn.disabled = true;
        btnText.textContent = 'Creating account...';
        spinner.classList.remove('hidden');

        // Client-side password match check
        const pwd = $('#reg-password').value;
        const pwd2 = $('#reg-password2').value;
        if (pwd !== pwd2) {
            this._showAuthError(errorDiv, 'Passwords do not match.');
            btn.disabled = false;
            btnText.textContent = 'Create Account';
            spinner.classList.add('hidden');
            return;
        }

        try {
            await this.auth.register(
                $('#reg-username').value.trim(),
                $('#reg-email').value.trim(),
                pwd,
                pwd2
            );
            this._showApp();
        } catch (err) {
            this._showAuthError(errorDiv, err.message);
        } finally {
            btn.disabled = false;
            btnText.textContent = 'Create Account';
            spinner.classList.add('hidden');
        }
    }

    _showAuthError(el, message) {
        el.textContent = message;
        el.classList.remove('hidden');
        // Shake animation
        el.style.animation = 'none';
        el.offsetHeight; // trigger reflow
        el.style.animation = '';
    }

    _clearAuthErrors() {
        const errors = document.querySelectorAll('.auth-error');
        errors.forEach(el => {
            el.classList.add('hidden');
            el.textContent = '';
        });
    }

    _handleLogout() {
        this.auth.logout();
        this._summaryCache = null;
        this._analyticsCache = null;
        this._categoriesCache = null;
        this._showAuth();
    }

    _showAuth() {
        $('#auth-page').classList.remove('hidden');
        $('#app-wrapper').classList.add('hidden');
    }

    async _showApp() {
        $('#auth-page').classList.add('hidden');
        $('#app-wrapper').classList.remove('hidden');

        // Display user name
        if (this.auth.user) {
            $('#user-display-name').textContent = this.auth.user.username;
        }

        this._bindElements();
        this._bindEvents();
        await this._loadCategories();
        this._initCategoryGrid();
        this._initFilters();
        this._updateGreeting();
        this.refresh();
    }

    // ---- Load Dynamic Categories ----
    async _loadCategories() {
        try {
            const data = await this.store.getCategories();
            // Handle paginated and non-paginated responses
            this._categoriesCache = data.results || data;
        } catch (err) {
            console.error('Failed to load categories', err);
            this._categoriesCache = [];
        }
    }

    _getCategories() {
        return this._categoriesCache || [];
    }

    _bindElements() {
        this.els = {
            sidebar: $('#sidebar'),
            mainContent: $('#main-content'),
            modalOverlay: $('#modal-overlay'),
            deleteModalOverlay: $('#delete-modal-overlay'),
            importModalOverlay: $('#import-modal-overlay'),
            expenseForm: $('#expense-form'),
            toastContainer: $('#toast-container'),
        };
    }

    _bindEvents() {
        // Navigation
        $$('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => this._switchView(btn.dataset.view));
        });

        // Add expense buttons
        $('#add-expense-btn').addEventListener('click', () => this._openModal());
        $('#add-expense-btn-2').addEventListener('click', () => this._openModal());
        $('#add-btn-mobile').addEventListener('click', () => this._openModal());

        // Logout
        $('#logout-btn').addEventListener('click', () => this._handleLogout());

        // Modal
        $('#modal-close').addEventListener('click', () => this._closeModal());
        $('#modal-cancel').addEventListener('click', () => this._closeModal());
        this.els.modalOverlay.addEventListener('click', (e) => {
            if (e.target === this.els.modalOverlay) this._closeModal();
        });

        // Delete modal
        $('#delete-cancel').addEventListener('click', () => this._closeDeleteModal());
        this.els.deleteModalOverlay.addEventListener('click', (e) => {
            if (e.target === this.els.deleteModalOverlay) this._closeDeleteModal();
        });
        $('#delete-confirm').addEventListener('click', () => this._confirmDelete());

        // Form submit
        this.els.expenseForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this._saveExpense();
        });

        // View all
        $('#view-all-btn').addEventListener('click', () => this._switchView('expenses'));

        // Mobile menu
        $('#menu-toggle').addEventListener('click', () => this._toggleMobileMenu());

        // Filters
        $('#search-input').addEventListener('input', () => { this.currentPage = 1; this._renderExpensesList(); });
        $('#filter-category').addEventListener('change', () => { this.currentPage = 1; this._renderExpensesList(); });
        $('#filter-month').addEventListener('change', () => { this.currentPage = 1; this._renderExpensesList(); });
        $('#sort-by').addEventListener('change', () => { this.currentPage = 1; this._renderExpensesList(); });

        // Pagination
        $('#prev-page').addEventListener('click', () => {
            if (this.currentPage > 1) { this.currentPage--; this._renderExpensesList(); }
        });
        $('#next-page').addEventListener('click', () => {
            this.currentPage++; this._renderExpensesList();
        });

        // Trend period
        $$('.period-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.period-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.trendPeriod = btn.dataset.period;
                this._renderTrendChart();
            });
        });

        // Reports
        const now = new Date();
        $('#report-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        $('#generate-report-btn').addEventListener('click', () => this._generateReport());
        $('#download-csv-btn').addEventListener('click', () => this._downloadReport());

        // CSV Import
        $('#import-csv-btn').addEventListener('click', () => this._openImportModal());
        $('#import-modal-close').addEventListener('click', () => this._closeImportModal());
        $('#import-cancel').addEventListener('click', () => this._closeImportModal());
        this.els.importModalOverlay.addEventListener('click', (e) => {
            if (e.target === this.els.importModalOverlay) this._closeImportModal();
        });
        $('#csv-file-input').addEventListener('change', (e) => this._handleCSVFile(e.target.files[0]));
        $('#import-clear').addEventListener('click', () => this._clearCSVFile());
        $('#import-submit').addEventListener('click', () => this._submitCSVImport());

        // Drag and drop
        const dropzone = $('#import-dropzone');
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files.length) this._handleCSVFile(e.dataTransfer.files[0]);
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this._closeModal();
                this._closeDeleteModal();
                this._closeImportModal();
                this._closeMobileMenu();
            }
        });

        // Resize handler for charts
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this._renderCharts(), 200);
        });
    }

    // ---- Navigation ----
    _switchView(view) {
        this.currentView = view;
        $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
        $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
        this._closeMobileMenu();

        if (view === 'expenses') this._renderExpensesList();
        if (view === 'analytics') this._renderAnalytics();
        if (view === 'dashboard') this._renderDashboard();
    }

    _toggleMobileMenu() {
        this.els.sidebar.classList.toggle('open');
        let backdrop = document.querySelector('.sidebar-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'sidebar-backdrop';
            document.body.appendChild(backdrop);
            backdrop.addEventListener('click', () => this._closeMobileMenu());
        }
        backdrop.classList.toggle('open', this.els.sidebar.classList.contains('open'));
    }

    _closeMobileMenu() {
        this.els.sidebar.classList.remove('open');
        const backdrop = document.querySelector('.sidebar-backdrop');
        if (backdrop) backdrop.classList.remove('open');
    }

    // ---- Greeting ----
    _updateGreeting() {
        const hour = new Date().getHours();
        let greeting;
        if (hour < 12) greeting = 'Good morning';
        else if (hour < 17) greeting = 'Good afternoon';
        else greeting = 'Good evening';
        const name = this.auth.user ? `, ${this.auth.user.username}` : '';
        $('#dashboard-greeting').textContent = `${greeting}${name}! Here's your spending overview.`;
    }

    // ---- Modal ----
    async _openModal(id = null) {
        this.editingId = id;
        const modal = this.els.modalOverlay;

        if (id) {
            try {
                const e = await this.store.getById(id);
                $('#modal-title').textContent = 'Edit Expense';
                $('#modal-submit').textContent = 'Save Changes';
                $('#expense-id').value = e.id;
                $('#expense-title').value = e.title;
                $('#expense-amount').value = e.amount;
                $('#expense-date').value = e.date;
                $('#expense-notes').value = e.notes || '';
                const catId = e.category_detail ? e.category_detail.id : null;
                this._selectCategory(catId);
            } catch (err) {
                this._showToast('Failed to load expense', 'error');
                return;
            }
        } else {
            $('#modal-title').textContent = 'Add Expense';
            $('#modal-submit').textContent = 'Add Expense';
            this.els.expenseForm.reset();
            $('#expense-date').value = new Date().toISOString().split('T')[0];
            this._selectCategory(null);
        }

        modal.classList.add('open');
        setTimeout(() => $('#expense-title').focus(), 100);
    }

    _closeModal() {
        this.els.modalOverlay.classList.remove('open');
        this.editingId = null;
    }

    _openDeleteModal(id, title) {
        this.deletingId = id;
        $('#delete-expense-name').textContent = title;
        this.els.deleteModalOverlay.classList.add('open');
    }

    _closeDeleteModal() {
        this.els.deleteModalOverlay.classList.remove('open');
        this.deletingId = null;
    }

    async _confirmDelete() {
        if (!this.deletingId) return;
        try {
            await this.store.delete(this.deletingId);
            this._closeDeleteModal();
            this._showToast('Expense deleted', 'success');
            this.refresh();
        } catch (err) {
            this._showToast('Failed to delete expense', 'error');
        }
    }

    // ---- Category Selection (Dynamic) ----
    _initCategoryGrid() {
        const grid = $('#category-grid');
        const cats = this._getCategories();
        grid.innerHTML = cats.map(cat => `
            <button type="button" class="category-option" data-cat="${cat.id}">
                <span class="cat-emoji">${cat.emoji}</span>
                ${cat.name}
            </button>
        `).join('');

        grid.addEventListener('click', (e) => {
            const btn = e.target.closest('.category-option');
            if (btn) this._selectCategory(parseInt(btn.dataset.cat));
        });
    }

    _selectCategory(catId) {
        this.selectedCategory = catId;
        $$('.category-option').forEach(btn => {
            btn.classList.toggle('selected', parseInt(btn.dataset.cat) === catId);
        });
    }

    // ---- Filters Init ----
    _initFilters() {
        const sel = $('#filter-category');
        sel.innerHTML = '<option value="all">All Categories</option>';
        const cats = this._getCategories();
        cats.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = `${cat.emoji} ${cat.name}`;
            sel.appendChild(opt);
        });

        const now = new Date();
        $('#filter-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // ---- Save Expense ----
    async _saveExpense() {
        const title = $('#expense-title').value.trim();
        const amount = parseFloat($('#expense-amount').value);
        const date = $('#expense-date').value;
        const notes = $('#expense-notes').value.trim();
        const category_id = this.selectedCategory;

        if (!title || !amount || !date || !category_id) {
            this._showToast('Please fill all required fields and select a category', 'error');
            return;
        }

        try {
            if (this.editingId) {
                await this.store.update(this.editingId, { title, amount, date, notes, category_id });
                this._showToast('Expense updated!', 'success');
            } else {
                await this.store.add({ title, amount, date, notes, category_id });
                this._showToast('Expense added!', 'success');
            }

            this._closeModal();
            this.refresh();
        } catch (err) {
            this._showToast('Failed to save expense: ' + err.message, 'error');
        }
    }

    // ---- Toast ----
    _showToast(message, type = 'info') {
        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span class="toast-icon">${icons[type]}</span>${message}`;
        this.els.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 3000);
    }

    // ---- Refresh All ----
    async refresh() {
        this._summaryCache = null;
        this._analyticsCache = null;
        await this._renderDashboard();
    }

    // ---- Dashboard ----
    async _renderDashboard() {
        try {
            if (!this._summaryCache) {
                this._summaryCache = await this.store.getSummary();
            }
            const data = this._summaryCache;

            // Summary cards
            $('#total-spent').textContent = fmt(data.total_spent);
            $('#today-spent').textContent = fmt(data.today_spent);
            $('#today-count').textContent = `${data.today_count} transaction${data.today_count !== 1 ? 's' : ''}`;
            $('#avg-spent').textContent = fmt(Math.round(data.avg_per_day));

            // Top category
            if (data.top_category) {
                $('#top-category').textContent = `${data.top_category.emoji} ${data.top_category.name}`;
                $('#top-category-amount').textContent = fmt(data.top_category.total);
            } else {
                $('#top-category').textContent = '—';
                $('#top-category-amount').textContent = 'No data yet';
            }

            // Budget
            const remaining = Math.max(0, data.budget - data.total_spent);
            const pct = Math.min(100, (data.total_spent / data.budget) * 100);
            $('#sidebar-budget').textContent = fmt(data.budget);
            $('#sidebar-budget-remaining').textContent = `${fmt(remaining)} remaining`;
            const fill = $('#sidebar-budget-fill');
            fill.style.width = pct + '%';
            if (pct > 90) fill.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
            else if (pct > 70) fill.style.background = 'linear-gradient(135deg, #f59e0b, #f97316)';
            else fill.style.background = 'var(--gradient-1)';

            // Recent transactions
            this._renderRecentTransactions(data.recent);

            // Charts
            setTimeout(() => this._renderCharts(), 50);
        } catch (err) {
            console.error('Dashboard error:', err);
            if (err.message.includes('401')) {
                this._handleLogout();
                return;
            }
            this._showToast('Failed to load dashboard data', 'error');
        }
    }

    _renderRecentTransactions(recent) {
        const container = $('#recent-transactions');

        if (!recent || recent.length === 0) {
            container.innerHTML = '<p style="padding:24px;text-align:center;color:var(--text-muted);">No transactions yet</p>';
            return;
        }

        container.innerHTML = recent.map((e, i) => this._transactionHTML(e, i)).join('');
        this._bindTransactionActions(container);
    }

    _transactionHTML(e, idx) {
        const cat = e.category_detail || { name: 'Other', emoji: '📦', color: '#64748b' };
        return `
            <div class="transaction-item" style="animation-delay:${idx * 0.05}s" data-id="${e.id}" data-title="${e.title}">
                <div class="transaction-icon" style="background:${cat.color}20;color:${cat.color}">
                    ${cat.emoji}
                </div>
                <div class="transaction-details">
                    <div class="transaction-title">${e.title}</div>
                    <div class="transaction-meta">
                        <span>${cat.name}</span>
                        <span>•</span>
                        <span>${toDateStr(e.date)}</span>
                    </div>
                </div>
                <div class="transaction-amount">-${fmt(e.amount)}</div>
                <div class="transaction-actions">
                    <button class="action-btn edit" title="Edit">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="action-btn delete" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    _bindTransactionActions(container) {
        container.querySelectorAll('.action-btn.edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const item = e.target.closest('.transaction-item');
                this._openModal(item.dataset.id);
            });
        });
        container.querySelectorAll('.action-btn.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const item = e.target.closest('.transaction-item');
                this._openDeleteModal(item.dataset.id, item.dataset.title);
            });
        });
    }

    // ---- Charts ----
    _renderCharts() {
        this._renderTrendChart();
        this._renderCategoryChart();
    }

    _renderTrendChart() {
        const canvas = $('#trend-chart');
        if (!canvas || !this._summaryCache) return;

        const data = this.trendPeriod === 'week'
            ? (this._summaryCache.week_trend || []).map(d => ({ ...d, color: '#8b5cf6' }))
            : (this._summaryCache.month_trend || []).map(d => ({ ...d, color: '#8b5cf6' }));

        ChartRenderer.drawBarChart(canvas, data);
    }

    _renderCategoryChart() {
        const canvas = $('#category-chart');
        if (!canvas || !this._summaryCache) return;

        const breakdown = this._summaryCache.category_breakdown || [];
        const data = breakdown.map(c => ({
            label: c.name || 'Other',
            value: c.total,
            color: c.color || '#64748b',
            emoji: c.emoji || '📦',
        }));

        ChartRenderer.drawDonutChart(canvas, data);

        const total = data.reduce((s, d) => s + d.value, 0);
        $('#donut-total').textContent = fmt(total);

        const legend = $('#category-legend');
        legend.innerHTML = data.map(d => `
            <div class="legend-item">
                <span class="legend-dot" style="background:${d.color}"></span>
                ${d.emoji} ${d.label}
            </div>
        `).join('');
    }

    // ---- Expenses List (Paginated) ----
    async _renderExpensesList() {
        const search = ($('#search-input')?.value || '').trim();
        const catFilter = $('#filter-category')?.value || 'all';
        const monthFilter = $('#filter-month')?.value || '';
        const sortBy = $('#sort-by')?.value || 'date-desc';

        try {
            const response = await this.store.getAll({
                search,
                category: catFilter,
                month: monthFilter,
                sort: sortBy,
                page: this.currentPage,
            });

            // Handle paginated response
            const expenses = response.results || response;
            const hasNext = response.next;
            const hasPrev = response.previous;
            const total = response.count || expenses.length;

            const list = $('#expenses-list');
            const empty = $('#expenses-empty');
            const pagination = $('#pagination-controls');

            if (expenses.length === 0) {
                list.innerHTML = '';
                empty.style.display = 'block';
                pagination.style.display = 'none';
            } else {
                empty.style.display = 'none';
                list.innerHTML = expenses.map((e, i) => this._transactionHTML(e, i)).join('');
                this._bindTransactionActions(list);

                // Pagination
                if (response.count !== undefined) {
                    pagination.style.display = 'flex';
                    $('#prev-page').disabled = !hasPrev;
                    $('#next-page').disabled = !hasNext;
                    const pageSize = expenses.length;
                    const totalPages = Math.ceil(total / pageSize);
                    $('#page-info').textContent = `Page ${this.currentPage} of ${totalPages}`;
                } else {
                    pagination.style.display = 'none';
                }
            }
        } catch (err) {
            console.error('Expenses list error:', err);
            if (err.message.includes('401')) {
                this._handleLogout();
                return;
            }
        }
    }

    // ---- Analytics ----
    async _renderAnalytics() {
        try {
            if (!this._analyticsCache) {
                this._analyticsCache = await this.store.getAnalytics();
            }
            const data = this._analyticsCache;
            this._renderMonthlyComparison(data.monthly_comparison || []);
            this._renderCategoryBreakdown(data.category_breakdown || []);
            this._renderTopExpenses(data.top_expenses || []);
        } catch (err) {
            console.error('Analytics error:', err);
        }
    }

    _renderMonthlyComparison(monthlyData) {
        const canvas = $('#monthly-chart');
        if (!canvas) return;
        setTimeout(() => ChartRenderer.drawMonthlyChart(canvas, monthlyData), 50);
    }

    _renderCategoryBreakdown(catData) {
        const container = $('#category-bars');
        if (!container) return;

        const maxVal = Math.max(...catData.map(c => c.total), 1);

        container.innerHTML = catData.map(c => {
            const pct = (c.total / maxVal) * 100;
            return `
                <div class="cat-bar-row">
                    <div class="cat-bar-label">
                        <span>${c.emoji || '📦'} ${c.name || 'Other'}</span>
                        <span class="cat-bar-value">${fmt(c.total)}</span>
                    </div>
                    <div class="cat-bar-track">
                        <div class="cat-bar-fill" style="width:${pct}%;background:${c.color || '#64748b'}"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    _renderTopExpenses(topData) {
        const container = $('#top-expenses-list');
        if (!container) return;

        container.innerHTML = topData.map((e, i) => {
            const cat = e.category_detail || { name: 'Other', emoji: '📦', color: '#64748b' };
            return `
                <div class="top-expense-item">
                    <span class="top-rank">#${i + 1}</span>
                    <span class="top-emoji">${cat.emoji}</span>
                    <div class="top-info">
                        <div class="top-name">${e.title}</div>
                        <div class="top-cat">${cat.name} • ${toDateStr(e.date)}</div>
                    </div>
                    <span class="top-amount">${fmt(e.amount)}</span>
                </div>
            `;
        }).join('');
    }

    // ---- Reports ----
    async _generateReport() {
        const month = $('#report-month').value;
        if (!month) {
            this._showToast('Please select a month', 'error');
            return;
        }

        try {
            const report = await this.store.getMonthlyReport(month);
            // Show report content
            $('#report-content').style.display = 'block';
            $('#report-total').textContent = fmt(report.total);
            $('#report-count').textContent = report.count;

            // Category breakdown
            const maxVal = Math.max(...report.category_breakdown.map(c => c.total), 1);
            $('#report-category-bars').innerHTML = report.category_breakdown.map(c => {
                const pct = (c.total / maxVal) * 100;
                return `
                    <div class="cat-bar-row">
                        <div class="cat-bar-label">
                            <span>${c.emoji || '📦'} ${c.name || 'Other'}</span>
                            <span class="cat-bar-value">${fmt(c.total)}</span>
                        </div>
                        <div class="cat-bar-track">
                            <div class="cat-bar-fill" style="width:${pct}%;background:${c.color || '#64748b'}"></div>
                        </div>
                    </div>
                `;
            }).join('');

            // Expenses list
            const expList = $('#report-expenses-list');
            expList.innerHTML = report.expenses.map((e, i) => this._transactionHTML(e, i)).join('');
            this._bindTransactionActions(expList);

            this._showToast('Report generated successfully', 'success');
        } catch (err) {
            this._showToast('Failed to generate report', 'error');
        }
    }

    async _downloadReport() {
        const month = $('#report-month').value;
        if (!month) {
            this._showToast('Please select a month', 'error');
            return;
        }
        try {
            await this.store.downloadReport(month);
            this._showToast('Report downloaded', 'success');
        } catch (err) {
            this._showToast('Failed to download report', 'error');
        }
    }

    // ---- CSV Import ----
    _openImportModal() {
        this.csvFile = null;
        $('#import-preview').style.display = 'none';
        $('#import-result').style.display = 'none';
        $('#import-dropzone').style.display = 'flex';
        $('#import-submit').disabled = true;
        $('#csv-file-input').value = '';
        this.els.importModalOverlay.classList.add('open');
    }

    _closeImportModal() {
        this.els.importModalOverlay.classList.remove('open');
        this.csvFile = null;
    }

    _handleCSVFile(file) {
        if (!file) return;
        if (!file.name.endsWith('.csv')) {
            this._showToast('Please select a CSV file', 'error');
            return;
        }
        this.csvFile = file;
        $('#import-file-name').textContent = file.name;
        $('#import-dropzone').style.display = 'none';
        $('#import-preview').style.display = 'block';
        $('#import-submit').disabled = false;

        // Read and preview first few rows
        const reader = new FileReader();
        reader.onload = (e) => {
            const lines = e.target.result.split('\n').slice(0, 6);
            const table = document.createElement('table');
            table.className = 'preview-table';
            lines.forEach((line, i) => {
                if (!line.trim()) return;
                const row = table.insertRow();
                const cols = line.split(',');
                cols.forEach(col => {
                    const cell = i === 0 ? document.createElement('th') : row.insertCell();
                    if (i === 0) row.appendChild(cell);
                    cell.textContent = col.trim().replace(/^"|"$/g, '');
                });
            });
            $('#import-preview-table').innerHTML = '';
            $('#import-preview-table').appendChild(table);
        };
        reader.readAsText(file);
    }

    _clearCSVFile() {
        this.csvFile = null;
        $('#import-preview').style.display = 'none';
        $('#import-dropzone').style.display = 'flex';
        $('#import-submit').disabled = true;
        $('#csv-file-input').value = '';
    }

    async _submitCSVImport() {
        if (!this.csvFile) return;
        const btn = $('#import-submit');
        btn.disabled = true;
        btn.textContent = 'Importing...';

        try {
            const result = await this.store.importCSV(this.csvFile);
            const resultDiv = $('#import-result');
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `
                <div class="import-success">
                    <strong>✅ ${result.created} expenses imported successfully!</strong>
                    ${result.errors.length > 0 ? `
                        <div class="import-errors">
                            <strong>⚠️ ${result.errors.length} errors:</strong>
                            <ul>${result.errors.map(e => `<li>${e}</li>`).join('')}</ul>
                        </div>
                    ` : ''}
                </div>
            `;
            this._showToast(`${result.created} expenses imported!`, 'success');
            this.refresh();
        } catch (err) {
            this._showToast('Import failed: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Import';
        }
    }
}

// ---- Bootstrap ----
document.addEventListener('DOMContentLoaded', () => {
    new ExpenseFlowApp();
});
