/* ================= TRAINING INSIGHT DASHBOARD ================= */
/* Handles the logic for the "Training Insight" tab.
   - Action Required: Critical/Semi/Improvement alerts.
   - Full Overview: Review & Edit all agents.
   - Agent Progress: Completeness check & Data Integrity.
   - Dept Overview: Placeholder.
*/

let INSIGHT_VIEW_MODE = 'action'; // 'action', 'all', 'progress', 'dept'
let CURRENT_REVIEW_TARGET = null;

// --- HELPER: AVATAR GENERATOR ---
function getAvatarHTML(name) {
    if(!name) return '';
    const initials = name.substring(0, 2).toUpperCase();
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    const color = "#" + "00000".substring(0, 6 - c.length) + c;
    return `<div style="width:32px; height:32px; border-radius:50%; background:${color}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:0.8rem; font-weight:bold; margin-right:10px; flex-shrink:0; box-shadow:0 2px 4px rgba(0,0,0,0.1);">${initials}</div>`;
}

// --- HELPER: ASYNC SAVE ---
// Ensures reviews and exemptions are saved to server (Supabase) before UI updates.
async function secureInsightSave() {
    const includeUserAccess = arguments.length > 0 ? Boolean(arguments[0]) : false;
    // MODIFIED: Removed 'autoBackup' check.
    // Admin reviews, status overrides, and access revocations are critical actions.
    // They must always sync to the cloud immediately to maintain system integrity.
    if (typeof saveToServer === 'function') {
        try {
            // PARAMETER 'true' = FORCE OVERWRITE (Instant)
            const keys = ['insightReviews', 'exemptions'];
            if (includeUserAccess) keys.push('users', 'revokedUsers');
            await saveToServer(keys, true); 
        } catch(e) {
            console.error("Insight Cloud Sync Error:", e);
        }
    }
}

// --- HELPER: CENTRALIZED REQUIREMENTS ---
function getRequiredItems() {
    const assessments = JSON.parse(localStorage.getItem('assessments') || '[]');
    const topics = JSON.parse(localStorage.getItem('vettingTopics') || '[]');
    
    let items = [];
    
    // 1. Standard Assessments
    assessments.forEach(a => {
        if(!a.name.toLowerCase().includes("vetting test")) {
            items.push({ name: a.name, type: 'assessment' });
        }
    });

    // 2. Vetting Sub-Tests
    topics.forEach(t => {
        if (!t.toLowerCase().includes('vetting')) {
            items.push({ name: `1st Vetting - ${t}`, type: 'vetting' });
            items.push({ name: `Final Vetting - ${t}`, type: 'vetting' });
        }
    });

    // 3. Misc Items
    items.push({ name: "Onboard Report", type: 'report' });
    items.push({ name: "Insight Review", type: 'review' });

    // SORT
    items.sort((a, b) => {
        const typeOrder = { 'assessment': 1, 'report': 2, 'review': 2, 'vetting': 3 };
        return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
    });

    return items;
}

// Main entry point
function renderInsightDashboard() {
    // 1. Update Top Stats
    if(typeof calculateKPIs === 'function') calculateKPIs();

    // 2. Populate Header Dropdown
    populateInsightGroupFilter();
    
    // 3. Get the Grid Container
    const grid = document.getElementById('insightGrid');
    if(!grid) return;

    // === VISUAL LAYOUT RESET ===
    grid.className = ''; 
    grid.style.display = 'block'; 
    
    // TEAM LEADER RESTRICTION: Force 'all' view
    if (CURRENT_USER.role === 'teamleader') {
        INSIGHT_VIEW_MODE = 'all';
    }

    // 4. Render Sub-Navigation
    const navHTML = `
        <div class="admin-sub-nav" style="margin-bottom:15px; border-bottom:1px solid var(--border-color); display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <div style="display:flex; gap:10px;">
                <button class="sub-tab-btn ${INSIGHT_VIEW_MODE === 'action' ? 'active' : ''}" onclick="switchInsightView('action')" aria-label="View Action Required">
                    <i class="fas fa-exclamation-circle"></i> Action Required
                </button>
                <button class="sub-tab-btn ${INSIGHT_VIEW_MODE === 'all' ? 'active' : ''}" onclick="switchInsightView('all')" aria-label="View Full Overview">
                    <i class="fas fa-list"></i> Full Overview
                </button>
                <button class="sub-tab-btn ${INSIGHT_VIEW_MODE === 'progress' ? 'active' : ''}" onclick="switchInsightView('progress')" aria-label="View Agent Progress">
                    <i class="fas fa-tasks"></i> Agent Progress
                </button>
                <button class="sub-tab-btn ${INSIGHT_VIEW_MODE === 'dept' ? 'active' : ''}" onclick="switchInsightView('dept')" aria-label="View Department Overview">
                    <i class="fas fa-building"></i> Dept Overview
                </button>
            </div>
            <div style="margin-left:auto; position:relative;" class="${INSIGHT_VIEW_MODE === 'dept' ? 'hidden' : ''}">
                <i class="fas fa-search" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--text-muted); font-size:0.8rem;"></i>
                <input type="text" id="insightSearchInput" placeholder="Filter Agents..." onkeyup="filterInsightCards()" style="padding:6px 10px 6px 30px; border-radius:20px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-main); width:200px; font-size:0.85rem;">
            </div>
        </div>
    `;

    // Hide Nav for TL
    let finalNavHTML = navHTML;
    if (CURRENT_USER.role === 'teamleader') {
        finalNavHTML = `<div style="margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:10px;"><strong>Full Overview</strong></div>`;
    }

    // 5. Get Current Filter
    const filterSelect = document.getElementById('insightGroupFilter');
    const currentFilterVal = filterSelect ? filterSelect.value : '';

    if(!currentFilterVal || currentFilterVal === 'Loading...') {
        grid.innerHTML = finalNavHTML + '<div style="text-align:center; padding:40px; color:var(--text-muted);"><i class="fas fa-arrow-up" style="margin-bottom:10px;"></i><br>Please select a Training Group from the top-right dropdown.</div>';
        return;
    }

    if(INSIGHT_VIEW_MODE === 'dept') {
        if (typeof AnalyticsEngine !== 'undefined' && typeof AnalyticsEngine.renderDepartmentDashboard === 'function') {
            AnalyticsEngine.renderDepartmentDashboard(grid, finalNavHTML, currentFilterVal);
        } else {
            grid.innerHTML = finalNavHTML + `
                <div style="text-align:center; padding:50px; background:var(--bg-card); border:1px dashed var(--border-color); border-radius:12px; margin-top:20px;">
                    <i class="fas fa-spinner fa-spin" style="font-size:3rem; color:var(--primary); margin-bottom:15px;"></i>
                    <h3>Loading Analytics...</h3>
                </div>`;
        }
        return;
    }

    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    let members = rosters[currentFilterVal] || [];

    // FIX: Filter out empty entries/nulls to prevent "ghost" cards
    members = members.filter(m => m && m.trim() !== "");

    // Sort members alphabetically
    members.sort(); 

    if(members.length === 0) {
        grid.innerHTML = finalNavHTML + '<p style="color:var(--text-muted); padding:20px;">No members found in this group.</p>';
        return;
    }

    // Render the specific view
    if(INSIGHT_VIEW_MODE === 'progress') {
        renderProgressView(members, currentFilterVal, grid, finalNavHTML);
    } else {
        renderStandardView(members, currentFilterVal, grid, finalNavHTML);
    }
}

function calculateKPIs() {
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    
    if(document.getElementById('kpi-total-trainees')) {
        document.getElementById('kpi-total-trainees').innerText = users.filter(u => u.role === 'trainee').length;
        document.getElementById('kpi-active-groups').innerText = Object.keys(rosters).length;
        
        let totalScore = 0;
        records.forEach(r => totalScore += parseInt(r.score || 0));
        const avg = records.length > 0 ? Math.round(totalScore / records.length) : 0;
        document.getElementById('kpi-avg-score').innerText = avg + "%";
        
        const pending = submissions.filter(s => s.status === 'pending_review' || s.status === 'pending').length;
        document.getElementById('kpi-pending-reviews').innerText = pending;
    }
}

function switchInsightView(mode) {
    INSIGHT_VIEW_MODE = mode;
    renderInsightDashboard();
}

// --- NEW: CLIENT-SIDE FILTERING ---
function filterInsightCards() {
    const input = document.getElementById('insightSearchInput');
    if(!input) return;
    const filter = input.value.toLowerCase();
    const cards = document.querySelectorAll('.insight-card, .completeness-card');
    
    cards.forEach(card => {
        const name = card.getAttribute('data-search') || '';
        card.style.display = name.includes(filter) ? '' : 'none';
    });
}

// --- STANDARD VIEWS (Action & All) - COMPACT MODE ---

function renderStandardView(members, filter, grid, navHTML) {
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const reviews = JSON.parse(localStorage.getItem('insightReviews') || '[]');
    
    // OPTIMIZATION: Pre-index records and reviews by trainee
    const recordsMap = {};
    records.forEach(r => {
        if (!r.trainee) return;
        const t = r.trainee;
        if (!recordsMap[t]) recordsMap[t] = [];
        recordsMap[t].push(r);
    });

    const reviewsMap = {};
    reviews.forEach(r => {
        reviewsMap[r.trainee] = r;
    });

    let cardsHTML = '';
    let count = 0;

    members.forEach(trainee => {
        // UPDATED: Inclusive Group Filter using Map
        const allTraineeRecords = recordsMap[trainee] || [];
        const validGroups = [filter, 'Live-Session', 'Digital-Assessment', 'Manual-Upload', 'Unknown'];
        const traineeRecords = allTraineeRecords.filter(r => validGroups.includes(r.groupID) || !r.groupID);
        
        const review = reviewsMap[trainee];
        
        let cycleLabel = "New Onboard";
        if(typeof getTraineeCycle === 'function') {
            cycleLabel = getTraineeCycle(trainee, filter);
        }

        let statusObj = null;

        if (review) {
            // CHECK FOR STALE REVIEW (New Data vs Review Date)
            const reviewTime = new Date(review.date).getTime();
            let isStale = false;

            // Check if any record is NEWER than the review
            const hasNewer = traineeRecords.some(r => {
                // 1. Try ID Timestamp (Precision)
                if (r.id && r.id.includes('_')) {
                    const ts = parseInt(r.id.split('_')[0]);
                    if (!isNaN(ts) && ts > reviewTime) return true;
                }
                // 2. Fallback to Date String (Day Level)
                if (r.date && review.date) {
                    return r.date > review.date.split('T')[0];
                }
                return false;
            });

            if (hasNewer) {
                // Review is outdated -> Revert to Auto-Calc
                statusObj = calculateAgentStatus(traineeRecords);
                // Append note about new data
                statusObj.comment = `[New Data Arrived] Previous: ${review.comment || ''}`;
            } else {
                // Review is current -> Use Manual Status but REFRESH failure list
                statusObj = { status: review.status, failedItems: [], isManual: true, comment: review.comment };
                statusObj.failedItems = calculateAgentStatus(traineeRecords).failedItems;
            }
        } else {
            statusObj = calculateAgentStatus(traineeRecords);
        }

        let shouldRender = false;
        if (INSIGHT_VIEW_MODE === 'action') {
            if (statusObj.status !== 'Pass') shouldRender = true;
        } else {
            shouldRender = true;
        }

        if (shouldRender) {
            count++;
            cardsHTML += buildInsightCard(trainee, filter, statusObj, cycleLabel);
        }
    });

    if(count === 0) {
        const emptyMsg = INSIGHT_VIEW_MODE === 'action' ? 'No agents of concern found.' : 'No records found.';
        grid.innerHTML = navHTML + `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);"><i class="fas fa-check-circle" style="font-size:3rem; color:#27ae60; margin-bottom:15px;"></i><br>${emptyMsg}</div>`;
    } else {
        // Use 'compact-grid' class for tighter layout
        grid.innerHTML = navHTML + `<div id="group-stats-container"></div>` + `<div class="insight-grid compact-grid" style="margin-top:15px;">${cardsHTML}</div>`;
        
        // Inject Group Analytics
        if (typeof AnalyticsEngine !== 'undefined' && typeof AnalyticsEngine.renderGroupDashboard === 'function') {
            const statsContainer = document.getElementById('group-stats-container');
            if(statsContainer) AnalyticsEngine.renderGroupDashboard(statsContainer, filter);
        }
    }
}

// --- PROGRESS / BREAKDOWN VIEW (Merged with Revoke Logic) ---

function renderProgressView(members, filter, grid, navHTML) {
    const records = JSON.parse(localStorage.getItem('records') || '[]');
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    const reports = JSON.parse(localStorage.getItem('savedReports') || '[]');
    const reviews = JSON.parse(localStorage.getItem('insightReviews') || '[]');
    const exemptions = JSON.parse(localStorage.getItem('exemptions') || '[]');
    // Load users to check login status
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    
    // OPTIMIZATION: Pre-index data
    const recordsMap = {};
    records.forEach(r => { if(r.trainee) { if(!recordsMap[r.trainee]) recordsMap[r.trainee] = []; recordsMap[r.trainee].push(r); } });

    const submissionsMap = {};
    submissions.forEach(s => { if(s.trainee) { if(!submissionsMap[s.trainee]) submissionsMap[s.trainee] = []; submissionsMap[s.trainee].push(s); } });

    const reportsMap = {};
    reports.forEach(r => { if(r.trainee) reportsMap[r.trainee] = r; });

    const reviewsMap = {};
    reviews.forEach(r => { if(r.trainee) reviewsMap[r.trainee] = r; });

    const exemptionsMap = {};
    exemptions.forEach(e => { if(e.trainee) { if(!exemptionsMap[e.trainee]) exemptionsMap[e.trainee] = []; exemptionsMap[e.trainee].push(e); } });

    const usersMap = new Set(users.map(u => u.user));

    // --- FIX: Define isAdmin HERE so it is accessible in the entire function ---
    let isAdmin = false;
    try { 
        if(typeof hasPermission === 'function') {
            isAdmin = hasPermission('admin.manage_roster');
        } else {
            // Fallback if auth.js helper is missing or not loaded yet
            isAdmin = (CURRENT_USER && CURRENT_USER.role === 'admin');
        }
    } catch(e) { 
        isAdmin = (CURRENT_USER && CURRENT_USER.role === 'admin'); 
    }
    // -------------------------------------------------------------------------
    
    // Build Required List dynamically using Helper
    const requiredItems = getRequiredItems();

    let html = '<div style="margin-top:15px; display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:20px;">';

    members.forEach(trainee => {
        // UPDATED: Inclusive Record Fetching
        const validGroups = [filter, 'Live-Session', 'Digital-Assessment', 'Manual-Upload', 'Unknown'];
        const allTraineeRecords = recordsMap[trainee] || [];
        const myRecords = allTraineeRecords.filter(r => validGroups.includes(r.groupID) || !r.groupID);
        
        const mySubs = submissionsMap[trainee] || [];
        const myReport = reportsMap[trainee];
        const myReview = reviewsMap[trainee];
        const myExempts = (exemptionsMap[trainee] || []).filter(e => e.groupID === filter).map(e => e.item);

        // Check login status
        const hasLogin = usersMap.has(trainee);

        let completedCount = 0;
        let itemsHTML = '';

        requiredItems.forEach(req => {
            let status = 'missing'; 
            let itemName = req.name;

            if (myExempts.includes(itemName)) {
                status = 'exempt';
            } else {
                if (req.type === 'report') {
                    if (myReport) status = 'completed';
                } 
                else if (req.type === 'review') {
                    if (myReview) status = 'completed';
                }
                else {
                    // Check Records (Exact Match first, then fuzzy)
                    // UPDATED: Robust check for Vetting items that might have variable naming
                    const match = myRecords.find(r => {
                        if (r.assessment === itemName) return true;
                        if (req.type === 'vetting' && r.assessment.toLowerCase().includes(itemName.toLowerCase().replace('1st vetting - ', '').replace('final vetting - ', ''))) return true;
                        return false;
                    });
                    if (match) status = 'completed';
                    
                    if (status !== 'completed') {
                        // Check Submissions (Digital)
                        const subMatch = mySubs.find(s => {
                            if (s.testTitle === itemName && s.status === 'completed') return true;
                            return req.type === 'vetting' && s.testTitle.toLowerCase().includes(itemName.toLowerCase().replace('1st vetting - ', '').replace('final vetting - ', '')) && s.status === 'completed';
                        });
                        if (subMatch) status = 'completed';
                    }
                }
            }

            if (status !== 'missing') completedCount++;

            let icon = status === 'completed' ? '<i class="fas fa-check-circle" style="color:#27ae60;"></i>' : 
                       (status === 'exempt' ? '<i class="fas fa-ban" style="color:#95a5a6;"></i>' : '<i class="fas fa-times-circle" style="color:#ff5252;"></i>');
            
            // Only allow admins to toggle exemption
            let btnAction = '';

            if(isAdmin) {
                btnAction = status === 'exempt' 
                ? `<button class="btn-na" onclick="toggleExemption('${trainee}', '${filter}', '${itemName}', false)" aria-label="Un-Exempt ${itemName} for ${trainee}">Un-Exempt</button>`
                : `<button class="btn-na" onclick="toggleExemption('${trainee}', '${filter}', '${itemName}', true)" aria-label="Mark ${itemName} N/A for ${trainee}">Mark N/A</button>`;
            }

            itemsHTML += `
                <div class="checklist-item ${status}">
                    <div style="display:flex; align-items:center;">
                        <div class="item-status-icon">${icon}</div>
                        <span style="font-size:0.8rem;">${itemName}</span>
                    </div>
                    ${status === 'completed' ? '' : btnAction}
                </div>`;
        });

        const progress = requiredItems.length > 0 ? Math.round((completedCount / requiredItems.length) * 100) : 0;

        // NEW: Revoke Button Logic (Now isAdmin is defined)
        let revokeBtnHTML = '';
        if (progress === 100 && hasLogin && isAdmin) {
            revokeBtnHTML = `
                <div style="margin-top:15px; padding-top:15px; border-top:1px dashed var(--border-color); text-align:center;">
                    <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:5px;">Training Complete</p>
                    <button class="btn-success btn-sm" style="width:100%;" onclick="graduateTrainee('${trainee}')">
                        <i class="fas fa-graduation-cap"></i> Graduate Trainee (Retire & Archive)
                    </button>
                </div>
            `;
        } else if (!hasLogin) {
            revokeBtnHTML = `<div style="margin-top:10px; font-size:0.8rem; color:#27ae60; text-align:center;"><i class="fas fa-check"></i> Access Revoked (Graduated)</div>`;
        }

        const avatar = getAvatarHTML(trainee);

        html += `
        <div class="completeness-card" data-search="${trainee.toLowerCase()}" style="margin-bottom:0; transition: transform 0.2s;">
            <div style="display:flex; align-items:center; margin-bottom:10px;">
                ${avatar}
                <div style="flex:1;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h3 style="margin:0; font-size:1rem;">${trainee}</h3>
                        <span style="font-weight:bold; font-size:0.85rem; color:${progress==100?'#27ae60':'var(--primary)'};">${progress}%</span>
                    </div>
                    <div class="progress-track" style="height:6px; margin-top:5px;"><div class="progress-fill" style="width:${progress}%;"></div></div>
                </div>
            </div>
            
            <div class="checklist-container" style="display:none;" id="check_${trainee.replace(/\s/g,'')}">
                ${itemsHTML}
                ${revokeBtnHTML}
            </div>
            
            <button class="btn-secondary btn-sm" style="width:100%; margin-top:5px; background:transparent; border:1px dashed var(--border-color); color:var(--text-muted);" onclick="toggleChecklist('check_${trainee.replace(/\s/g,'')}')" aria-label="Toggle Details for ${trainee}">
                <i class="fas fa-chevron-down"></i> Show Details
            </button>
        </div>`;
    });

    html += '</div>';
    grid.innerHTML = navHTML + `<div id="group-stats-container"></div>` + html;

    // Inject Group Analytics
    if (typeof AnalyticsEngine !== 'undefined' && typeof AnalyticsEngine.renderGroupDashboard === 'function') {
        const statsContainer = document.getElementById('group-stats-container');
        if(statsContainer) AnalyticsEngine.renderGroupDashboard(statsContainer, filter);
    }
}

function toggleChecklist(id) {
    const el = document.getElementById(id);
    if(el.style.display === 'none') el.style.display = 'grid';
    else el.style.display = 'none';
}

async function toggleExemption(trainee, group, item, isExempt) {
    let exemptions = JSON.parse(localStorage.getItem('exemptions') || '[]');
    if (isExempt) {
        exemptions.push({ trainee, groupID: group, item });
    } else {
        exemptions = exemptions.filter(e => !(e.trainee === trainee && e.groupID === group && e.item === item));
    }
    localStorage.setItem('exemptions', JSON.stringify(exemptions));
    
    await secureInsightSave();
    renderInsightDashboard(); 
}

// --- LOGIC ENGINE (Shared) ---

function calculateAgentStats(traineeName, records) {
    const exemptions = JSON.parse(localStorage.getItem('exemptions') || '[]');
    const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
    const reports = JSON.parse(localStorage.getItem('savedReports') || '[]');
    const reviews = JSON.parse(localStorage.getItem('insightReviews') || '[]');
    
    // Use Helper
    const requiredItems = getRequiredItems();

    let completedCount = 0;
    
    requiredItems.forEach(req => {
        const itemName = req.name;
        // Check Exemptions
        const isExempt = exemptions.some(e => e.trainee === traineeName && e.item === itemName);
        if(isExempt) {
            completedCount++;
            return;
        }

        let isDone = false;
        
        if (req.type === 'report') {
            if (reports.some(r => r.trainee === traineeName)) isDone = true;
        } 
        else if (req.type === 'review') {
            if (reviews.some(r => r.trainee === traineeName)) isDone = true;
        }
        else {
             // Check Records
             if (records.some(r => {
                 if (r.assessment === itemName) return true;
                 if (req.type === 'vetting' && r.assessment.toLowerCase().includes(itemName.toLowerCase().replace('1st vetting - ', '').replace('final vetting - ', ''))) return true;
                 return false;
             })) isDone = true;

             // Check Digital Subs
             if (!isDone && submissions.some(s => {
                 if (s.trainee === traineeName && s.status === 'completed') {
                     if (s.testTitle === itemName) return true;
                     if (req.type === 'vetting' && s.testTitle.toLowerCase().includes(itemName.toLowerCase().replace('1st vetting - ', '').replace('final vetting - ', ''))) return true;
                 }
                 return false;
             })) isDone = true;
        }
        
        if(isDone) completedCount++;
    });

    const progress = requiredItems.length > 0 ? Math.round((completedCount / requiredItems.length) * 100) : 0;
    
    return {
        progress,
        totalRequired: requiredItems.length,
        completedCount
    };
}

function calculateAgentStatus(records) {
    let failedCritical = [];
    let failedSemi = [];
    let failedImprove = [];
    
    // LOGIC FIX: If no records exist, status is Pending, not Pass
    if (!records || records.length === 0) return { status: 'Pending', failedItems: [] };

    const limit = (typeof IMPROVE !== 'undefined') ? IMPROVE : 80;

    // NEW: Deduplicate by Assessment Name (Keep Highest Score)
    // This ensures that if a trainee retakes a test and passes, the old failure is ignored.
    const bestScores = {};
    records.forEach(r => {
        if (!r.assessment) return;
        const key = r.assessment.trim().toLowerCase();
        if (!bestScores[key] || r.score > bestScores[key].score) {
            bestScores[key] = r;
        }
    });

    Object.values(bestScores).forEach(r => {
        if (r.score < limit) {
            const name = r.assessment;
            if (typeof INSIGHT_CONFIG !== 'undefined') {
                if (INSIGHT_CONFIG.CRITICAL.some(k => name.includes(k))) failedCritical.push(`${name} (${r.score}%)`);
                else if (INSIGHT_CONFIG.SEMI_CRITICAL.some(k => name.includes(k))) failedSemi.push(`${name} (${r.score}%)`);
                else failedImprove.push(`${name} (${r.score}%)`);
            } else {
                failedImprove.push(`${name} (${r.score}%)`);
            }
        }
    });

    if (failedCritical.length > 0) return { status: 'Critical', failedItems: [...failedCritical, ...failedSemi, ...failedImprove] };
    else if (failedSemi.length > 0) return { status: 'Semi-Critical', failedItems: [...failedSemi, ...failedImprove] };
    else if (failedImprove.length > 0) return { status: 'Improvement', failedItems: failedImprove };
    else return { status: 'Pass', failedItems: [] };
}

// --- UI BUILDER (Shared) ---

function buildInsightCard(name, group, data, cycle) {
    let borderClass = '', badgeClass = '', badgeText = data.status;

    switch(data.status) {
        case 'Critical': case 'Fail': borderClass = 'status-critical'; badgeClass = 'badge-critical'; break;
        case 'Semi-Critical': borderClass = 'status-semi'; badgeClass = 'badge-semi'; break;
        case 'Improvement': borderClass = 'status-improve'; badgeClass = 'badge-improve'; break;
        case 'Pending': borderClass = 'status-pending'; badgeClass = 'badge-secondary'; break; // NEW
        default: borderClass = ''; badgeClass = 'badge-success';
    }

    let failListHTML = '';
    if (data.failedItems.length > 0) {
        failListHTML = '<div class="fail-list">' + data.failedItems.map(item => {
            const parts = item.match(/(.*)\s\((\d+(\.\d+)?)%\)/);
            return parts ? `<div class="fail-item"><span>${parts[1]}</span><span class="fail-score">${parts[2]}%</span></div>` : `<div class="fail-item"><span>${item}</span></div>`;
        }).join('') + '</div>';
    } else {
        failListHTML = '<div class="fail-list" style="color:var(--text-muted); text-align:center;">No failures recorded.</div>';
    }

    const manualTag = data.isManual ? '<i class="fas fa-user-edit" style="color:var(--primary); margin-left:5px;" title="Manual Override"></i>' : '';
    const commentBlock = data.comment ? `<div style="font-size:0.75rem; background:var(--bg-input); padding:5px; margin-top:5px; border-radius:4px; font-style:italic;">"${data.comment}"</div>` : '';
    
    let cycleBadge = (cycle && cycle.includes("Retrain")) 
        ? `<span style="background:rgba(255, 82, 82, 0.2); color:#ff5252; padding:1px 4px; border-radius:3px; font-size:0.7rem; margin-left:5px; border:1px solid #ff5252;">${cycle}</span>`
        : ``;

    const btnText = data.isManual ? 'Edit' : 'Review';
    
    let canReview = true;
    try { canReview = hasPermission('test.grade') || hasPermission('records.edit'); } catch(e) {}

    const actionBtn = canReview 
        ? `<div class="insight-actions" style="margin-top:10px;"><button class="btn-primary btn-sm" onclick="openInsightReview('${name}')" aria-label="${btnText} for ${name}">${btnText}</button></div>`
        : ``;

    const avatar = getAvatarHTML(name);

    return `
    <div class="insight-card ${borderClass}" data-search="${name.toLowerCase()}" style="transition: transform 0.2s, box-shadow 0.2s;">
        <div class="insight-header" style="margin-bottom:10px; display:flex; align-items:center;">
            ${avatar}
            <div style="flex:1; min-width:0;">
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <h3 class="insight-name" style="font-size:1rem; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</h3>
                    <div class="${badgeClass}" style="font-size:0.7rem; padding:2px 6px; margin-left:5px; flex-shrink:0;">${badgeText}</div>
                </div>
                <div style="display:flex; align-items:center; gap:5px; margin-top:2px;">
                    <div class="insight-group" style="font-size:0.75rem; color:var(--text-muted);">${group}</div>
                    ${cycleBadge} ${manualTag}
                </div>
            </div>
        </div>
        
        <div style="background:var(--bg-input); border-radius:6px; padding:8px; margin-top:10px;">
            <details>
                <summary style="cursor:pointer; font-size:0.8rem; color:var(--text-muted); font-weight:600; list-style:none; display:flex; justify-content:space-between; align-items:center;">
                    <span>Issues / Notes</span>
                    <i class="fas fa-chevron-down" style="font-size:0.7rem;"></i>
                </summary>
                <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border-color);">
                    ${failListHTML}${commentBlock}
                </div>
            </details>
        </div>
        ${actionBtn}
    </div>`;
}

// --- FILTERS & INTERACTION ---

function populateInsightGroupFilter() {
    const sel = document.getElementById('insightGroupFilter');
    if(!sel) return; 
    
    // FOCUS PROTECTION: Don't update if user is interacting with the dropdown
    if(document.activeElement === sel) return;

    const currentVal = sel.value;

    const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
    const groups = Object.keys(rosters).sort().reverse();
    
    // Rebuild options (allows new groups to appear from Cloud Sync)
    sel.innerHTML = '';

    if(groups.length === 0) {
        sel.add(new Option("-- No Groups Found --", ""));
        return;
    }

    groups.forEach(g => {
        const label = (typeof getGroupLabel === 'function') ? getGroupLabel(g, rosters[g].length) : g;
        sel.add(new Option(label, g));
    });
    
    // Restore previous selection if valid, or default to first
    if(currentVal && groups.includes(currentVal)) {
        sel.value = currentVal;
    } else if(groups.length > 0) {
        sel.value = groups[0];
    }
}

// --- REVIEW MODAL ---

function openInsightReview(traineeName) {
    CURRENT_REVIEW_TARGET = traineeName;
    
    let modal = document.getElementById('insightReviewModal');
    if(!modal) {
        const div = document.createElement('div');
        div.id = 'insightReviewModal';
        div.className = 'modal-overlay hidden';
        div.innerHTML = `
        <div class="modal-box">
            <h3>Review Agent: <span id="reviewTargetName"></span></h3>
            <label for="reviewStatus">Override Status</label>
            <select id="reviewStatus">
                <option value="Pass">Pass (Clear)</option>
                <option value="Improvement">Improvement Needed</option>
                <option value="Semi-Critical">Semi-Critical</option>
                <option value="Critical">Critical</option>
            </select>
            <label for="reviewComment">Comments / Action Plan</label>
            <textarea id="reviewComment" rows="4"></textarea>
            <div style="display:flex; gap:10px; margin-top:20px;">
                <button class="btn-secondary" onclick="document.getElementById('insightReviewModal').classList.add('hidden')">Cancel</button>
                <button class="btn-primary" onclick="submitInsightReview()">Save Review</button>
            </div>
        </div>`;
        document.body.appendChild(div);
        modal = div;
    }

    document.getElementById('reviewTargetName').innerText = traineeName;
    document.getElementById('reviewStatus').value = 'Improvement'; 
    document.getElementById('reviewComment').value = '';
    
    const reviews = JSON.parse(localStorage.getItem('insightReviews') || '[]');
    const existing = reviews.find(r => r.trainee === traineeName);
    if(existing) {
        document.getElementById('reviewStatus').value = existing.status;
        document.getElementById('reviewComment').value = existing.comment;
    }
    modal.classList.remove('hidden');
}

async function submitInsightReview() {
    if(!CURRENT_REVIEW_TARGET) return;
    const status = document.getElementById('reviewStatus').value;
    const comment = document.getElementById('reviewComment').value;
    
    let reviews = JSON.parse(localStorage.getItem('insightReviews') || '[]');
    reviews = reviews.filter(r => r.trainee !== CURRENT_REVIEW_TARGET);
    reviews.push({ trainee: CURRENT_REVIEW_TARGET, status: status, comment: comment, date: new Date().toISOString() });
    
    localStorage.setItem('insightReviews', JSON.stringify(reviews));
    
    const btn = document.activeElement; 
    let originalText = "";
    if(btn && btn.tagName === 'BUTTON') {
        originalText = btn.innerText;
        btn.innerText = "Saving...";
        btn.disabled = true;
    }

    await secureInsightSave();

    if(btn && btn.tagName === 'BUTTON') {
        btn.innerText = originalText;
        btn.disabled = false;
    }

    document.getElementById('insightReviewModal').classList.add('hidden');
    renderInsightDashboard(); 
}

// --- NEW: REVOKE ACCESS FUNCTION (With Blacklist) ---
async function revokeUserAccess(username) {
    if(!confirm(`Are you sure you want to revoke login access for ${username}?\n\nThis will delete their login credentials. Their training history (records) will be preserved.`)) return;
    
    // 1. ADD TO BLACKLIST
    let revoked = JSON.parse(localStorage.getItem('revokedUsers') || '[]');
    const toToken = (value) => String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s+/g, '');
    const targetToken = toToken(username);

    if(!revoked.some(entry => toToken(entry) === targetToken)) {
        revoked.push(username);
        localStorage.setItem('revokedUsers', JSON.stringify(revoked));
    }

    // 2. DELETE USER
    let users = JSON.parse(localStorage.getItem('users') || '[]');
    const initialLength = users.length;
    
    users = users.filter(u => toToken(u && (u.user || u.username)) !== targetToken);
    
    if(users.length === initialLength) {
        alert("User not found in login database (already removed?).");
        return;
    }
    
    localStorage.setItem('users', JSON.stringify(users));
    
    // 3. FORCE SAVE (Instant)
    const btn = document.activeElement;
    if(btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

    await secureInsightSave(true);
    
    if(btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-ban"></i>'; }
    
    alert(`Access revoked for ${username}. They will not be auto-generated again.`);
    renderInsightDashboard(); 
}
