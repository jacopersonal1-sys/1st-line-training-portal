/* ================= OPL HUB MODULE ENTRY ================= */

const App = {
    currentView: 'opl_search',

    init: async function() {
        const root = document.getElementById('opl-app');
        if (!root) return;

        root.innerHTML = `
            <div class="opl-card" style="text-align:center; padding:46px;">
                <i class="fas fa-circle-notch fa-spin fa-2x"></i>
                <p style="margin-top:14px;">Loading OPL Hub...</p>
            </div>
        `;

        await DataService.loadInitialData();
        this.render();
    },

    isAllowed: function() {
        const role = AppContext && AppContext.user ? AppContext.user.role : '';
        return role === 'admin' || role === 'super_admin';
    },

    setView: function(view) {
        this.currentView = view;
        this.render();
    },

    refresh: async function() {
        await DataService.loadInitialData();
        this.render();
    },

    escapeHtml: function(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    render: function() {
        const root = document.getElementById('opl-app');
        if (!root) return;

        if (!this.isAllowed()) {
            root.innerHTML = `
                <div class="opl-card" style="max-width:760px; margin:28px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252;">Access Restricted</h3>
                    <p class="opl-muted">OPL Hub is available to Admin and Super Admin users only.</p>
                </div>
            `;
            return;
        }

        const contentHtml = this.currentView === 'opl_search'
            ? SearchUI.render()
            : BackendUI.render();

        root.innerHTML = `
            <div class="opl-shell">
                <div class="opl-subnav">
                    <div class="opl-subnav-left">
                        <button class="sub-tab-btn ${this.currentView === 'opl_search' ? 'active' : ''}" onclick="App.setView('opl_search')">
                            <i class="fas fa-magnifying-glass"></i> OPL Search
                        </button>
                        <button class="sub-tab-btn ${this.currentView === 'backend_data' ? 'active' : ''}" onclick="App.setView('backend_data')">
                            <i class="fas fa-database"></i> Backend Data
                        </button>
                    </div>
                    <div>
                        <button class="btn-secondary btn-sm" onclick="App.refresh()"><i class="fas fa-rotate-right"></i> Refresh</button>
                    </div>
                </div>
                ${contentHtml}
            </div>
        `;
    }
};

window.App = App;
window.onload = () => App.init();
