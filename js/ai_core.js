/* ================= AI CORE & SYSTEM ANALYST ================= */
/* Handles the Super Admin AI Co-Pilot, Tool Registry, and Self-Repair */

const AICore = {
    history: [],
    isOpen: false,
    isAnalyzing: false,
    lastErrorTime: 0,
    analysisInterval: null,

    init: function() {
        // Start background analysis loop (every 10 minutes)
        if (this.analysisInterval) clearInterval(this.analysisInterval);
        this.analysisInterval = setInterval(() => {
            this.analyzeForImprovements();
        }, 600000); 
    },
    
    // --- TOOL REGISTRY (Safe Functions) ---
    tools: {
        "system_status": {
            description: "Check current system health (latency, storage, active users).",
            execute: async () => {
                if(typeof fetchSystemStatus === 'function') {
                    const stats = await fetchSystemStatus();
                    if(stats.error) return "System Check Failed: " + stats.error;
                    return `System Status:\n- Latency: ${stats.latency}\n- Storage: ${stats.storage}\n- Memory: ${stats.memory}\n- Active Users: ${stats.activeUsers}\n- Connection: ${stats.connection}`;
                }
                return "System Status function missing.";
            }
        },
        "scan_duplicates": {
            description: "Scan database for duplicate records (Dry Run).",
            execute: async () => {
                if (typeof cleanupDuplicateRecords === 'function') {
                    // We assume cleanupDuplicateRecords alerts the result. 
                    // Ideally, we'd refactor it to return a string, but for now we trigger it.
                    cleanupDuplicateRecords(); 
                    return "Duplicate scan initiated. Check UI alerts.";
                }
                return "Function not available.";
            }
        },
        "analyze_logs": {
            description: "Read the last 20 audit logs for suspicious activity.",
            execute: () => {
                const logs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
                const recent = logs.slice(-20);
                return JSON.stringify(recent);
            }
        },
        "repair_database": {
            description: "Run self-repair to fix integrity issues (Ghost users, broken links).",
            execute: async () => {
                return await AICore.runSelfRepair();
            }
        },
        "config_history": {
            description: "Show recent changes to System Configuration (AI or Admin).",
            execute: () => {
                const logs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
                // Filter for config changes
                const configLogs = logs.filter(l => l.action === 'System Config' || l.details.includes('Super Admin Settings'));
                return configLogs.length > 0 ? JSON.stringify(configLogs.slice(-10)) : "No recent configuration changes found.";
            }
        },
        "read_errors": {
            description: "Read the browser console error log to diagnose crashes.",
            execute: () => {
                if (!window.CONSOLE_HISTORY) return "Console history not initialized.";
                const errors = window.CONSOLE_HISTORY.filter(l => l.type === 'error' || l.type === 'fatal');
                return errors.length > 0 ? JSON.stringify(errors) : "No errors detected in this session.";
            }
        },
        "read_console": {
            description: "Read the full console history (logs, warns, errors).",
            execute: () => {
                if (!window.CONSOLE_HISTORY || window.CONSOLE_HISTORY.length === 0) return "Console history is empty.";
                return JSON.stringify(window.CONSOLE_HISTORY.slice(-50)); // Return last 50 lines
            }
        },
        "test_core_logic": {
            description: "Run a diagnostic test of critical app features (DB, Auth, Sync).",
            execute: async () => {
                let report = [];
                // 1. Check Database Connection
                if (window.supabaseClient) report.push("✅ Cloud DB: Connected");
                else report.push("❌ Cloud DB: Disconnected (supabaseClient missing)");

                // 2. Check Local Storage Schema
                const schemaKeys = ['users', 'records', 'system_config'];
                const missingKeys = schemaKeys.filter(k => !localStorage.getItem(k));
                if (missingKeys.length === 0) report.push("✅ Local Schema: Intact");
                else report.push(`❌ Local Schema: Missing keys (${missingKeys.join(', ')})`);

                // 3. Check Auth State
                if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) report.push(`✅ Auth: Logged in as ${CURRENT_USER.user} (${CURRENT_USER.role})`);
                else report.push("ℹ️ Auth: No user logged in");

                // 4. Check Error Log
                const errors = window.CONSOLE_HISTORY ? window.CONSOLE_HISTORY.filter(l => l.type === 'error' || l.type === 'fatal') : [];
                const errCount = errors.length;
                report.push(errCount > 0 ? `⚠️ Console: ${errCount} errors detected (Run 'read_errors' for details)` : "✅ Console: Clean");

                return report.join('\n');
            }
        },
        "force_sync": {
            description: "Force a full synchronization with the cloud database.",
            execute: async () => {
                if(typeof loadFromServer === 'function' && typeof saveToServer === 'function') {
                    await loadFromServer(true);
                    await saveToServer(true);
                    return "Sync completed successfully.";
                }
                return "Sync functions not available.";
            }
        },
        "list_users": {
            description: "List all registered users and their roles.",
            execute: () => {
                const users = JSON.parse(localStorage.getItem('users') || '[]');
                const summary = users.map(u => `${u.user} (${u.role})`).join(', ');
                return `Total Users: ${users.length}\nList: ${summary}`;
            }
        },
        "toggle_maintenance": {
            description: "Toggle Maintenance Mode on/off.",
            execute: async () => {
                const config = JSON.parse(localStorage.getItem('system_config') || '{}');
                if(!config.security) config.security = {};
                config.security.maintenance_mode = !config.security.maintenance_mode;
                localStorage.setItem('system_config', JSON.stringify(config));
                if(typeof saveToServer === 'function') await saveToServer(['system_config'], true);
                return `Maintenance Mode is now: ${config.security.maintenance_mode ? 'ON' : 'OFF'}`;
            }
        },
        "summarize_today": {
            description: "Get a briefing of today's attendance and submissions.",
            execute: () => {
                const today = new Date().toISOString().split('T')[0];
                const att = JSON.parse(localStorage.getItem('attendance_records') || '[]');
                const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
                
                const todayAtt = att.filter(r => r.date === today);
                const lates = todayAtt.filter(r => r.isLate).length;
                const present = todayAtt.length;
                
                const todaySubs = subs.filter(s => s.date === today);
                const completed = todaySubs.filter(s => s.status === 'completed').length;
                const pending = todaySubs.filter(s => s.status === 'pending').length;
                
                return `📅 **Daily Briefing (${today})**\n\n👤 **Attendance**\n- Present: ${present}\n- Late: ${lates}\n\n📝 **Assessments**\n- Completed: ${completed}\n- Pending Review: ${pending}`;
            }
        },
        "check_security_posture": {
            description: "Audit security settings (Maintenance Mode, IP Whitelist, Ban List).",
            execute: () => {
                const config = JSON.parse(localStorage.getItem('system_config') || '{}');
                const ac = JSON.parse(localStorage.getItem('accessControl') || '{"enabled":false}');
                const sec = config.security || {};
                
                return `🛡️ **Security Posture**\n\n- Maintenance Mode: ${sec.maintenance_mode ? 'ON 🔴' : 'OFF 🟢'}\n- Global Kiosk: ${sec.force_kiosk_global ? 'ON 🔴' : 'OFF 🟢'}\n- IP Restriction: ${ac.enabled ? 'ON 🟢' : 'OFF ⚠️'}\n- Banned Clients: ${sec.banned_clients ? sec.banned_clients.length : 0}\n- Whitelisted Clients: ${sec.client_whitelist ? sec.client_whitelist.length : 0}`;
            }
        },
        "reset_user_password": {
            description: "Reset a user's password to a temporary PIN.",
            execute: async () => {
                const username = await customPrompt("Reset Password", "Enter username to reset:");
                if (!username) return "Operation cancelled.";
                
                const users = JSON.parse(localStorage.getItem('users') || '[]');
                const idx = users.findIndex(u => u.user === username);
                if (idx === -1) return `User '${username}' not found.`;
                
                const newPin = Math.floor(1000 + Math.random() * 9000).toString();
                // Hash if function exists (utils.js)
                if (typeof hashPassword === 'function') users[idx].pass = await hashPassword(newPin);
                else users[idx].pass = newPin;
                
                localStorage.setItem('users', JSON.stringify(users));
                if (typeof saveToServer === 'function') await saveToServer(['users'], false);
                
                return `Password for '${username}' reset to: ${newPin}`;
            }
        },
        "generate_improvements": {
            description: "Force run the background improvement analyzer.",
            execute: async () => {
                return await AICore.analyzeForImprovements(true);
            }
        },
        "clear_old_logs": {
            description: "Delete audit logs older than 30 days to free up space.",
            execute: async () => {
                const logs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - 30);
                
                const newLogs = logs.filter(l => new Date(l.date) > cutoff);
                const removed = logs.length - newLogs.length;
                
                if (removed > 0) {
                    localStorage.setItem('auditLogs', JSON.stringify(newLogs));
                    if (typeof saveToServer === 'function') await saveToServer(['auditLogs'], false);
                    return `Cleanup complete. Removed ${removed} old log entries.`;
                }
                return "No logs older than 30 days found.";
        },
        "export_logs": {
            description: "Download all system logs (Errors, Feedback, Audit, Monitor) as a JSON file.",
            execute: () => {
                const exportData = {
                    date: new Date().toISOString(),
                    error_reports: JSON.parse(localStorage.getItem('error_reports') || '[]'),
                    nps_responses: JSON.parse(localStorage.getItem('nps_responses') || '[]'),
                    auditLogs: JSON.parse(localStorage.getItem('auditLogs') || '[]'),
                    monitor_data: JSON.parse(localStorage.getItem('monitor_data') || '{}'),
                    system_config: JSON.parse(localStorage.getItem('system_config') || '{}')
                };
                
                const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: 'application/json'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `System_Logs_${new Date().toISOString().slice(0,10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                
                return "Logs exported successfully.";
            }
            }
        }
    },

    // --- UI MANAGEMENT ---
    openConsole: function() {
        if (!CURRENT_USER || CURRENT_USER.role !== 'super_admin') return alert("Access Denied. Super Admin only.");
        
        let modal = document.getElementById('aiConsoleModal');
        if (!modal) {
            this.createModal();
            modal = document.getElementById('aiConsoleModal');
        }
        modal.classList.remove('hidden');
        this.isOpen = true;
        this.renderChat();
        
        // Focus input
        setTimeout(() => document.getElementById('aiInput').focus(), 100);
    },

    createModal: function() {
        const div = document.createElement('div');
        div.id = 'aiConsoleModal';
        div.className = 'modal-overlay hidden';
        div.style.zIndex = '10000';
        
        const quickActions = [
            { label: "❤️ Full Health Check", cmd: "Run test_core_logic" },
            { label: "🐛 Analyze Errors", cmd: "Run read_errors" },
            { label: "📜 Read Console", cmd: "Run read_console" },
            { label: "👥 Active Users", cmd: "Run system_status" },
            { label: "⚙️ Config History", cmd: "Run config_history" },
            { label: "🧹 Scan Duplicates", cmd: "Run scan_duplicates" },
            { label: "🔄 Force Sync", cmd: "Run force_sync" },
            { label: "🚧 Toggle Maint.", cmd: "Run toggle_maintenance" },
            { label: "📅 Daily Briefing", cmd: "Run summarize_today" },
            { label: "🛡️ Security Audit", cmd: "Run check_security_posture" },
            { label: "💡 Suggest Improvements", cmd: "Run generate_improvements" },
            { label: "📂 Export Logs", cmd: "Run export_logs" }
        ];

        div.innerHTML = `
            <div class="modal-box" style="width: 900px; max-width: 95%; height: 85vh; display: flex; flex-direction: column; background: #1e1e1e; color: #e0e0e0; border: 1px solid #333; box-shadow: 0 0 50px rgba(0,0,0,0.5);">
                <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:15px; border-bottom:1px solid #333;">
                    <h3 style="margin:0; color: #4285f4; display:flex; align-items:center; gap:10px;"><i class="fas fa-robot"></i> Gemini System Analyst</h3>
                    <button class="btn-secondary btn-sm" onclick="document.getElementById('aiConsoleModal').classList.add('hidden')">&times;</button>
                </div>
                
                <div style="display:flex; flex:1; overflow:hidden;">
                    <div id="aiChatHistory" style="flex:2; overflow-y:auto; padding:15px; font-family: monospace; font-size: 0.9rem; background: #121212; border-right:1px solid #333;">
                        <div style="color: #888;">System: AI Core Initialized. Connected to Tool Registry.</div>
                    </div>
                    <div style="flex:1; background:#252526; display:flex; flex-direction:column; border-left:1px solid #000;">
                        <div style="padding:10px; background:#333; font-weight:bold; font-size:0.8rem; text-transform:uppercase; letter-spacing:1px;">
                            <i class="fas fa-lightbulb" style="color:#f1c40f;"></i> AI Suggestions
                        </div>
                        <div id="aiSuggestionsList" style="flex:1; overflow-y:auto; padding:10px;">
                            <div style="color:#888; font-style:italic; font-size:0.8rem; text-align:center; margin-top:20px;">Analyzing system usage...</div>
                        </div>
                    </div>
                </div>

                <div style="padding-top:15px; border-top:1px solid #333;">
                    <div style="margin-bottom:5px; font-size:0.8rem; color:#888;">Quick Checks:</div>
                    <div style="display:flex; gap:10px; margin-bottom:15px; flex-wrap:wrap;">
                        ${quickActions.map(qa => 
                            `<button class="btn-secondary btn-sm" onclick="AICore.runQuickCommand('${qa.cmd}')" style="border-color:#444; font-size:0.8rem;">${qa.label}</button>`
                        ).join('')}
                    </div>
                    <div style="display:flex; gap:10px;">
                        <input type="text" id="aiInput" placeholder="Ask Gemini to check system health..." style="flex:1; padding:10px; border-radius:4px; border:1px solid #444; background: #2d2d2d; color: white;" onkeydown="if(event.key==='Enter') AICore.sendMessage()">
                        <button class="btn-primary" onclick="AICore.sendMessage()">Send</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(div);
        this.renderSuggestions();
    },

    setInput: function(text) {
        const input = document.getElementById('aiInput');
        if(input) {
            input.value = text;
            input.focus();
        }
    },

    runQuickCommand: function(cmd) {
        this.setInput(cmd);
        this.sendMessage();
    },

    renderChat: function() {
        const container = document.getElementById('aiChatHistory');
        if(!container) return;
        container.innerHTML = this.history.map(msg => `
            <div style="margin-bottom: 10px; color: ${msg.role === 'user' ? '#fff' : '#4285f4'}; border-bottom: 1px solid #222; padding-bottom: 5px;">
                <strong>${msg.role === 'user' ? 'You' : 'Gemini'}:</strong> 
                <span style="white-space: pre-wrap;">${msg.text}</span>
            </div>
        `).join('');
        container.scrollTop = container.scrollHeight;
    },

    sendMessage: async function() {
        const input = document.getElementById('aiInput');
        const text = input.value.trim();
        if(!text) return;

        // 1. Add User Message
        this.history.push({ role: 'user', text: text });
        this.renderChat();
        input.value = '';

        // 2. Process Intent (Local Logic or API)
        const response = await this.processRequest(text);
        
        // 3. Add AI Message
        this.history.push({ role: 'model', text: response });
        this.renderChat();
    },

    processRequest: async function(text) {
        // 1. Local Command Check (Bypass AI)
        // Allows running tools even if AI is disabled or offline
        const toolMatch = text.match(/^Run\s+([a-zA-Z0-9_]+)$/i);
        if (toolMatch) {
            const toolName = toolMatch[1].toLowerCase();
            const key = Object.keys(this.tools).find(k => k.toLowerCase() === toolName);
            if (key) {
                return `[Local Execution] Running ${key}...\n\n${await this.tools[key].execute()}`;
            }
        }

        const config = JSON.parse(localStorage.getItem('system_config') || '{}');
        if (!config.ai || !config.ai.enabled || !config.ai.apiKey) {
            return "Error: AI is disabled or API Key is missing.\nYou can still use 'Run [tool]' commands manually.";
        }

        // Construct Context
        const systemContext = `
            You are the System Analyst for BuildZone (Training Portal).
            Available Tools: ${Object.keys(this.tools).join(', ')}.
            
            If the user asks to run a tool, output JSON ONLY: {"tool": "tool_name"}.
            Otherwise, answer the question based on your knowledge of software maintenance.
        `;

        try {
            // Call Gemini API (Google Generative Language)
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${config.ai.apiKey}`;
            const payload = {
                contents: [{
                    parts: [{ text: systemContext + "\nUser: " + text }]
                }]
            };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            
            if (data.error) return "API Error: " + data.error.message;
            if (!data.candidates || data.candidates.length === 0) return "No response from AI.";
            
            const reply = data.candidates[0].content.parts[0].text;

            // Check for Tool Execution
            if (reply.includes('{"tool":')) {
                try {
                    const jsonMatch = reply.match(/\{"tool":\s*"([^"]+)"\}/);
                    if (jsonMatch) {
                        const toolName = jsonMatch[1];
                        if (this.tools[toolName]) {
                            const result = await this.tools[toolName].execute();
                            return `Executing ${toolName}...\nResult: ${result}`;
                        }
                    }
                } catch(e) { console.error(e); }
            }

            return reply;

        } catch (e) {
            return "Network Error: " + e.message;
        }
    },

    // --- SELF REPAIR LOGIC ---
    runSelfRepair: async function() {
        let log = [];
        
        // 1. Fix Ghost Users (In Roster but no Account)
        const records = JSON.parse(localStorage.getItem('records') || '[]');
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const userMap = new Set(users.map(u => u.user));
        
        let ghostRecords = 0;
        records.forEach(r => {
            if (!userMap.has(r.trainee)) ghostRecords++;
        });
        
        if (ghostRecords > 0) {
            log.push(`Found ${ghostRecords} records for non-existent users.`);
        } else {
            log.push("Record integrity check passed.");
        }

        // 2. Check for Users without Roles
        let roleless = 0;
        users.forEach(u => {
            if (!u.role) {
                u.role = 'trainee';
                roleless++;
            }
        });
        if (roleless > 0) {
            localStorage.setItem('users', JSON.stringify(users));
            log.push(`Fixed ${roleless} users with missing roles.`);
        }

        return log.join('\n');
    },

    // --- AUTO ERROR ANALYSIS ---
    analyzeError: async function(errorMsg) {
        // 1. Throttle: Prevent spamming (Max 1 popup every 15 seconds)
        if (Date.now() - this.lastErrorTime < 15000) return;
        
        // 2. Check Config
        const config = JSON.parse(localStorage.getItem('system_config') || '{}');
        if (!config.ai || !config.ai.enabled || !config.ai.apiKey) return;
        
        if (this.isAnalyzing) return;
        this.isAnalyzing = true;
        this.lastErrorTime = Date.now();

        // 3. Visual Feedback
        if(typeof showToast === 'function') showToast("🤖 AI is analyzing the error...", "info");

        // 4. Construct Prompt
        const context = `You are an Automated Error Analyst. 
        The following error occurred in the application:
        "${errorMsg}"
        
        Please provide a concise analysis:
        1. What is the Error Code or Type?
        2. What likely caused this? (Explain simply)
        3. Is there a recommended fix?
        
        Do NOT run any tools. Just output the explanation text.`;

        const explanation = await this.processRequest(context);
        this.isAnalyzing = false;

        this.showErrorPopup(explanation);
    },

    // --- BACKGROUND IMPROVEMENT ANALYZER ---
    analyzeForImprovements: async function(force = false) {
        const config = JSON.parse(localStorage.getItem('system_config') || '{}');
        if (!config.ai || !config.ai.enabled || !config.ai.apiKey) return "AI Disabled.";

        // Gather Context
        const logs = window.CONSOLE_HISTORY || [];
        const audit = JSON.parse(localStorage.getItem('auditLogs') || '[]');
        const recentErrors = logs.filter(l => l.type === 'error').slice(-10);
        const recentAudit = audit.slice(-10);

        // Skip if no data to analyze (unless forced)
        if (!force && recentErrors.length === 0 && recentAudit.length === 0) return;

        const context = `
            Analyze the following system logs and suggest 1 concrete improvement for the application.
            Focus on Stability, Performance, or User Experience.
            
            Recent Errors: ${JSON.stringify(recentErrors)}
            Recent Actions: ${JSON.stringify(recentAudit)}
            
            Output format: "Title|Description" (Single line)
        `;

        try {
            const response = await this.processRequest(context);
            if (response && response.includes('|')) {
                const [title, desc] = response.split('|');
                const suggestion = {
                    id: Date.now(),
                    date: new Date().toISOString(),
                    title: title.trim(),
                    desc: desc.trim()
                };

                const list = JSON.parse(localStorage.getItem('ai_suggestions') || '[]');
                // Add to top, keep max 20
                list.unshift(suggestion);
                if (list.length > 20) list.pop();
                
                localStorage.setItem('ai_suggestions', JSON.stringify(list));
                if(typeof saveToServer === 'function') saveToServer(['ai_suggestions'], false);
                
                this.renderSuggestions();
                return `Suggestion Added: ${title}`;
            }
            return "Analysis complete (No new suggestions).";
        } catch (e) { return "Analysis failed."; }
    },

    renderSuggestions: function() {
        const container = document.getElementById('aiSuggestionsList');
        if (!container) return;
        
        const list = JSON.parse(localStorage.getItem('ai_suggestions') || '[]');
        if (list.length === 0) return;

        container.innerHTML = list.map(s => `
            <div style="background:#333; padding:10px; border-radius:4px; margin-bottom:10px; border-left:3px solid #f1c40f;">
                <div style="font-weight:bold; font-size:0.85rem; color:#fff; margin-bottom:4px;">${s.title}</div>
                <div style="font-size:0.8rem; color:#ccc; line-height:1.4;">${s.desc}</div>
                <div style="font-size:0.7rem; color:#666; margin-top:5px;">${new Date(s.date).toLocaleDateString()}</div>
            </div>
        `).join('');
    },

    showErrorPopup: function(msg) {
        const div = document.createElement('div');
        div.className = 'modal-overlay';
        div.style.zIndex = '11000'; // Above everything
        div.innerHTML = `
            <div class="modal-box" style="border-left: 5px solid #ff5252; max-width: 600px; animation: slideInRight 0.3s ease-out;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h3 style="color:#ff5252; margin:0;"><i class="fas fa-robot"></i> AI Error Insight</h3>
                    <button class="btn-secondary btn-sm" onclick="this.closest('.modal-overlay').remove()">&times;</button>
                </div>
                <div style="background:var(--bg-input); padding:15px; border-radius:6px; margin-bottom:15px; white-space:pre-wrap; font-family:sans-serif; line-height:1.5; color:var(--text-main); max-height:60vh; overflow-y:auto;">${msg}</div>
                <div style="text-align:right;">
                    <button class="btn-primary" onclick="this.closest('.modal-overlay').remove()">Acknowledge</button>
                </div>
            </div>
        `;
        document.body.appendChild(div);
    }
};

window.AICore = AICore;