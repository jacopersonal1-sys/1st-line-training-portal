/* ================= ASSESSMENT CORE ================= */
/* Shared helpers, globals, and utilities for Assessment Engine */

// Safe Global Declarations
if (typeof window.CURRENT_TEST === 'undefined') window.CURRENT_TEST = null;
if (typeof window.USER_ANSWERS === 'undefined') window.USER_ANSWERS = {};
if (typeof window.TEST_TIMER === 'undefined') window.TEST_TIMER = null;
if (typeof window.IS_LIVE_ARENA === 'undefined') window.IS_LIVE_ARENA = false;

// --- HELPER: ASYNC SAVE (CRITICAL FOR EXAMS) ---
async function secureAssessmentSave() {
    if (typeof saveToServer === 'function') {
        const btn = document.activeElement;
        let originalText = "";
        if(btn && btn.tagName === 'BUTTON') {
            originalText = btn.innerText;
            btn.innerText = "Syncing...";
            btn.disabled = true;
        }

        try {
            // PARAMETER 'false' = SAFE MERGE (Prevents overwriting other trainees)
            await saveToServer(['submissions', 'records', 'tests'], false); 
        } catch(e) {
            console.error("Assessment Cloud Sync Error:", e);
            alert("Warning: Could not sync to cloud. Data saved locally.");
        } finally {
            if(btn && btn.tagName === 'BUTTON') {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        }
    }
}

// --- REFERENCE VIEWER (Native Window) ---
function openReferenceViewer(url) {
    if (typeof require !== 'undefined') {
        console.log("Opening Reference via Electron IPC:", url);
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('open-reference-window', url);
    } else {
        console.log("Opening Reference via Window.Open:", url);
        window.open(url, '_blank', 'width=1024,height=768');
    }
}

// --- SHARED RENDERER (Used by Trainee & Live Arena) ---
function renderQuestionInput(q, idx) {
    const savedAns = window.USER_ANSWERS[idx];

    if (q.type === 'text') {
        return `<textarea class="taking-input auto-expand" oninput="autoResize(this)" onchange="recordAnswer(${idx}, this.value)" placeholder="Type your answer here...">${savedAns || ''}</textarea>`;
    }
    
    if (q.type === 'live_practical') {
        return `<div style="padding:20px; text-align:center; color:var(--text-muted); border:1px dashed var(--border-color); border-radius:8px; background:var(--bg-input);"><em>Practical Task - Click <strong>Done</strong> when finished.</em></div>`;
    }
    
    if (q.type === 'matching') {
        const rightOptions = (q.pairs || []).map(p => p.right);
        const shuffledRight = shuffleArray([...rightOptions]); // Randomize right side
        
        let html = '<div style="display:grid; gap:10px;">';
        (q.pairs || []).forEach((p, rowIdx) => {
            const currentVal = (savedAns && savedAns[rowIdx]) ? savedAns[rowIdx] : "";
            html += `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; align-items:center; background:var(--bg-input); padding:10px; border-radius:4px;">
                <div>${p.left}</div>
                <select onchange="updateMatchingAnswer(${idx}, ${rowIdx}, this.value)" style="margin:0;">
                    <option value="">-- Match --</option>
                    ${shuffledRight.map(opt => `<option value="${opt}" ${currentVal === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                </select>
            </div>`;
        });
        html += '</div>';
        return html;
    }

    if (q.type === 'drag_drop' || q.type === 'ranking') {
        const currentOrder = window.USER_ANSWERS[idx];
        return renderRankingList(idx, currentOrder);
    }

    if (q.type === 'matrix') {
        let html = '<div class="table-responsive"><table class="matrix-table" style="width:100%; text-align:center;"><thead><tr><th></th>';
        (q.cols || []).forEach(c => { html += `<th>${c}</th>`; });
        html += '</tr></thead><tbody>';
        
        (q.rows || []).forEach((r, rIdx) => {
            html += `<tr><td style="text-align:left; font-weight:bold;">${r}</td>`;
            (q.cols || []).forEach((c, cIdx) => {
                // Loose equality (==) to handle string/number mismatch from JSON
                const isChecked = (savedAns && savedAns[rIdx] != null && savedAns[rIdx] == cIdx) ? 'checked' : '';
                html += `<td><input type="radio" style="cursor:pointer;" name="mx_${idx}_${rIdx}" value="${cIdx}" onchange="updateMatrixAnswer(${idx}, ${rIdx}, ${cIdx})" ${isChecked}></td>`;
            });
            html += `</tr>`;
        });
        html += '</tbody></table></div>';
        return html;
    }

    if (q.type === 'multi_select') {
        return (q.options || []).map((opt, oIdx) => {
            const isChecked = (savedAns && Array.isArray(savedAns) && savedAns.includes(oIdx)) ? 'checked' : '';
            return `
            <label class="taking-radio opt-label-large">
                <input type="checkbox" name="q_${idx}" value="${oIdx}" onchange="updateMultiSelect(${idx}, ${oIdx}, this.checked)" ${isChecked}>
                <span style="margin-left:8px;">${opt}</span>
            </label>
        `}).join('');
    }

    return (q.options || []).map((opt, oIdx) => {
        const isChecked = (savedAns == oIdx) ? 'checked' : '';
        return `
        <label class="taking-radio opt-label-large">
            <input type="radio" name="q_${idx}" value="${oIdx}" onchange="recordAnswer(${idx}, ${oIdx})" ${isChecked}>
            <span style="margin-left:8px;">${opt}</span>
        </label>
    `}).join('');
}

// --- HELPERS ---
function recordAnswer(qIdx, val) { 
    window.USER_ANSWERS[qIdx] = val;
    // Live Arena: Persist answer locally to session immediately
    if (window.IS_LIVE_ARENA) {
        const session = JSON.parse(localStorage.getItem('liveSession') || '{}');
        if (session.active && session.currentQ === qIdx) {
            if (!session.answers) session.answers = {};
            session.answers[qIdx] = val;
            localStorage.setItem('liveSession', JSON.stringify(session));
            // SYNC TO SERVER IMMEDIATELY
            if (typeof saveToServer === 'function') {
                saveToServer(['liveSession'], false); // Safe merge, fire-and-forget
            }
        }
    }
}
function updateMatchingAnswer(qIdx, rowIdx, val) {
    if(!window.USER_ANSWERS[qIdx]) window.USER_ANSWERS[qIdx] = [];
    window.USER_ANSWERS[qIdx][rowIdx] = val;
    // Live Arena: Persist
    if (window.IS_LIVE_ARENA) recordAnswer(qIdx, window.USER_ANSWERS[qIdx]);
}
function updateMatrixAnswer(qIdx, rowIdx, colIdx) {
    if(!window.USER_ANSWERS[qIdx]) window.USER_ANSWERS[qIdx] = {};
    window.USER_ANSWERS[qIdx][rowIdx] = colIdx;
    // Live Arena: Persist
    if (window.IS_LIVE_ARENA) recordAnswer(qIdx, window.USER_ANSWERS[qIdx]);
}
function updateMultiSelect(qIdx, optIdx, isChecked) {
    if(!window.USER_ANSWERS[qIdx]) window.USER_ANSWERS[qIdx] = [];
    if(isChecked) {
        // Prevent duplicates
        if (!window.USER_ANSWERS[qIdx].includes(optIdx)) {
            window.USER_ANSWERS[qIdx].push(optIdx);
        }
    } else {
        window.USER_ANSWERS[qIdx] = window.USER_ANSWERS[qIdx].filter(i => i !== optIdx);
    }
    // Live Arena: Persist
    if (window.IS_LIVE_ARENA) recordAnswer(qIdx, window.USER_ANSWERS[qIdx]);
}
function moveRankingItem(qIdx, itemIdx, direction) {
    const list = window.USER_ANSWERS[qIdx];
    const newIdx = itemIdx + direction;
    if (newIdx < 0 || newIdx >= list.length) return; 
    const temp = list[itemIdx];
    list[itemIdx] = list[newIdx];
    list[newIdx] = temp;
    const area = document.getElementById(`q_area_${qIdx}`);
    if(area) area.innerHTML = renderRankingList(qIdx, list);
}
function renderRankingList(qIdx, list) {
    if (!list || !Array.isArray(list)) return '<div style="color:var(--text-muted); font-style:italic;">List not initialized.</div>';
    return list.map((item, i) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-input); padding:10px; margin-bottom:5px; border:1px solid var(--border-color); border-radius:4px;">
            <span>${i+1}. ${item}</span>
            <div>
                <button class="btn-secondary btn-sm" onclick="moveRankingItem(${qIdx}, ${i}, -1)" ${i===0?'disabled':''}><i class="fas fa-arrow-up"></i></button>
                <button class="btn-secondary btn-sm" onclick="moveRankingItem(${qIdx}, ${i}, 1)" ${i===list.length-1?'disabled':''}><i class="fas fa-arrow-down"></i></button>
            </div>
        </div>
    `).join('');
}
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
