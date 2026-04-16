/* ================= CONTENT STUDIO MODULE ENTRY ================= */

const App = {
    currentView: 'view',

    init: async function() {
        const root = document.getElementById('content-studio-app');
        if (!root) return;

        root.innerHTML = `
            <div class="cs-card" style="text-align:center; padding:46px;">
                <i class="fas fa-circle-notch fa-spin fa-2x"></i>
                <p style="margin-top:14px;">Loading Content Creator...</p>
            </div>
        `;

        await DataService.loadInitialData();
        this.render();
    },

    canBuild: function() {
        const role = AppContext && AppContext.user ? AppContext.user.role : '';
        return role === 'admin' || role === 'super_admin';
    },

    canViewEngagement: function() {
        const role = AppContext && AppContext.user ? AppContext.user.role : '';
        return role === 'admin' || role === 'super_admin';
    },

    canAccessModule: function() {
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
        const root = document.getElementById('content-studio-app');
        if (!root) return;

        if (!this.canAccessModule()) {
            root.innerHTML = `
                <div class="cs-empty">
                    <h3>Access Denied</h3>
                    <p>Content Creator is restricted to Admin and Super Admin sessions.</p>
                </div>
            `;
            return;
        }

        if (!['view', 'builder', 'engagement'].includes(this.currentView)) {
            this.currentView = 'view';
        }
        if (this.currentView === 'engagement' && !this.canViewEngagement()) {
            this.currentView = 'view';
        }

        let viewHtml = '';
        if (this.currentView === 'builder') {
            viewHtml = this.canBuild()
                ? BuilderUI.render()
                : `<div class="cs-empty"><h3>Builder Restricted</h3><p>Builder is available to Admin and Super Admin sessions.</p></div>`;
        } else if (this.currentView === 'engagement') {
            viewHtml = this.canViewEngagement()
                ? EngagementUI.render()
                : `<div class="cs-empty"><h3>Engagement Restricted</h3><p>Engagement is available to Admin and Super Admin sessions.</p></div>`;
        } else {
            viewHtml = ViewUI.render();
        }

        root.innerHTML = `
            <div class="cs-shell-root">
                <div class="cs-subnav">
                    <div class="cs-subnav-left">
                        <button class="sub-tab-btn ${this.currentView === 'view' ? 'active' : ''}" onclick="App.setView('view')">
                            <i class="fas fa-eye"></i> View
                        </button>
                        <button class="sub-tab-btn ${this.currentView === 'builder' ? 'active' : ''}" onclick="App.setView('builder')">
                            <i class="fas fa-screwdriver-wrench"></i> Builder
                        </button>
                        ${this.canViewEngagement() ? `
                            <button class="sub-tab-btn ${this.currentView === 'engagement' ? 'active' : ''}" onclick="App.setView('engagement')">
                                <i class="fas fa-chart-line"></i> Engagement
                            </button>
                        ` : ''}
                    </div>
                    <div>
                        <button class="btn-secondary btn-sm" onclick="App.refresh()"><i class="fas fa-rotate-right"></i> Refresh</button>
                    </div>
                </div>
                ${viewHtml}
            </div>
        `;
    }
};

window.App = App;
window.onload = () => App.init();
