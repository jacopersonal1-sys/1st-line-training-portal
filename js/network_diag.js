/* ================= NETWORK DIAGNOSTICS ================= */
/* Real-time Gateway/Internet/Server monitoring and analysis */

window.NetworkDiag = {
    isRunning: false,
    interval: null,
    reportInterval: null,
    dashboardInterval: null,
    popoutInterval: null,
    popoutWindow: null,
    oneHourMs: 60 * 60 * 1000,
    consoleLimit: 80,
    history: { gateway: [], internet: [], server: [], dbQuery: [] },
    lastResults: {
        gateway: null,
        internet: null,
        server: null,
        dbQuery: null
    },
    config: {
        gateway: '8.8.8.8', // Fallback if local gateway not detected (usually user router)
        internet: '1.1.1.1',
        server: 'google.com' // Will be replaced by actual Supabase URL host
    },
    stats: { cpu: 0, ram: 0, connType: 'Unknown' },
    publicIP: 'Loading...',
    dbProbe: {
        timeoutMs: 3500,
        attempts: 2,
        intervalMs: 10000,
        lastRunAt: 0,
        inFlight: null,
        healthTableAvailable: null,
        lastError: '',
        lastStage: 'waiting'
    },

    init: function() {
        this.installConsoleCapture();

        if (!document.getElementById('net-diag-styles')) {
            const style = document.createElement('style');
            style.id = 'net-diag-styles';
            style.innerHTML = `
                .net-metric-box { background: var(--bg-input); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); text-align: center; min-width:0; }
                .net-val { font-size: 1.5rem; font-weight: bold; margin: 5px 0; font-family: monospace; white-space:nowrap; }
                .net-label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; }
                .net-status { font-size: 0.8rem; font-weight: bold; padding: 2px 6px; border-radius: 4px; display:inline-block; }
                .status-good { color: #2ecc71; background: rgba(46, 204, 113, 0.1); }
                .status-warn { color: #f1c40f; background: rgba(241, 196, 15, 0.1); }
                .status-bad { color: #ff5252; background: rgba(255, 82, 82, 0.1); }
                .net-diag-grid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:15px; margin-bottom:20px; }
                .net-health-card { background: var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:14px; margin-bottom:20px; }
                .net-card-title { margin:0 0 10px; display:flex; align-items:center; gap:8px; }
                .net-history-wrap { height:170px; background: var(--bg-input); border:1px solid var(--border-color); border-radius:6px; padding:10px; }
                .net-history-legend { display:flex; gap:14px; flex-wrap:wrap; font-size:0.78rem; color:var(--text-muted); margin-top:8px; }
                .net-legend-dot { width:9px; height:9px; border-radius:50%; display:inline-block; margin-right:5px; }
                .net-flow { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:10px; align-items:stretch; }
                .net-flow-step { background:var(--bg-input); border:1px solid var(--border-color); border-radius:6px; padding:10px; min-height:76px; }
                .net-flow-step strong { display:block; font-size:0.9rem; margin-bottom:4px; }
                .net-flow-step span { font-size:0.8rem; color:var(--text-muted); overflow-wrap:anywhere; }
                .net-agent-row { display:grid; grid-template-columns: 1.2fr 0.8fr 1fr 1fr 1fr; gap:10px; padding:8px 10px; border-bottom:1px solid var(--border-color); align-items:center; font-size:0.86rem; }
                .net-agent-row:last-child { border-bottom:none; }
                .net-agent-head { color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; font-weight:bold; }
                .net-pill { display:inline-flex; align-items:center; gap:5px; padding:3px 7px; border-radius:999px; border:1px solid var(--border-color); background:var(--bg-input); font-size:0.78rem; white-space:nowrap; }
                .net-toolbar { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
                .net-toolbar-actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
                .net-agent-select { background:var(--bg-input); color:var(--text-main); border:1px solid var(--border-color); border-radius:6px; padding:7px 9px; min-width:230px; }
                .net-filter-group { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
                .net-filter-group label { display:inline-flex; align-items:center; gap:5px; padding:5px 8px; border:1px solid var(--border-color); border-radius:999px; background:var(--bg-input); color:var(--text-main); font-size:0.78rem; cursor:pointer; }
                .net-filter-group input { margin:0; }
                .net-console-view { margin-top:10px; border-top:1px dashed var(--border-color); padding-top:10px; }
                .net-console-head { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; }
                .net-console-list { max-height:160px; overflow:auto; background:rgba(0,0,0,0.16); border:1px solid var(--border-color); border-radius:6px; }
                .net-console-row { display:grid; grid-template-columns:72px 70px 1fr; gap:8px; padding:6px 8px; border-bottom:1px solid var(--border-color); font-size:0.78rem; align-items:start; }
                .net-console-row:last-child { border-bottom:none; }
                .net-console-level-error { color:#ff5252; font-weight:bold; }
                .net-console-level-warn { color:#f1c40f; font-weight:bold; }
                .net-console-msg { white-space:pre-wrap; overflow-wrap:anywhere; color:var(--text-main); }
                @media (max-width: 760px) {
                    .net-diag-grid, .net-flow { grid-template-columns:1fr; }
                    .net-agent-row { grid-template-columns:1fr; gap:4px; }
                    .net-agent-head { display:none; }
                    .net-console-row { grid-template-columns:1fr; gap:3px; }
                }
            `;
            document.head.appendChild(style);
        }

        if (window.CLOUD_CREDENTIALS && window.CLOUD_CREDENTIALS.url) {
            try {
                const url = new URL(window.CLOUD_CREDENTIALS.url);
                this.config.server = url.hostname;
            } catch(e) {}
        }

        const btn = document.getElementById('btn-sidebar-net-test');
        if (btn) btn.onclick = () => this.openModal();
    },

    openModal: function() {
        const user = window.CURRENT_USER || JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        const isAdmin = this.isAdminUser(user);
        const existing = document.getElementById('netDiagModal');
        if (existing) existing.remove();

        const modalHtml = `
            <div id="netDiagModal" class="modal-overlay" style="z-index: 10005;">
                <div class="modal-box" style="width: 1040px; max-width: 96%; max-height:92vh; overflow:auto;">
                    <div class="net-toolbar" style="margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                        <h3 style="margin:0;"><i class="fas fa-network-wired" style="color:var(--primary);"></i> Network Diagnostics</h3>
                        <div class="net-toolbar-actions">
                            ${isAdmin ? `<button class="btn-secondary btn-sm" onclick="NetworkDiag.openPopout()" title="Open diagnostics on a second screen"><i class="fas fa-up-right-from-square"></i> Pop Out</button>` : ''}
                            <button class="btn-secondary" onclick="NetworkDiag.closeModal()">&times;</button>
                        </div>
                    </div>

                    <div class="net-diag-grid">
                        <div class="net-metric-box">
                            <div class="net-label">Gateway</div>
                            <div id="nd_gate_val" class="net-val">--</div>
                            <span id="nd_gate_stat" class="net-status">Waiting...</span>
                        </div>
                        <div class="net-metric-box">
                            <div class="net-label">Internet (1.1.1.1)</div>
                            <div id="nd_net_val" class="net-val">--</div>
                            <span id="nd_net_stat" class="net-status">Waiting...</span>
                        </div>
                        <div class="net-metric-box">
                            <div class="net-label">DB Server</div>
                            <div id="nd_srv_val" class="net-val">--</div>
                            <span id="nd_srv_stat" class="net-status">Waiting...</span>
                        </div>
                    </div>

                    <div class="net-health-card">
                        <h4 class="net-card-title"><i class="fas fa-chart-line" style="color:var(--primary);"></i> Latency History <span style="font-size:0.78rem; color:var(--text-muted); font-weight:normal;">Last hour</span></h4>
                        <div class="net-history-wrap"><canvas id="nd_latency_canvas" width="960" height="150" style="width:100%; height:150px;"></canvas></div>
                        <div class="net-history-legend">
                            <span><i class="net-legend-dot" style="background:#5DB2FF;"></i>Gateway</span>
                            <span><i class="net-legend-dot" style="background:#2ecc71;"></i>Internet</span>
                            <span><i class="net-legend-dot" style="background:#f1c40f;"></i>DB Server IP</span>
                            <span><i class="net-legend-dot" style="background:#ff6bcb;"></i>DB Data Query</span>
                        </div>
                    </div>

                    <div class="net-health-card">
                        <h4 style="margin-top:0;">Analysis & System Health</h4>
                        <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; font-size: 0.9rem; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed var(--border-color);">
                            <span><strong>Connection:</strong> <span id="nd_conn_type">Detecting...</span></span>
                            <span><strong>Public IP:</strong> <span id="nd_pub_ip">Loading...</span></span>
                            <span><strong>CPU:</strong> <span id="nd_cpu">0%</span></span>
                            <span><strong>RAM:</strong> <span id="nd_ram">0/0 GB</span></span>
                            <span><strong>Disk:</strong> <span id="nd_disk">--</span></span>
                        </div>
                        <div id="nd_analysis" style="padding: 10px; background: var(--bg-input); border-radius: 4px; min-height: 60px; color: var(--text-muted);">
                            Initializing tests...
                        </div>
                        ${isAdmin ? `
                        <div id="nd_console_view" class="net-console-view">
                            <div class="net-console-head">
                                <strong style="font-size:0.86rem;"><i class="fas fa-terminal" style="color:var(--primary);"></i> Console Errors</strong>
                                <button class="btn-secondary btn-sm" onclick="NetworkDiag.clearConsoleCapture()"><i class="fas fa-trash"></i> Clear</button>
                            </div>
                            <div id="nd_console_list" class="net-console-list"></div>
                        </div>` : ''}
                    </div>

                    <div class="net-health-card">
                        <h4 class="net-card-title"><i class="fas fa-route" style="color:var(--primary);"></i> Client To Server Path</h4>
                        <div id="nd_flow" class="net-flow"></div>
                    </div>

                    ${isAdmin ? `
                    <div class="net-health-card">
                        <div class="net-toolbar" style="margin-bottom:10px;">
                            <h4 class="net-card-title" style="margin:0;"><i class="fas fa-users-viewfinder" style="color:var(--primary);"></i> Agent App Status</h4>
                            <select id="nd_agent_select" class="net-agent-select" onchange="NetworkDiag.renderAgentStatus()"></select>
                            <div id="nd_status_filters" class="net-filter-group" title="Show agents matching any selected status">
                                <label><input type="checkbox" value="online" checked onchange="NetworkDiag.renderAgentStatus()"> Online</label>
                                <label><input type="checkbox" value="idle" checked onchange="NetworkDiag.renderAgentStatus()"> Idle</label>
                                <label><input type="checkbox" value="offline" checked onchange="NetworkDiag.renderAgentStatus()"> Offline</label>
                                <label><input type="checkbox" value="stale_report" checked onchange="NetworkDiag.renderAgentStatus()"> Stale report</label>
                            </div>
                        </div>
                        <div id="nd_agent_detail" style="margin-bottom:10px;"></div>
                        <div id="nd_agent_table" style="border:1px solid var(--border-color); border-radius:6px; overflow:hidden;"></div>
                    </div>` : ''}

                    <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-color); padding-top:15px; margin-top:15px; gap:10px; flex-wrap:wrap;">
                        <div style="font-size: 0.8rem; color: var(--text-muted);">* Reports sent to server every 10 mins. Live graph keeps roughly 1 hour while this test is open.</div>
                        <div style="display:flex; gap:10px; flex-wrap:wrap;">
                            ${isAdmin ? `<button class="btn-secondary" onclick="NetworkDiag.openAdminView()"><i class="fas fa-history"></i> View History</button>` : ''}
                            <button class="btn-danger" onclick="NetworkDiag.closeAll()">Stop & Close</button>
                        </div>
                    </div>
                </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.populateAgentDropdown();
        this.renderAgentStatus();
        this.startTests();
        this.startDashboardRefresh();
    },

    closeModal: function() {
        this.stopDashboardRefresh();
        if (!this.popoutWindow || this.popoutWindow.closed) this.stopTests();
        const el = document.getElementById('netDiagModal');
        if (el) el.remove();
    },

    closeAll: function() {
        this.stopTests();
        this.stopDashboardRefresh();
        if (this.popoutInterval) clearInterval(this.popoutInterval);
        this.popoutInterval = null;
        if (this.popoutWindow && !this.popoutWindow.closed) {
            try { this.popoutWindow.close(); } catch (error) {}
        }
        this.popoutWindow = null;
        const el = document.getElementById('netDiagModal');
        if (el) el.remove();
    },

    startTests: async function() {
        this.isRunning = true;
        this.history = { gateway: [], internet: [], server: [], dbQuery: [] };
        this.lastResults = { gateway: null, internet: null, server: null, dbQuery: null };

        try {
            const res = await fetch('https://api.ipify.org?format=json');
            const data = await res.json();
            this.publicIP = data.ip;
            const ipEl = document.getElementById('nd_pub_ip');
            if(ipEl) ipEl.innerText = this.publicIP;
        } catch(e) {
            this.publicIP = 'Unknown';
            const ipEl = document.getElementById('nd_pub_ip');
            if(ipEl) ipEl.innerText = this.publicIP;
        }

        this.runLoop();
        this.interval = setInterval(() => this.runLoop(), 2000);
        this.reportInterval = setInterval(() => this.reportToCloud(), 600000);
    },

    stopTests: function() {
        this.isRunning = false;
        if (this.interval) clearInterval(this.interval);
        if (this.reportInterval) clearInterval(this.reportInterval);
        this.interval = null;
        this.reportInterval = null;
    },

    startDashboardRefresh: function() {
        if (this.dashboardInterval) clearInterval(this.dashboardInterval);
        this.dashboardInterval = setInterval(() => {
            this.renderFlow();
            this.renderAgentStatus();
            this.drawLatencyGraph();
        }, 5000);
    },

    stopDashboardRefresh: function() {
        if (this.dashboardInterval) clearInterval(this.dashboardInterval);
        this.dashboardInterval = null;
    },

    runLoop: async function() {
        const modal = document.getElementById('netDiagModal');
        const popoutActive = this.popoutWindow && !this.popoutWindow.closed;
        if (!this.isRunning || (!modal && !popoutActive)) {
            this.stopTests();
            return;
        }

        if (typeof require === 'undefined') return;
        const { ipcRenderer } = require('electron');

        try {
            const sys = await ipcRenderer.invoke('get-system-stats');
            this.stats = sys || this.stats;
            this.updateSystemStats();

            const [pGate, pNet, pSrv, pDb] = await Promise.all([
                ipcRenderer.invoke('perform-network-test', this.config.gateway),
                ipcRenderer.invoke('perform-network-test', this.config.internet),
                ipcRenderer.invoke('perform-network-test', this.config.server),
                this.maybeTestDbDataConnection()
            ]);

            this.updateMetric('gate', pGate);
            this.updateMetric('net', pNet);
            this.updateMetric('srv', pSrv);
            if (pDb) this.updateMetric('dbq', pDb);

            this.analyze();
            this.renderFlow();
            this.renderAgentStatus();
            this.renderConsoleView();
            this.drawLatencyGraph();
            this.refreshPopout();
        } catch (error) {
            console.warn('Network diagnostics loop failed:', error);
        }
    },

    updateSystemStats: function() {
        const cpuEl = document.getElementById('nd_cpu');
        const ramEl = document.getElementById('nd_ram');
        const diskEl = document.getElementById('nd_disk');
        const connTypeEl = document.getElementById('nd_conn_type');
        const ipEl = document.getElementById('nd_pub_ip');
        if (cpuEl) cpuEl.innerText = this.stats.cpu + '%';
        if (ramEl) ramEl.innerText = `${this.stats.ram} / ${this.stats.ramTotal} GB`;
        if (diskEl) diskEl.innerText = this.stats.disk || 'N/A';
        if (connTypeEl) connTypeEl.innerText = this.stats.connType || 'Unknown';
        if (ipEl) ipEl.innerText = this.publicIP || 'Unknown';
    },

    testDbDataConnection: async function() {
        if (!window.supabaseClient) return this.buildDbProbeFailure('client', 'No Supabase client');

        const totalStart = Date.now();
        let lastError = null;
        let lastStage = 'query';

        for (let attempt = 1; attempt <= this.dbProbe.attempts; attempt++) {
            try {
                const tableName = await this.getDbHealthProbeTable();
                const result = await this.withTimeout(
                    window.supabaseClient
                        .from(tableName)
                        .select(tableName === 'app_health' ? 'id' : 'key', { head: true })
                        .limit(1),
                    this.dbProbe.timeoutMs,
                    `DB query timed out after ${this.dbProbe.timeoutMs}ms`
                );

                if (result && result.error) {
                    lastStage = this.classifyDbErrorStage(result.error);
                    throw result.error;
                }

                this.dbProbe.lastError = '';
                this.dbProbe.lastStage = 'healthy';
                return {
                    success: true,
                    time: Date.now() - totalStart,
                    attempts: attempt,
                    stage: 'healthy',
                    output: ''
                };
            } catch (error) {
                lastError = error;
                lastStage = this.classifyDbErrorStage(error);
                if (attempt < this.dbProbe.attempts) await this.sleep(250 * attempt);
            }
        }

        return this.buildDbProbeFailure(lastStage, this.formatDbError(lastError), Date.now() - totalStart);
    },

    getDbHealthProbeTable: async function() {
        if (this.dbProbe.healthTableAvailable === true) return 'app_health';
        if (this.dbProbe.healthTableAvailable === false) return 'app_documents';

        try {
            const { error } = await this.withTimeout(
                window.supabaseClient.from('app_health').select('id', { head: true }).limit(1),
                1200,
                'Health table probe timed out'
            );
            if (error) throw error;
            this.dbProbe.healthTableAvailable = true;
            return 'app_health';
        } catch (error) {
            const msg = String(error && (error.message || error.code || error.details) || '').toLowerCase();
            if (msg.includes('app_health') || msg.includes('pgrst205') || msg.includes('does not exist') || msg.includes('schema cache')) {
                this.dbProbe.healthTableAvailable = false;
            }
            return 'app_documents';
        }
    },

    maybeTestDbDataConnection: async function() {
        const now = Date.now();
        if (this.dbProbe.inFlight) return this.dbProbe.inFlight;
        if (this.lastResults.dbQuery && now - (this.dbProbe.lastRunAt || 0) < this.dbProbe.intervalMs) return null;

        this.dbProbe.lastRunAt = now;
        this.dbProbe.inFlight = this.testDbDataConnection().finally(() => {
            this.dbProbe.inFlight = null;
        });
        return this.dbProbe.inFlight;
    },

    withTimeout: function(promise, timeoutMs, message) {
        let timeoutId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                const err = new Error(message || 'Operation timed out');
                err.name = 'TimeoutError';
                reject(err);
            }, timeoutMs);
        });

        return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
        });
    },

    sleep: function(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    buildDbProbeFailure: function(stage, message, elapsed = null) {
        this.dbProbe.lastStage = stage || 'query';
        this.dbProbe.lastError = message || 'DB query failed';
        return {
            success: false,
            time: elapsed,
            stage: this.dbProbe.lastStage,
            output: this.dbProbe.lastError
        };
    },

    classifyDbErrorStage: function(error) {
        const msg = String(error && (error.message || error.details || error.hint || error.name) || '').toLowerCase();
        if (msg.includes('timeout')) return 'timeout';
        if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')) return 'rest_api';
        if (msg.includes('jwt') || msg.includes('apikey') || msg.includes('unauthorized') || msg.includes('401') || msg.includes('403')) return 'auth';
        if (msg.includes('permission') || msg.includes('policy') || msg.includes('rls')) return 'policy';
        if (msg.includes('relation') || msg.includes('schema') || msg.includes('column')) return 'schema';
        if (msg.includes('503') || msg.includes('502') || msg.includes('521') || msg.includes('522')) return 'server';
        return 'query';
    },

    formatDbError: function(error) {
        if (!error) return 'DB query failed';
        return String(error.message || error.details || error.hint || error.name || error).slice(0, 180);
    },

    updateMetric: function(key, result) {
        const map = { gate: 'gateway', net: 'internet', srv: 'server', dbq: 'dbQuery' };
        const histKey = map[key];
        const hist = this.history[histKey];
        if (!hist) return;

        const sample = {
            t: Date.now(),
            v: result && result.success ? Math.round(result.time) : -1,
            success: !!(result && result.success),
            output: result && result.output ? result.output : '',
            stage: result && result.stage ? result.stage : '',
            attempts: result && result.attempts ? result.attempts : 1
        };
        hist.push(sample);
        this.pruneHistory(hist);
        this.lastResults[histKey] = sample;

        if (key === 'dbq') return;

        const valEl = document.getElementById(`nd_${key}_val`);
        const statEl = document.getElementById(`nd_${key}_stat`);
        if (!valEl || !statEl) return;

        if (!sample.success) {
            valEl.innerText = "TIMEOUT";
            valEl.style.color = "#ff5252";
            statEl.innerText = "Loss";
            statEl.className = "net-status status-bad";
            return;
        }

        const ms = sample.v;
        valEl.innerText = ms + " ms";
        if (key === 'gate') {
            if (ms <= 10) { statEl.innerText = "Excellent"; statEl.className = "net-status status-good"; valEl.style.color = "#2ecc71"; }
            else if (ms <= 50) { statEl.innerText = "Stable"; statEl.className = "net-status status-good"; valEl.style.color = "#2ecc71"; }
            else { statEl.innerText = "Fluctuating"; statEl.className = "net-status status-warn"; valEl.style.color = "#f1c40f"; }
        } else {
            if (ms <= 100) { statEl.innerText = "Good"; statEl.className = "net-status status-good"; valEl.style.color = "#2ecc71"; }
            else if (ms <= 250) { statEl.innerText = "Fair"; statEl.className = "net-status status-warn"; valEl.style.color = "#f1c40f"; }
            else { statEl.innerText = "Lag"; statEl.className = "net-status status-bad"; valEl.style.color = "#ff5252"; }
        }
    },

    pruneHistory: function(hist) {
        const cutoff = Date.now() - this.oneHourMs;
        while (hist.length && hist[0].t < cutoff) hist.shift();
    },

    analyze: function() {
        const el = document.getElementById('nd_analysis');
        if (!el) return;

        const avgGate = this.getAvg(this.history.gateway);
        const avgNet = this.getAvg(this.history.internet);
        const avgSrv = this.getAvg(this.history.server);
        const avgDb = this.getAvg(this.history.dbQuery);
        const lossGate = this.history.gateway.filter(x => x.v === -1).length;

        let msg = "";
        let color = "var(--text-main)";

        if (lossGate > 0 || avgGate > 50) {
            color = "#ff5252";
            msg = `<strong>LOCAL ISSUE DETECTED:</strong> High latency/loss to Gateway.<br>`;
            if (this.stats.connType === 'Wireless') msg += "Signal unstable. Suggest moving closer to router or switching to Ethernet cable.";
            else if (this.stats.connType === 'Ethernet') msg += "Possible faulty cable, switch port, or router congestion.";
            else msg += "Check local network hardware.";
        } else if ((avgNet === -1 || avgNet > 200) && avgGate <= 20) {
            color = "#f1c40f";
            msg = `<strong>INTERNET CONGESTION:</strong> Gateway is stable, but Internet is slow.<br>Possible ISP throttling or high bandwidth usage on network.`;
        } else if ((avgSrv === -1 || avgSrv > 500) && avgNet <= 100) {
            color = "#f1c40f";
            msg = `<strong>DATABASE SERVER IP ISSUE:</strong> Internet is fine, but the DB host is slow or unreachable.<br>This points to routing, DNS, firewall, or backend host reachability.`;
        } else if ((avgDb === -1 || avgDb > 1200) && avgSrv !== -1 && avgSrv <= 300) {
            color = "#ff5252";
            msg = `<strong>DATABASE DATA ISSUE:</strong> DB host responds, but the actual Supabase query is failing or slow.<br>This points more toward the Supabase container/API/database layer than the internet link.`;
        } else {
            color = "#2ecc71";
            msg = `<strong>NETWORK STABLE:</strong> Gateway, Internet, DB host, and DB data query are within normal operating ranges.`;
        }

        el.innerHTML = msg;
        el.style.borderLeft = `4px solid ${color}`;
        this.renderConsoleView();
    },

    getAvg: function(arr) {
        const valid = (arr || []).map(x => typeof x === 'number' ? x : x.v).filter(x => x !== -1 && Number.isFinite(x));
        if (valid.length === 0) return -1;
        return Math.round(valid.reduce((a,b)=>a+b,0) / valid.length);
    },

    formatMs: function(sampleOrValue) {
        const value = typeof sampleOrValue === 'number' ? sampleOrValue : (sampleOrValue ? sampleOrValue.v : null);
        if (value === null || value === undefined) return '--';
        if (value === -1) return 'LOSS';
        return `${value} ms`;
    },

    statusColor: function(value, warn, bad) {
        if (value === -1 || value === null || value === undefined) return '#ff5252';
        if (value >= bad) return '#ff5252';
        if (value >= warn) return '#f1c40f';
        return '#2ecc71';
    },

    drawLatencyGraph: function(canvasId = 'nd_latency_canvas') {
        const canvas = document.getElementById(canvasId);
        this.drawLatencyCanvas(canvas);
    },

    drawLatencyCanvas: function(canvas) {
        if (!canvas || !canvas.getContext) return;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(320, Math.floor(rect.width || canvas.width));
        const height = Math.max(130, Math.floor(rect.height || canvas.height));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-input') || '#141821';
        ctx.fillRect(0, 0, width, height);

        const pad = { l: 38, r: 12, t: 12, b: 24 };
        const now = Date.now();
        const minT = now - this.oneHourMs;
        const series = [
            { key: 'gateway', color: '#5DB2FF' },
            { key: 'internet', color: '#2ecc71' },
            { key: 'server', color: '#f1c40f' },
            { key: 'dbQuery', color: '#ff6bcb' }
        ];
        const values = series.flatMap(s => (this.history[s.key] || []).map(p => p.v).filter(v => v > -1));
        const maxVal = Math.max(100, Math.min(2500, Math.ceil((Math.max(...values, 100) + 50) / 50) * 50));

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
        ctx.font = '11px sans-serif';
        [0, 0.5, 1].forEach(frac => {
            const y = pad.t + (height - pad.t - pad.b) * frac;
            ctx.beginPath();
            ctx.moveTo(pad.l, y);
            ctx.lineTo(width - pad.r, y);
            ctx.stroke();
            const label = `${Math.round(maxVal * (1 - frac))}ms`;
            ctx.fillText(label, 4, y + 4);
        });
        ctx.fillText('60m', pad.l, height - 7);
        ctx.fillText('now', width - pad.r - 24, height - 7);

        const plotW = width - pad.l - pad.r;
        const plotH = height - pad.t - pad.b;
        const xFor = t => pad.l + ((t - minT) / this.oneHourMs) * plotW;
        const yFor = v => pad.t + (1 - Math.min(v, maxVal) / maxVal) * plotH;

        series.forEach(s => {
            const points = (this.history[s.key] || []).filter(p => p.t >= minT && p.v > -1);
            if (!points.length) return;
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            points.forEach((p, idx) => {
                const x = xFor(p.t);
                const y = yFor(p.v);
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
            const last = points[points.length - 1];
            ctx.fillStyle = s.color;
            ctx.beginPath();
            ctx.arc(xFor(last.t), yFor(last.v), 3, 0, Math.PI * 2);
            ctx.fill();
        });
    },

    renderFlow: function() {
        const el = document.getElementById('nd_flow');
        if (!el) return;
        const gate = this.lastResults.gateway;
        const net = this.lastResults.internet;
        const srv = this.lastResults.server;
        const dbq = this.lastResults.dbQuery;
        const dbReachable = srv && srv.success;
        const dbDataOk = dbq && dbq.success;
        const dbDataSlow = dbDataOk && dbq.v > 1200;
        const dbDiag = dbReachable && !dbDataOk
            ? `Host reachable, data query failing (${this.dbProbe.lastStage || 'query'})`
            : (!dbReachable && dbDataOk ? 'Data query ok, ICMP blocked or host ping blocked' : (dbDataSlow ? 'Data query slow' : (dbDataOk ? 'Data query healthy' : 'Waiting for data query')));

        el.innerHTML = `
            ${this.renderFlowStep('Client', 'fa-desktop', navigator.onLine ? 'Browser online' : 'Browser offline', navigator.onLine ? '#2ecc71' : '#ff5252')}
            ${this.renderFlowStep('Local Gateway', 'fa-network-wired', this.formatMs(gate), this.statusColor(gate ? gate.v : null, 30, 80))}
            ${this.renderFlowStep('Internet / DB IP', 'fa-cloud', `${this.formatMs(net)} / ${this.formatMs(srv)}`, this.statusColor(srv ? srv.v : null, 250, 500))}
            ${this.renderFlowStep('Supabase Data', 'fa-database', `${this.formatMs(dbq)} - ${dbDiag}`, dbDataOk ? this.statusColor(dbq.v, 500, 1200) : '#ff5252')}
        `;
    },

    renderFlowStep: function(title, icon, text, color) {
        return `
            <div class="net-flow-step" style="border-left:4px solid ${color};">
                <strong><i class="fas ${icon}" style="color:${color};"></i> ${title}</strong>
                <span>${this.escapeHtml(text)}</span>
            </div>
        `;
    },

    isAdminUser: function(user = window.CURRENT_USER) {
        return !!(user && (user.role === 'admin' || user.role === 'super_admin'));
    },

    getAgentRows: function() {
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const reports = JSON.parse(localStorage.getItem('network_diagnostics') || '[]');
        const reportMap = new Map();
        reports.forEach(r => {
            const key = this.identityKey(r.user);
            if (!key) return;
            const existing = reportMap.get(key);
            if (!existing || new Date(r.date) > new Date(existing.date)) reportMap.set(key, r);
        });

        const active = window.ACTIVE_USERS_CACHE || {};
        const now = Date.now();
        return users
            .filter(u => ['admin', 'super_admin', 'trainee'].includes(String(u.role || '').toLowerCase()))
            .map(u => {
                const name = u.user || u.username || '';
                const presence = active[name] || active[this.identityKey(name)] || null;
                const lastSeenTs = presence && presence.local_received_at ? presence.local_received_at : (presence && presence.lastSeen ? new Date(presence.lastSeen).getTime() : 0);
                const ageMs = lastSeenTs ? now - lastSeenTs : null;
                const online = ageMs !== null && ageMs < 90000;
                const report = reportMap.get(this.identityKey(name));
                return { user: name, role: u.role || '-', presence, ageMs, online, report };
            })
            .sort((a, b) => Number(b.online) - Number(a.online) || String(a.role).localeCompare(String(b.role)) || a.user.localeCompare(b.user));
    },

    populateAgentDropdown: function() {
        const select = document.getElementById('nd_agent_select');
        if (!select) return;
        const current = select.value;
        const rows = this.getAgentRows();
        select.innerHTML = `<option value="__all">All admins, super admins and trainees</option>` + rows.map(r => `<option value="${this.escapeHtml(r.user)}">${this.escapeHtml(r.user)} (${this.escapeHtml(r.role)})</option>`).join('');
        if (current && Array.from(select.options).some(o => o.value === current)) select.value = current;
    },

    renderAgentStatus: function() {
        const table = document.getElementById('nd_agent_table');
        if (!table) return;
        this.populateAgentDropdown();

        const select = document.getElementById('nd_agent_select');
        const selected = select ? select.value : '__all';
        const statusFilters = this.getSelectedStatusFilters('nd_status_filters');
        let rows = this.getAgentRows();
        if (selected && selected !== '__all') rows = rows.filter(r => r.user === selected);
        rows = this.filterAgentRowsByStatus(rows, statusFilters);

        const rowHtml = rows.map(r => {
            const report = r.report;
            const pings = report && report.pings ? report.pings : {};
            const dbQuery = report && report.dbQuery ? report.dbQuery : null;
            const age = r.ageMs === null ? 'No heartbeat' : `${Math.round(r.ageMs / 1000)}s ago`;
            const status = this.getAgentStatus(r);
            const reportSummary = this.getReportSummary(report);
            return `
                <div class="net-agent-row">
                    <div><strong>${this.escapeHtml(r.user)}</strong><br><span style="color:var(--text-muted); font-size:0.78rem;">${this.escapeHtml(r.role)}</span></div>
                    <div><span class="net-pill" style="color:${status.color};"><i class="fas ${status.icon}"></i>${status.label}</span></div>
                    <div>${this.escapeHtml(age)}</div>
                    <div style="font-family:monospace;">G ${this.formatMs(pings.gateway)} / I ${this.formatMs(pings.internet)} / DB ${this.formatMs(pings.server)}</div>
                    <div>${reportSummary.html}${dbQuery ? `<br><span style="font-family:monospace; color:${dbQuery.success ? '#2ecc71' : '#ff5252'};">Data ${this.formatMs(dbQuery.time || dbQuery.latency || (dbQuery.success ? 0 : -1))}</span>` : ''}</div>
                </div>
            `;
        }).join('');

        table.innerHTML = `
            <div class="net-agent-row net-agent-head">
                <div>Agent</div><div>Status</div><div>Heartbeat</div><div>Last Network Report</div><div>Report Age</div>
            </div>
            ${rowHtml || '<div style="padding:14px; color:var(--text-muted);">No admin, super admin, or trainee users found.</div>'}
        `;

        const detail = document.getElementById('nd_agent_detail');
        if (detail) {
            const online = rows.filter(r => r.online).length;
            const stale = rows.length - online;
            detail.innerHTML = `
                <span class="net-pill" style="color:#2ecc71;"><i class="fas fa-circle-check"></i>${online} online</span>
                <span class="net-pill" style="color:${stale ? '#f1c40f' : '#2ecc71'};"><i class="fas fa-clock"></i>${stale} stale/offline</span>
                <span class="net-pill"><i class="fas fa-filter"></i>${this.escapeHtml(this.describeStatusFilters(statusFilters))}</span>
                <span class="net-pill"><i class="fas fa-database"></i>This client DB data query: ${this.formatMs(this.lastResults.dbQuery)}</span>
            `;
        }
    },

    getAgentStatus: function(row) {
        if (!row || !row.online) return { key: 'offline', label: 'Offline', color: '#ff5252', icon: 'fa-circle-xmark' };
        if (row.presence && row.presence.isIdle) return { key: 'idle', label: 'Idle', color: '#f1c40f', icon: 'fa-hourglass-half' };
        return { key: 'online', label: 'Online', color: '#2ecc71', icon: 'fa-circle-check' };
    },

    getSelectedStatusFilters: function(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return ['online', 'idle', 'offline', 'stale_report'];
        return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
    },

    describeStatusFilters: function(filters) {
        const selected = Array.isArray(filters) ? filters : [];
        const all = ['online', 'idle', 'offline', 'stale_report'];
        if (selected.length === 0 || all.every(v => selected.includes(v))) return 'all statuses';
        return selected.map(v => v.replace('_', ' ')).join(' + ');
    },

    isStaleReport: function(row) {
        if (!row || !row.report || !row.report.date) return true;
        return (Date.now() - new Date(row.report.date).getTime()) > 15 * 60 * 1000;
    },

    filterAgentRowsByStatus: function(rows, filters) {
        const selected = Array.isArray(filters) ? filters : [filters].filter(Boolean);
        if (selected.length === 0) return rows;
        const all = ['online', 'idle', 'offline', 'stale_report'];
        if (all.every(v => selected.includes(v))) return rows;
        return rows.filter(r => {
            if (selected.includes(this.getAgentStatus(r).key)) return true;
            return selected.includes('stale_report') && this.isStaleReport(r);
        });
    },

    getReportSummary: function(report) {
        if (!report || !report.date) return { label: 'No report', html: '<span style="color:#ff5252;">No report</span>' };
        const ageMin = Math.max(0, Math.round((Date.now() - new Date(report.date).getTime()) / 60000));
        const p = report.pings || {};
        const hostBad = p.server === -1 || p.internet === -1 || p.gateway === -1;
        const dataBad = report.dbQuery && !report.dbQuery.success;
        const ageLabel = ageMin < 1 ? 'just now' : `${ageMin}m ago`;
        let state = 'OK';
        let color = '#2ecc71';
        if (hostBad || dataBad) {
            state = hostBad ? 'Host issue' : 'Data issue';
            color = '#ff5252';
        } else if (ageMin > 15) {
            state = 'Stale';
            color = '#f1c40f';
        }
        return {
            label: `${state} - ${ageLabel}`,
            html: `<span style="color:${color};">${state}</span> <span style="color:var(--text-muted);">(${ageLabel})</span>`
        };
    },

    installConsoleCapture: function() {
        if (window.__NETWORK_DIAG_CONSOLE_CAPTURED) return;
        window.__NETWORK_DIAG_CONSOLE_CAPTURED = true;
        window.NETWORK_DIAG_CONSOLE_EVENTS = window.NETWORK_DIAG_CONSOLE_EVENTS || [];

        const pushEvent = (level, args, source = 'console') => {
            try {
                const events = window.NETWORK_DIAG_CONSOLE_EVENTS || [];
                const message = Array.from(args || []).map(arg => {
                    if (arg instanceof Error) return arg.stack || arg.message;
                    if (typeof arg === 'string') return arg;
                    try { return JSON.stringify(arg); } catch (error) { return String(arg); }
                }).join(' ');

                events.push({
                    time: new Date().toISOString(),
                    level,
                    source,
                    message: message.slice(0, 600)
                });
                while (events.length > this.consoleLimit) events.shift();
                window.NETWORK_DIAG_CONSOLE_EVENTS = events;
            } catch (error) {}
        };

        ['warn', 'error'].forEach(level => {
            const original = console[level];
            console[level] = function(...args) {
                pushEvent(level, args);
                return original.apply(console, args);
            };
        });

        window.addEventListener('error', event => {
            pushEvent('error', [event.message || 'Window error', event.filename || '', event.lineno || ''], 'window');
        });

        window.addEventListener('unhandledrejection', event => {
            pushEvent('error', [event.reason || 'Unhandled promise rejection'], 'promise');
        });
    },

    getConsoleEvents: function() {
        return (window.NETWORK_DIAG_CONSOLE_EVENTS || []).slice(-12).reverse();
    },

    clearConsoleCapture: function() {
        window.NETWORK_DIAG_CONSOLE_EVENTS = [];
        this.renderConsoleView();
        this.refreshPopout();
    },

    renderConsoleView: function() {
        const list = document.getElementById('nd_console_list');
        if (!list || !this.isAdminUser()) return;
        const events = this.getConsoleEvents();
        if (!events.length) {
            list.innerHTML = '<div style="padding:10px; color:var(--text-muted); font-size:0.82rem;">No warnings or errors captured in this app session.</div>';
            return;
        }

        list.innerHTML = events.map(item => {
            const level = String(item.level || 'warn').toLowerCase();
            const time = item.time ? new Date(item.time).toLocaleTimeString() : '--';
            return `
                <div class="net-console-row">
                    <div style="color:var(--text-muted);">${this.escapeHtml(time)}</div>
                    <div class="net-console-level-${level === 'error' ? 'error' : 'warn'}">${this.escapeHtml(level.toUpperCase())}</div>
                    <div class="net-console-msg">${this.escapeHtml(item.message || '')}</div>
                </div>
            `;
        }).join('');
    },

    identityKey: function(value) {
        return String(value || '').trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, '');
    },

    getSnapshot: function() {
        const isAdmin = this.isAdminUser();
        return {
            generatedAt: new Date().toISOString(),
            publicIP: this.publicIP,
            stats: this.stats,
            lastResults: this.lastResults,
            dbProbe: this.dbProbe,
            averages: {
                gateway: this.getAvg(this.history.gateway),
                internet: this.getAvg(this.history.internet),
                server: this.getAvg(this.history.server),
                dbQuery: this.getAvg(this.history.dbQuery)
            },
            consoleEvents: isAdmin ? this.getConsoleEvents() : [],
            agentRows: isAdmin ? this.getAgentRows() : [],
            canViewAgents: isAdmin
        };
    },

    openPopout: function() {
        if (!this.isAdminUser()) {
            if (typeof showToast === 'function') showToast('Network popout is available to admins only.', 'warning');
            return false;
        }

        if (this.popoutWindow && !this.popoutWindow.closed) {
            try { this.popoutWindow.focus(); return true; } catch (error) {}
        }

        if (!this.isRunning) this.startTests();
        const features = 'popup=yes,width=1280,height=860,left=80,top=60,resizable=yes,scrollbars=yes';
        const child = window.open('', 'network_diagnostics_workspace', features);
        if (!child) {
            if (typeof showToast === 'function') showToast('Popup blocked. Allow popups for Network Diagnostics.', 'warning');
            return false;
        }

        this.popoutWindow = child;
        child.document.open();
        child.document.write(this.getPopoutHTML());
        child.document.close();
        if (this.popoutInterval) clearInterval(this.popoutInterval);
        this.popoutInterval = setInterval(() => this.refreshPopout(), 2000);
        setTimeout(() => this.refreshPopout(), 250);
        return true;
    },

    refreshPopout: function() {
        const child = this.popoutWindow;
        if (!child || child.closed) {
            if (this.popoutInterval) clearInterval(this.popoutInterval);
            this.popoutInterval = null;
            return;
        }
        try {
            if (typeof child.renderNetworkSnapshot === 'function') {
                child.renderNetworkSnapshot(this.getSnapshot());
                this.drawLatencySeriesCanvas(child.document.getElementById('pop_gate_graph'), 'gateway', '#5DB2FF');
                this.drawLatencySeriesCanvas(child.document.getElementById('pop_net_graph'), 'internet', '#2ecc71');
                this.drawLatencySeriesCanvas(child.document.getElementById('pop_srv_graph'), 'server', '#f1c40f');
                this.drawLatencySeriesCanvas(child.document.getElementById('pop_dbq_graph'), 'dbQuery', '#ff6bcb');
            }
        } catch (error) {}
    },

    drawLatencyGraphInDocument: function(doc, canvasId) {
        if (!doc) return;
        this.drawLatencyCanvas(doc.getElementById(canvasId));
    },

    drawLatencySeriesCanvas: function(canvas, key, color) {
        if (!canvas || !canvas.getContext) return;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(180, Math.floor(rect.width || canvas.width));
        const height = Math.max(46, Math.floor(rect.height || canvas.height));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, width, height);

        const points = (this.history[key] || []).filter(p => p.v > -1 && p.t >= Date.now() - this.oneHourMs);
        const maxVal = Math.max(100, Math.min(2500, Math.ceil((Math.max(...points.map(p => p.v), 100) + 50) / 50) * 50));
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = 1;
        [0.33, 0.66].forEach(frac => {
            const y = height * frac;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        });
        if (!points.length) return;

        const now = Date.now();
        const minT = now - this.oneHourMs;
        const xFor = t => ((t - minT) / this.oneHourMs) * width;
        const yFor = v => height - (Math.min(v, maxVal) / maxVal) * (height - 4) - 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach((p, idx) => {
            const x = xFor(p.t);
            const y = yFor(p.v);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    },

    getPopoutHTML: function() {
        return `<!doctype html>
        <html>
        <head>
            <title>Network Diagnostics</title>
            <meta charset="utf-8">
            <style>
                * { box-sizing:border-box; }
                body { margin:0; background:rgba(16,20,28,0.96); color:#eef2f7; font-family:Segoe UI, Arial, sans-serif; overflow:hidden; }
                .shell { height:100vh; padding:10px; display:flex; flex-direction:column; gap:8px; }
                .top { display:flex; justify-content:space-between; align-items:center; gap:8px; min-height:32px; }
                h1 { font-size:18px; margin:0; white-space:nowrap; }
                .controls { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
                .filter-group { display:flex; gap:5px; flex-wrap:wrap; justify-content:flex-end; }
                .filter-group label { display:inline-flex; align-items:center; gap:4px; padding:4px 7px; border:1px solid #2a3343; border-radius:999px; background:#111827; color:#eef2f7; font-size:12px; cursor:pointer; }
                .filter-group input { margin:0; }
                .metric-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:8px; }
                .card { background:#171d28; border:1px solid #2a3343; border-radius:8px; padding:9px; min-width:0; }
                .metric-card { display:grid; grid-template-columns:auto 1fr; grid-template-rows:auto auto; gap:3px 8px; align-items:center; min-height:98px; }
                .label { color:#9ca3af; font-size:11px; text-transform:uppercase; letter-spacing:0; }
                .value { font-size:24px; font-weight:700; font-family:Consolas, monospace; white-space:nowrap; }
                .metric-card canvas { grid-column:1 / -1; height:42px; }
                .main { flex:1; min-height:0; display:grid; grid-template-columns:minmax(280px, 0.9fr) minmax(360px, 1.5fr); gap:8px; }
                .stack { min-height:0; display:flex; flex-direction:column; gap:8px; }
                .scroll { min-height:0; overflow:auto; }
                .muted { color:#9ca3af; font-size:12px; }
                canvas { width:100%; background:#111827; border-radius:6px; }
                table { width:100%; border-collapse:collapse; font-size:13px; }
                th, td { text-align:left; border-bottom:1px solid #2a3343; padding:6px; vertical-align:top; }
                th { color:#9ca3af; text-transform:uppercase; font-size:11px; }
                .ok { color:#2ecc71; } .warn { color:#f1c40f; } .bad { color:#ff5252; }
                .summary { display:grid; grid-template-columns:repeat(auto-fit, minmax(110px, 1fr)); gap:8px; }
                .summary .value { font-size:18px; }
                .console-list { max-height:160px; overflow:auto; margin-top:8px; border-top:1px solid #2a3343; padding-top:6px; }
                .console-row { display:grid; grid-template-columns:68px 60px 1fr; gap:6px; padding:5px 0; border-bottom:1px solid #2a3343; font-size:12px; }
                .console-msg { white-space:pre-wrap; overflow-wrap:anywhere; }
                @media (max-width: 760px), (max-height: 560px) {
                    body { overflow:auto; }
                    .shell { height:auto; min-height:100vh; }
                    .main { grid-template-columns:1fr; }
                    .metric-grid { grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); }
                    .value { font-size:19px; }
                    .metric-card { min-height:84px; }
                    .metric-card canvas { height:34px; }
                    table { font-size:12px; }
                    th, td { padding:5px; }
                    .console-row { grid-template-columns:1fr; }
                }
            </style>
        </head>
        <body>
            <div class="shell">
                <div class="top">
                    <h1>Network Diagnostics</h1>
                    <div class="controls">
                        <div id="pop_status_filters" class="filter-group" title="Show agents matching any selected status">
                            <label><input type="checkbox" value="online" checked onchange="window.renderNetworkSnapshot(window.__lastNetworkSnapshot)"> Online</label>
                            <label><input type="checkbox" value="idle" checked onchange="window.renderNetworkSnapshot(window.__lastNetworkSnapshot)"> Idle</label>
                            <label><input type="checkbox" value="offline" checked onchange="window.renderNetworkSnapshot(window.__lastNetworkSnapshot)"> Offline</label>
                            <label><input type="checkbox" value="stale_report" checked onchange="window.renderNetworkSnapshot(window.__lastNetworkSnapshot)"> Stale</label>
                        </div>
                        <div class="muted" id="pop_updated">Waiting...</div>
                    </div>
                </div>
                <div class="metric-grid">
                    <div class="card metric-card"><div class="label">Gateway</div><div id="pop_gate" class="value">--</div><canvas id="pop_gate_graph"></canvas></div>
                    <div class="card metric-card"><div class="label">Internet</div><div id="pop_net" class="value">--</div><canvas id="pop_net_graph"></canvas></div>
                    <div class="card metric-card"><div class="label">DB Server IP</div><div id="pop_srv" class="value">--</div><canvas id="pop_srv_graph"></canvas></div>
                    <div class="card metric-card"><div class="label">DB Data Query</div><div id="pop_dbq" class="value">--</div><canvas id="pop_dbq_graph"></canvas></div>
                </div>
                <div class="main">
                    <div class="stack">
                        <div class="summary">
                            <div class="card"><div class="label">CPU</div><div id="pop_cpu" class="value">--</div></div>
                            <div class="card"><div class="label">RAM</div><div id="pop_ram" class="value">--</div></div>
                            <div class="card"><div class="label">Disk</div><div id="pop_disk" class="value">--</div></div>
                        </div>
                        <div class="card">
                            <div class="label">Current DB Diagnosis</div>
                            <div id="pop_db_diag" class="value" style="font-size:18px; white-space:normal;">Waiting...</div>
                            <div class="console-list">
                                <div class="label">Console Errors</div>
                                <div id="pop_console"><div class="muted" style="padding-top:6px;">Waiting...</div></div>
                            </div>
                        </div>
                    </div>
                    <div class="card scroll">
                        <div class="label">Admin, Super Admin and Trainee Status</div>
                        <table>
                            <thead><tr><th>Agent</th><th>Status</th><th>Heartbeat</th><th>Last Report</th></tr></thead>
                            <tbody id="pop_agents"><tr><td colspan="4" class="muted">Waiting...</td></tr></tbody>
                        </table>
                    </div>
                </div>
            </div>
            <script>
                function fmt(sample) {
                    if (!sample) return '--';
                    const v = typeof sample === 'number' ? sample : sample.v;
                    if (v === -1 || v === null || v === undefined) return 'LOSS';
                    return v + ' ms';
                }
                function cls(sample, warn, bad) {
                    const v = typeof sample === 'number' ? sample : (sample ? sample.v : -1);
                    if (v === -1 || v === null || v === undefined || v >= bad) return 'bad';
                    if (v >= warn) return 'warn';
                    return 'ok';
                }
                function agentStatus(a) {
                    if (!a || !a.online) return { key:'offline', label:'Offline', cls:'bad' };
                    if (a.presence && a.presence.isIdle) return { key:'idle', label:'Idle', cls:'warn' };
                    return { key:'online', label:'Online', cls:'ok' };
                }
                function selectedStatusFilters() {
                    return Array.prototype.slice.call(document.querySelectorAll('#pop_status_filters input[type="checkbox"]:checked')).map(function(input) {
                        return input.value;
                    });
                }
                function isStaleReport(a) {
                    return !a || !a.report || !a.report.date || (Date.now() - new Date(a.report.date).getTime()) > 15 * 60 * 1000;
                }
                function rowMatchesFilters(a, filters) {
                    if (!filters.length) return true;
                    if (filters.indexOf('online') > -1 && agentStatus(a).key === 'online') return true;
                    if (filters.indexOf('idle') > -1 && agentStatus(a).key === 'idle') return true;
                    if (filters.indexOf('offline') > -1 && agentStatus(a).key === 'offline') return true;
                    return filters.indexOf('stale_report') > -1 && isStaleReport(a);
                }
                function reportSummary(a) {
                    const r = a && a.report;
                    if (!r || !r.date) return '<span class="bad">No report</span>';
                    const ageMin = Math.max(0, Math.round((Date.now() - new Date(r.date).getTime()) / 60000));
                    const p = r.pings || {};
                    const hostBad = p.gateway === -1 || p.internet === -1 || p.server === -1;
                    const dataBad = r.dbQuery && !r.dbQuery.success;
                    let state = 'OK', klass = 'ok';
                    if (hostBad || dataBad) { state = hostBad ? 'Host issue' : 'Data issue'; klass = 'bad'; }
                    else if (ageMin > 15) { state = 'Stale'; klass = 'warn'; }
                    return '<span class="' + klass + '">' + state + '</span> <span class="muted">(' + (ageMin < 1 ? 'just now' : ageMin + 'm ago') + ')</span>';
                }
                window.renderNetworkSnapshot = function(s) {
                    if (!s) return;
                    window.__lastNetworkSnapshot = s;
                    document.getElementById('pop_updated').textContent = 'Updated ' + new Date(s.generatedAt).toLocaleTimeString();
                    const r = s.lastResults || {};
                    [['pop_gate', r.gateway, 30, 80], ['pop_net', r.internet, 150, 300], ['pop_srv', r.server, 250, 500], ['pop_dbq', r.dbQuery, 500, 1200]].forEach(([id, val, warn, bad]) => {
                        const el = document.getElementById(id);
                        el.textContent = fmt(val);
                        el.className = 'value ' + cls(val, warn, bad);
                    });
                    document.getElementById('pop_cpu').textContent = ((s.stats && s.stats.cpu) || '0') + '%';
                    document.getElementById('pop_ram').textContent = ((s.stats && s.stats.ram) || '0') + 'GB';
                    document.getElementById('pop_disk').textContent = (s.stats && s.stats.disk) || 'N/A';
                    const dbHost = r.server && r.server.success;
                    const dbData = r.dbQuery && r.dbQuery.success;
                    const dbSlow = dbData && r.dbQuery.v > 1200;
                    const diag = dbHost && dbData ? 'Host reachable, data query healthy'
                        : (dbHost && !dbData ? 'Host reachable, data query failing: ' + ((s.dbProbe && s.dbProbe.lastStage) || 'query')
                        : (!dbHost && dbData ? 'Data works, ping may be blocked' : 'Host/data unavailable'));
                    document.getElementById('pop_db_diag').textContent = dbSlow ? 'Host reachable, data query slow' : diag;
                    document.getElementById('pop_db_diag').className = 'value ' + (dbHost && dbData && !dbSlow ? 'ok' : (!dbHost && !dbData ? 'bad' : 'warn'));
                    const consoleEvents = (s.consoleEvents || []).slice(0, 10);
                    document.getElementById('pop_console').innerHTML = consoleEvents.length ? consoleEvents.map(function(item) {
                        const level = String(item.level || 'warn').toLowerCase();
                        const klass = level === 'error' ? 'bad' : 'warn';
                        const time = item.time ? new Date(item.time).toLocaleTimeString() : '--';
                        return '<div class="console-row"><div class="muted">' + esc(time) + '</div><div class="' + klass + '">' + esc(level.toUpperCase()) + '</div><div class="console-msg">' + esc(item.message || '') + '</div></div>';
                    }).join('') : '<div class="muted" style="padding-top:6px;">No warnings or errors captured.</div>';
                    let agentRows = (s.agentRows || []);
                    const filters = selectedStatusFilters();
                    agentRows = agentRows.filter(function(a) { return rowMatchesFilters(a, filters); });
                    const rows = agentRows.slice(0, 120).map(function(a) {
                        const age = a.ageMs === null ? 'No heartbeat' : Math.round(a.ageMs / 1000) + 's ago';
                        const p = a.report && a.report.pings ? a.report.pings : {};
                        const st = agentStatus(a);
                        return '<tr><td><strong>' + esc(a.user) + '</strong><br><span class="muted">' + esc(a.role) + '</span></td><td class="' + st.cls + '">' + st.label + '</td><td>' + age + '</td><td>' + reportSummary(a) + '<br><span class="muted">G ' + fmt(p.gateway) + ' / I ' + fmt(p.internet) + ' / DB ' + fmt(p.server) + '</span></td></tr>';
                    }).join('');
                    document.getElementById('pop_agents').innerHTML = rows || '<tr><td colspan="4" class="muted">No tracked agents found.</td></tr>';
                };
                function esc(v) {
                    return String(v || '').replace(/[&<>"']/g, function(ch) {
                        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];
                    });
                }
            </script>
        </body>
        </html>`;
    },

    reportToCloud: async function() {
        if (!CURRENT_USER) return;
        const report = {
            id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            user: CURRENT_USER.user,
            date: new Date().toISOString(),
            publicIP: this.publicIP,
            stats: this.stats,
            dbQuery: {
                success: !!(this.lastResults.dbQuery && this.lastResults.dbQuery.success),
                latency: this.lastResults.dbQuery ? this.lastResults.dbQuery.v : -1,
                stage: this.lastResults.dbQuery ? this.lastResults.dbQuery.stage : this.dbProbe.lastStage,
                attempts: this.lastResults.dbQuery ? this.lastResults.dbQuery.attempts : 0,
                error: this.dbProbe.lastError || ''
            },
            pings: {
                gateway: this.getAvg(this.history.gateway),
                internet: this.getAvg(this.history.internet),
                server: this.getAvg(this.history.server)
            }
        };

        const logs = JSON.parse(localStorage.getItem('network_diagnostics') || '[]');
        logs.push(report);
        if (logs.length > 100) logs.shift();
        localStorage.setItem('network_diagnostics', JSON.stringify(logs));

        if (typeof saveToServer === 'function') await saveToServer(['network_diagnostics'], false, true);
    },

    escapeHtml: function(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }
};

window.NetworkDiag.openAdminView = async function() {
    const modal = document.getElementById('netDiagModal');
    if (!modal) return;

    this.stopTests();
    this.stopDashboardRefresh();

    if(typeof loadFromServer === 'function') await loadFromServer(true);

    const reports = JSON.parse(localStorage.getItem('network_diagnostics') || '[]');
    reports.sort((a,b) => new Date(b.date) - new Date(a.date));

    const rows = reports.map(r => {
        const date = new Date(r.date).toLocaleString();
        const gate = r.pings ? r.pings.gateway : '-';
        const net = r.pings ? r.pings.internet : '-';
        const srv = r.pings ? r.pings.server : '-';
        const data = r.dbQuery ? (r.dbQuery.success ? `${r.dbQuery.latency}ms` : 'FAIL') : '-';

        let status = '<span style="color:#2ecc71">Good</span>';
        if (gate === -1 || gate > 50 || net === -1 || net > 200 || (r.dbQuery && !r.dbQuery.success)) status = '<span style="color:#ff5252">Poor</span>';
        else if (gate > 20 || net > 100 || srv > 300) status = '<span style="color:#f1c40f">Fair</span>';

        return `
            <tr>
                <td style="font-size:0.8rem;">${date}</td>
                <td><strong>${this.escapeHtml(r.user)}</strong></td>
                <td style="font-family:monospace;">${gate}ms / ${net}ms / ${srv}ms</td>
                <td style="font-family:monospace;">${data}</td>
                <td>${r.stats ? this.escapeHtml(r.stats.connType) : '-'}</td>
                <td>${status}</td>
            </tr>
        `;
    }).join('');

    const content = `
        <div style="height:70vh; display:flex; flex-direction:column;">
            <div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                <h4>Diagnostic History (${reports.length} Reports)</h4>
                <button class="btn-primary btn-sm" onclick="NetworkDiag.closeModal(); NetworkDiag.openModal();">Back to Test</button>
            </div>
            <div class="table-responsive" style="flex:1; overflow-y:auto;">
                <table class="admin-table compressed-table">
                    <thead><tr><th>Date</th><th>User</th><th>Gate/Net/DB Host</th><th>DB Data</th><th>Type</th><th>Status</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6" class="text-center">No reports found.</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;

    modal.querySelector('.modal-box').innerHTML = content;
};

window.NetworkDiag.init();
