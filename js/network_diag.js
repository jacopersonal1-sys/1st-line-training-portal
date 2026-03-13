/* ================= NETWORK DIAGNOSTICS ================= */
/* Real-time Gateway/Internet/Server monitoring and analysis */

window.NetworkDiag = {
    isRunning: false,
    interval: null,
    reportInterval: null,
    history: { gateway: [], internet: [], server: [] },
    config: {
        gateway: '8.8.8.8', // Fallback if local gateway not detected (usually user router)
        internet: '1.1.1.1',
        server: 'google.com' // Will be replaced by actual Supabase URL host
    },
    stats: { cpu: 0, ram: 0, connType: 'Unknown' },
    publicIP: 'Loading...',

    init: function() {
        // Inject Styles
        if (!document.getElementById('net-diag-styles')) {
            const style = document.createElement('style');
            style.id = 'net-diag-styles';
            style.innerHTML = `
                .net-metric-box { background: var(--bg-input); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); text-align: center; }
                .net-val { font-size: 1.5rem; font-weight: bold; margin: 5px 0; font-family: monospace; }
                .net-label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; }
                .net-status { font-size: 0.8rem; font-weight: bold; padding: 2px 6px; border-radius: 4px; }
                .status-good { color: #2ecc71; background: rgba(46, 204, 113, 0.1); }
                .status-warn { color: #f1c40f; background: rgba(241, 196, 15, 0.1); }
                .status-bad { color: #ff5252; background: rgba(255, 82, 82, 0.1); }
            `;
            document.head.appendChild(style);
        }
        
        // Set Server Target from Config
        if (window.CLOUD_CREDENTIALS && window.CLOUD_CREDENTIALS.url) {
            try {
                const url = new URL(window.CLOUD_CREDENTIALS.url);
                this.config.server = url.hostname;
            } catch(e) {}
        }

        // Attach listener to sidebar button
        const btn = document.getElementById('btn-sidebar-net-test');
        if (btn) {
            btn.onclick = () => this.openModal();
        }
    },

    openModal: function() {
        // Robust Admin Check (Check Window global or Session Storage)
        const user = window.CURRENT_USER || JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        const isAdmin = user && (user.role === 'admin' || user.role === 'super_admin');

        const modalHtml = `
            <div id="netDiagModal" class="modal-overlay" style="z-index: 10005;">
                <div class="modal-box" style="width: 800px; max-width: 95%;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                        <h3 style="margin:0;"><i class="fas fa-network-wired" style="color:var(--primary);"></i> Network Diagnostics</h3>
                        <button class="btn-secondary" onclick="NetworkDiag.closeModal()">&times;</button>
                    </div>
                    
                    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 20px;">
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

                    <div class="card" style="margin-bottom: 20px; background: var(--bg-card);">
                        <h4 style="margin-top:0;">Analysis & System Health</h4>
                        <div style="display:flex; justify-content:space-between; font-size: 0.9rem; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed var(--border-color);">
                            <span><strong>Connection:</strong> <span id="nd_conn_type">Detecting...</span></span>
                            <span><strong>Public IP:</strong> <span id="nd_pub_ip">Loading...</span></span>
                            <span><strong>CPU:</strong> <span id="nd_cpu">0%</span></span>
                            <span><strong>RAM:</strong> <span id="nd_ram">0/0 GB</span></span>
                            <span><strong>Disk:</strong> <span id="nd_disk">--</span></span>
                        </div>
                        <div id="nd_analysis" style="padding: 10px; background: var(--bg-input); border-radius: 4px; min-height: 60px; color: var(--text-muted);">
                            Initializing tests...
                        </div>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-color); padding-top:15px; margin-top:15px;">
                        <div style="font-size: 0.8rem; color: var(--text-muted);">* Reports sent to server every 10 mins</div>
                        <div style="display:flex; gap:10px;">
                            ${isAdmin ? `<button class="btn-secondary" onclick="NetworkDiag.openAdminView()"><i class="fas fa-history"></i> View History</button>` : ''}
                            <button class="btn-danger" onclick="NetworkDiag.closeModal()">Stop & Close</button>
                        </div>
                    </div>
                </div>
            </div>`;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.startTests();
    },

    closeModal: function() {
        this.stopTests();
        const el = document.getElementById('netDiagModal');
        if (el) el.remove();
    },

    startTests: async function() {
        this.isRunning = true;
        this.history = { gateway: [], internet: [], server: [] };
        
        // Get Public IP Once
        try {
            const res = await fetch('https://api.ipify.org?format=json');
            const data = await res.json();
            this.publicIP = data.ip;
            const ipEl = document.getElementById('nd_pub_ip');
            if(ipEl) ipEl.innerText = this.publicIP;
        } catch(e) { this.publicIP = 'Unknown'; }

        // Run loop
        this.runLoop();
        this.interval = setInterval(() => this.runLoop(), 2000); // Every 2 seconds
        
        // Report loop (10 mins)
        this.reportInterval = setInterval(() => this.reportToCloud(), 600000); 
    },

    stopTests: function() {
        this.isRunning = false;
        if (this.interval) clearInterval(this.interval);
        if (this.reportInterval) clearInterval(this.reportInterval);
    },

    runLoop: async function() {
        const modal = document.getElementById('netDiagModal');

        // ROBUSTNESS FIX: If modal is closed (or never opened) or test is stopped, exit immediately.
        // This prevents the "Cannot set properties of null" error if the loop runs after the modal is gone.
        if (!this.isRunning || !modal) {
            this.stopTests(); // Ensure it's fully stopped
            return;
        }

        if (typeof require === 'undefined') return; // Electron check
        const { ipcRenderer } = require('electron');

        // 1. Get System Stats
        const sys = await ipcRenderer.invoke('get-system-stats');
        this.stats = sys;
        
        document.getElementById('nd_cpu').innerText = sys.cpu + '%';
        document.getElementById('nd_ram').innerText = `${sys.ram} / ${sys.ramTotal} GB`;
        document.getElementById('nd_disk').innerText = sys.disk || 'N/A';
        document.getElementById('nd_conn_type').innerText = sys.connType;

        // 2. Perform Pings
        const pGate = await ipcRenderer.invoke('perform-network-test', this.config.gateway); // Note: 8.8.8.8 isn't gateway, ideally we'd detect gateway IP via 'route print' but keeping simple for now
        const pNet = await ipcRenderer.invoke('perform-network-test', this.config.internet);
        const pSrv = await ipcRenderer.invoke('perform-network-test', this.config.server);

        this.updateMetric('gate', pGate);
        this.updateMetric('net', pNet);
        this.updateMetric('srv', pSrv);

        this.analyze();
    },

    updateMetric: function(key, result) {
        const valEl = document.getElementById(`nd_${key}_val`);
        const statEl = document.getElementById(`nd_${key}_stat`);
        const hist = this.history[key === 'gate' ? 'gateway' : (key === 'net' ? 'internet' : 'server')];

        if (!result.success) {
            valEl.innerText = "TIMEOUT";
            valEl.style.color = "#ff5252";
            statEl.innerText = "Loss";
            statEl.className = "net-status status-bad";
            hist.push(-1); // -1 for loss
        } else {
            const ms = Math.round(result.time);
            valEl.innerText = ms + " ms";
            hist.push(ms);

            // Logic per type
            if (key === 'gate') {
                if (ms <= 10) { statEl.innerText = "Excellent"; statEl.className = "net-status status-good"; valEl.style.color = "#2ecc71"; }
                else if (ms <= 50) { statEl.innerText = "Stable"; statEl.className = "net-status status-good"; valEl.style.color = "#2ecc71"; }
                else { statEl.innerText = "Fluctuating"; statEl.className = "net-status status-warn"; valEl.style.color = "#f1c40f"; }
            } else {
                if (ms <= 100) { statEl.innerText = "Good"; statEl.className = "net-status status-good"; valEl.style.color = "#2ecc71"; }
                else if (ms <= 250) { statEl.innerText = "Fair"; statEl.className = "net-status status-warn"; valEl.style.color = "#f1c40f"; }
                else { statEl.innerText = "Lag"; statEl.className = "net-status status-bad"; valEl.style.color = "#ff5252"; }
            }
        }
        if (hist.length > 20) hist.shift();
    },

    analyze: function() {
        const el = document.getElementById('nd_analysis');
        const hGate = this.history.gateway;
        const hNet = this.history.internet;
        const hSrv = this.history.server;

        const avgGate = this.getAvg(hGate);
        const avgNet = this.getAvg(hNet);
        const avgSrv = this.getAvg(hSrv);
        
        const lossGate = hGate.filter(x => x === -1).length;
        
        let msg = "";
        let color = "var(--text-main)";

        // LOGIC TREE
        if (lossGate > 0 || avgGate > 50) {
            color = "#ff5252";
            const type = this.stats.connType;
            msg = `<strong>LOCAL ISSUE DETECTED:</strong> High latency/loss to Gateway.<br>`;
            if (type === 'Wireless') msg += "Signal unstable. Suggest moving closer to router or switching to Ethernet cable.";
            else if (type === 'Ethernet') msg += "Possible faulty cable, switch port, or router congestion.";
            else msg += "Check local network hardware.";
        } 
        else if ((avgNet === -1 || avgNet > 200) && avgGate <= 20) {
            color = "#f1c40f";
            msg = `<strong>INTERNET CONGESTION:</strong> Gateway is stable, but Internet is slow.<br>Possible ISP throttling or high bandwidth usage on network.`;
        } 
        else if ((avgSrv === -1 || avgSrv > 500) && avgNet <= 100) {
            color = "#f1c40f";
            msg = `<strong>DATABASE SERVER ISSUE:</strong> Internet is fine, but Database is slow/unreachable.<br>This indicates a backend service outage.`;
        } 
        else {
            color = "#2ecc71";
            msg = `<strong>NETWORK STABLE:</strong> All metrics within normal operating ranges.`;
        }
        
        el.innerHTML = msg;
        el.style.borderLeft = `4px solid ${color}`;
    },

    getAvg: function(arr) {
        const valid = arr.filter(x => x !== -1);
        if (valid.length === 0) return -1;
        return Math.round(valid.reduce((a,b)=>a+b,0) / valid.length);
    },

    reportToCloud: async function() {
        if (!CURRENT_USER) return;
        
        const report = {
            id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            user: CURRENT_USER.user,
            date: new Date().toISOString(),
            publicIP: this.publicIP,
            stats: this.stats,
            pings: {
                gateway: this.getAvg(this.history.gateway),
                internet: this.getAvg(this.history.internet),
                server: this.getAvg(this.history.server)
            }
        };

        // Save to local log first
        const logs = JSON.parse(localStorage.getItem('network_diagnostics') || '[]');
        logs.push(report);
        if (logs.length > 50) logs.shift(); // Keep last 50 locally
        localStorage.setItem('network_diagnostics', JSON.stringify(logs));
        
        // Push to server
        if (typeof saveToServer === 'function') await saveToServer(['network_diagnostics'], false, true); // Silent push
    }
};

// --- NEW: ADMIN HISTORY VIEW ---
window.NetworkDiag.openAdminView = async function() {
    const modal = document.getElementById('netDiagModal');
    if (!modal) return;
    
    // Stop active tests to save resources while viewing history
    this.stopTests();

    // Force sync to get latest reports
    if(typeof loadFromServer === 'function') await loadFromServer(true);

    const reports = JSON.parse(localStorage.getItem('network_diagnostics') || '[]');
    
    // Sort by date desc
    reports.sort((a,b) => new Date(b.date) - new Date(a.date));

    const rows = reports.map(r => {
        const date = new Date(r.date).toLocaleString();
        const gate = r.pings ? r.pings.gateway : '-';
        const net = r.pings ? r.pings.internet : '-';
        const srv = r.pings ? r.pings.server : '-';
        
        let status = '<span style="color:#2ecc71">Good</span>';
        if (gate === -1 || gate > 50 || net === -1 || net > 200) status = '<span style="color:#ff5252">Poor</span>';
        else if (gate > 20 || net > 100) status = '<span style="color:#f1c40f">Fair</span>';

        return `
            <tr>
                <td style="font-size:0.8rem;">${date}</td>
                <td><strong>${r.user}</strong></td>
                <td style="font-family:monospace;">${gate}ms / ${net}ms</td>
                <td>${r.stats ? r.stats.connType : '-'}</td>
                <td>${status}</td>
            </tr>
        `;
    }).join('');

    const content = `
        <div style="height:60vh; display:flex; flex-direction:column;">
            <div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                <h4>Diagnostic History (${reports.length} Reports)</h4>
                <button class="btn-primary btn-sm" onclick="NetworkDiag.closeModal(); NetworkDiag.openModal();">Back to Test</button>
            </div>
            <div class="table-responsive" style="flex:1; overflow-y:auto;">
                <table class="admin-table compressed-table">
                    <thead><tr><th>Date</th><th>User</th><th>Gate/Net Ping</th><th>Type</th><th>Status</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="5" class="text-center">No reports found.</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;

    modal.querySelector('.modal-box').innerHTML = content;
};

window.NetworkDiag.init();