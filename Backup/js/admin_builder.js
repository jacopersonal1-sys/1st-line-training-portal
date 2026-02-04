/* ================= ADMIN: TEST BUILDER & MANAGER ================= */
/* Responsibility: Creating, Editing, and Deleting Digital Assessments */

// Global State for Builder
let BUILDER_QUESTIONS = [];
let EDITING_TEST_ID = null; 

function loadTestBuilder(existingId = null) {
    BUILDER_QUESTIONS = [];
    document.getElementById('questionContainer').innerHTML = '';
    document.getElementById('builderTotalScore').innerText = '0';
    
    // Track if we are editing an existing test
    EDITING_TEST_ID = existingId; 
    
    // Reset Type Logic
    const typeSelect = document.getElementById('builderTestType');
    if (typeSelect) {
        typeSelect.value = 'standard'; // Default
        typeSelect.onchange = function() {
            const wrap = document.getElementById('durationWrapper');
            if(this.value === 'vetting') wrap.classList.remove('hidden');
            else wrap.classList.add('hidden');
        };
        typeSelect.onchange(); 
    }
    
    document.getElementById('builderDuration').value = '30';

    const select = document.getElementById('builderAssessmentSelect');
    const assessments = JSON.parse(localStorage.getItem('assessments') || '[]');
    select.innerHTML = '<option value="">-- Create Standalone / Not Linked --</option>';
    assessments.forEach(a => select.add(new Option(a.name, a.name)));

    // Load Data if Editing
    if(existingId) {
        const tests = JSON.parse(localStorage.getItem('tests') || '[]');
        // Loose comparison (==) handles string/number ID differences
        const test = tests.find(t => t.id == existingId);
        
        if(test) {
            select.value = test.title;
            if(typeSelect) {
                typeSelect.value = test.type || 'standard';
                typeSelect.onchange(); // Trigger UI update
            }
            if(test.duration) document.getElementById('builderDuration').value = test.duration;
            
            // Load Questions
            BUILDER_QUESTIONS = test.questions || [];
            renderBuilder();
        } else {
            console.warn("Editing test ID not found:", existingId);
        }
    }
}

function addQuestion(type) {
    // UPDATED: Consistent String IDs
    const id = Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    let q = { id, type, text: "", points: 1 }; // Default structure with points

    // Specific structures per type
    if (type === 'multiple_choice' || type === 'multi_select') {
        q.options = ["", ""];
        q.correct = type === 'multi_select' ? [] : 0;
    }
    else if (type === 'text') {
        q.modelAnswer = ""; 
    }
    else if (type === 'matching') {
        q.pairs = [{left: "", right: ""}, {left: "", right: ""}];
    }
    else if (type === 'drag_drop' || type === 'ranking') {
        q.items = ["", ""]; 
    }
    else if (type === 'matrix') {
        q.rows = [""];
        q.cols = ["", ""];
        q.correct = {}; 
    }

    BUILDER_QUESTIONS.push(q);
    renderBuilder();
}

function renderBuilder() {
    const container = document.getElementById('questionContainer');
    let totalPoints = 0;

    container.innerHTML = BUILDER_QUESTIONS.map((q, idx) => {
        totalPoints += parseFloat(q.points || 0);
        let innerHTML = '';

        if (q.type === 'multiple_choice' || q.type === 'multi_select') {
            const isMulti = q.type === 'multi_select';
            innerHTML = `
                <small>Options (Select correct answer):</small>
                ${(q.options || []).map((opt, oIdx) => `
                    <div class="opt-row">
                        <input type="${isMulti ? 'checkbox' : 'radio'}" name="correct_${idx}" 
                            ${isMulti ? (q.correct.includes(oIdx) ? 'checked' : '') : (q.correct == oIdx ? 'checked' : '')} 
                            onchange="updateCorrect(${idx}, ${oIdx}, '${q.type}')">
                        <input type="text" placeholder="Option ${oIdx + 1}" value="${opt}" onchange="updateOptText(${idx}, ${oIdx}, this.value)">
                    </div>
                `).join('')}
                <button class="btn-secondary btn-sm" onclick="addOption(${idx})">+ Add Option</button>
            `;
        } 
        else if (q.type === 'text') {
            innerHTML = `
                <small>Suggested Model Answer (For Marker's View Only):</small>
                <textarea class="q-text-input" style="height:60px;" placeholder="Enter the ideal answer..." onchange="updateModelAnswer(${idx}, this.value)">${q.modelAnswer || ''}</textarea>
            `;
        }
        else if (q.type === 'matching') {
            innerHTML = `
                <small>Matching Pairs (Trainee must match Left to Right):</small>
                ${(q.pairs || []).map((p, pIdx) => `
                    <div class="opt-row">
                        <input type="text" placeholder="Left Side (e.g. Term)" value="${p.left}" onchange="updatePair(${idx}, ${pIdx}, 'left', this.value)">
                        <span style="padding:0 10px;">&harr;</span>
                        <input type="text" placeholder="Right Side (e.g. Definition)" value="${p.right}" onchange="updatePair(${idx}, ${pIdx}, 'right', this.value)">
                        <button class="btn-danger btn-sm" onclick="removePair(${idx}, ${pIdx})">X</button>
                    </div>
                `).join('')}
                <button class="btn-secondary btn-sm" onclick="addPair(${idx})">+ Add Pair</button>
            `;
        }
        else if (q.type === 'drag_drop' || q.type === 'ranking') {
            innerHTML = `
                <small>Correct Order (1 = Top/First):</small>
                ${(q.items || []).map((item, iIdx) => `
                    <div class="opt-row">
                        <span style="font-weight:bold; margin-right:10px;">${iIdx + 1}.</span>
                        <input type="text" placeholder="Item content" value="${item}" onchange="updateOrderedItem(${idx}, ${iIdx}, this.value)">
                        <button class="btn-danger btn-sm" onclick="removeOrderedItem(${idx}, ${iIdx})">X</button>
                    </div>
                `).join('')}
                <button class="btn-secondary btn-sm" onclick="addOrderedItem(${idx})">+ Add Item</button>
            `;
        }
        else if (q.type === 'matrix') {
            innerHTML = `
                <div class="grid-2" style="margin-bottom:10px;">
                    <div>
                        <small>Rows (Questions):</small>
                        ${(q.rows || []).map((r, rIdx) => `
                            <div class="opt-row">
                                <input type="text" placeholder="Row ${rIdx+1}" value="${r}" onchange="updateMatrixRow(${idx}, ${rIdx}, this.value)">
                                <button class="btn-danger btn-sm" onclick="removeMatrixRow(${idx}, ${rIdx})">X</button>
                            </div>
                        `).join('')}
                        <button class="btn-secondary btn-sm" onclick="addMatrixRow(${idx})">+ Row</button>
                    </div>
                    <div>
                        <small>Columns (Options):</small>
                        ${(q.cols || []).map((c, cIdx) => `
                            <div class="opt-row">
                                <input type="text" placeholder="Col ${cIdx+1}" value="${c}" onchange="updateMatrixCol(${idx}, ${cIdx}, this.value)">
                                <button class="btn-danger btn-sm" onclick="removeMatrixCol(${idx}, ${cIdx})">X</button>
                            </div>
                        `).join('')}
                        <button class="btn-secondary btn-sm" onclick="addMatrixCol(${idx})">+ Col</button>
                    </div>
                </div>
                <small>Select Correct Answers (Row -> Col):</small>
                <div style="background:var(--bg-input); padding:10px; border-radius:4px;">
                    ${(q.rows || []).map((r, rIdx) => `
                        <div style="display:flex; gap:10px; align-items:center; margin-bottom:5px;">
                            <span style="width:100px; font-size:0.8rem; overflow:hidden;">${r || 'Row '+ (rIdx+1)}</span>
                            <select onchange="updateMatrixCorrect(${idx}, ${rIdx}, this.value)" style="flex:1; margin:0; padding:2px;">
                                <option value="">-- Select Correct Col --</option>
                                ${(q.cols || []).map((c, cIdx) => `
                                    <option value="${cIdx}" ${q.correct && q.correct[rIdx] == cIdx ? 'selected' : ''}>${c || 'Col '+(cIdx+1)}</option>
                                `).join('')}
                            </select>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        return `
        <div class="question-card">
            <div class="q-header">
                <strong>Question ${idx + 1} (${q.type.replace('_', ' ')})</strong>
                <button class="btn-danger btn-sm" onclick="removeQuestion(${idx})"><i class="fas fa-times"></i></button>
            </div>
            <div style="display:flex; gap:10px; margin-bottom:10px;">
                <textarea placeholder="Enter Question Text" class="q-text-input auto-expand" oninput="autoResize(this)" onchange="updateQText(${idx}, this.value)" style="flex:3;">${q.text || ''}</textarea>
                <div style="flex:1;">
                    <input type="number" placeholder="Points" value="${q.points}" min="1" onchange="updatePoints(${idx}, this.value)" style="margin:0;" title="Points Value">
                </div>
            </div>
            <div style="margin-top:10px;">
                ${innerHTML}
            </div>
        </div>
    `}).join('');
    
    document.getElementById('builderTotalScore').innerText = totalPoints;
}

// --- BUILDER UPDATERS ---
function updateQText(idx, val) { BUILDER_QUESTIONS[idx].text = val; }
function updatePoints(idx, val) { BUILDER_QUESTIONS[idx].points = parseFloat(val) || 1; renderBuilder(); }

function updateOptText(qIdx, oIdx, val) { BUILDER_QUESTIONS[qIdx].options[oIdx] = val; }
function updateCorrect(qIdx, oIdx, type) { 
    if (type === 'multi_select') {
        const arr = BUILDER_QUESTIONS[qIdx].correct;
        if (arr.includes(oIdx)) {
            BUILDER_QUESTIONS[qIdx].correct = arr.filter(i => i !== oIdx);
        } else {
            BUILDER_QUESTIONS[qIdx].correct.push(oIdx);
        }
    } else {
        BUILDER_QUESTIONS[qIdx].correct = oIdx; 
    }
}
function addOption(idx) { BUILDER_QUESTIONS[idx].options.push(""); renderBuilder(); }

function updateModelAnswer(idx, val) { BUILDER_QUESTIONS[idx].modelAnswer = val; }

function updatePair(qIdx, pIdx, side, val) { BUILDER_QUESTIONS[qIdx].pairs[pIdx][side] = val; }
function addPair(idx) { BUILDER_QUESTIONS[idx].pairs.push({left:"", right:""}); renderBuilder(); }
function removePair(idx, pIdx) { BUILDER_QUESTIONS[idx].pairs.splice(pIdx, 1); renderBuilder(); }

function updateOrderedItem(qIdx, iIdx, val) { BUILDER_QUESTIONS[qIdx].items[iIdx] = val; }
function addOrderedItem(idx) { BUILDER_QUESTIONS[idx].items.push(""); renderBuilder(); }
function removeOrderedItem(idx, iIdx) { BUILDER_QUESTIONS[idx].items.splice(iIdx, 1); renderBuilder(); }

function updateMatrixRow(qIdx, rIdx, val) { BUILDER_QUESTIONS[qIdx].rows[rIdx] = val; renderBuilder(); } 
function updateMatrixCol(qIdx, cIdx, val) { BUILDER_QUESTIONS[qIdx].cols[cIdx] = val; renderBuilder(); }
function addMatrixRow(idx) { BUILDER_QUESTIONS[idx].rows.push(""); renderBuilder(); }
function addMatrixCol(idx) { BUILDER_QUESTIONS[idx].cols.push(""); renderBuilder(); }
function removeMatrixRow(idx, rIdx) { BUILDER_QUESTIONS[idx].rows.splice(rIdx, 1); renderBuilder(); }
function removeMatrixCol(idx, cIdx) { BUILDER_QUESTIONS[idx].cols.splice(cIdx, 1); renderBuilder(); }
function updateMatrixCorrect(qIdx, rIdx, val) { 
    if(!BUILDER_QUESTIONS[qIdx].correct) BUILDER_QUESTIONS[qIdx].correct = {};
    BUILDER_QUESTIONS[qIdx].correct[rIdx] = val; 
}

function removeQuestion(idx) { BUILDER_QUESTIONS.splice(idx, 1); renderBuilder(); }

async function saveTest() {
    const linked = document.getElementById('builderAssessmentSelect').value;
    const type = document.getElementById('builderTestType').value;
    const dur = document.getElementById('builderDuration').value;

    if (BUILDER_QUESTIONS.length === 0) return alert("Add questions.");
    if (!linked) return alert("Select assessment.");

    const tests = JSON.parse(localStorage.getItem('tests') || '[]');

    // Update existing or create new
    if (EDITING_TEST_ID) {
        // Loose comparison for ID to ensure we find it
        const idx = tests.findIndex(t => t.id == EDITING_TEST_ID);
        if(idx > -1) {
            tests[idx].title = linked;
            tests[idx].type = type;
            tests[idx].duration = type === 'vetting' ? dur : null;
            tests[idx].questions = BUILDER_QUESTIONS;
        } else {
            // Fallback: If ID mismatch, push as new to avoid data loss
            // UPDATED: Use consistent string ID
            const newTest = {
                id: Date.now() + "_" + Math.random().toString(36).substr(2, 9),
                title: linked,
                type: type, 
                duration: type === 'vetting' ? dur : null,
                questions: BUILDER_QUESTIONS
            };
            tests.push(newTest);
        }
    } else {
        // Check for duplicates by Title if creating new
        const existingIdx = tests.findIndex(t => t.title === linked);
        if(existingIdx > -1) {
             if(!confirm("A test with this name already exists. Overwrite?")) return;
             tests[existingIdx].type = type;
             tests[existingIdx].duration = type === 'vetting' ? dur : null;
             tests[existingIdx].questions = BUILDER_QUESTIONS;
        } else {
            const newTest = {
                id: Date.now() + "_" + Math.random().toString(36).substr(2, 9),
                title: linked,
                type: type, 
                duration: type === 'vetting' ? dur : null,
                questions: BUILDER_QUESTIONS
            };
            tests.push(newTest);
        }
    }

    localStorage.setItem('tests', JSON.stringify(tests));

    // --- SECURE SAVE START ---
    // UPDATED: Use saveToServer(true) for Instant Overwrite
    const btn = document.activeElement; 
    let originalText = "";
    if(btn && btn.tagName === 'BUTTON') {
        originalText = btn.innerText;
        btn.innerText = "Syncing to Cloud...";
        btn.disabled = true;
    }

    // Push new test definition to Supabase immediately (Force)
    if(typeof saveToServer === 'function') await saveToServer(true);
    
    if(btn && btn.tagName === 'BUTTON') {
        btn.innerText = originalText;
        btn.disabled = false;
    }
    // --- SECURE SAVE END ---
    
    // Refresh Dropdowns to reflect changes
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();

    alert("Test Saved.");
    EDITING_TEST_ID = null; // Reset
    showTab('test-manage');
    loadManageTests();
}

function editTest(id) {
    loadTestBuilder(id);
    showTab('test-builder');
}

// --- TEST MANAGER (CRUD VIEW) ---

function loadManageTests() {
    const container = document.getElementById('testListAdmin');
    if (!container) return;
    const tests = JSON.parse(localStorage.getItem('tests') || '[]');
    container.innerHTML = tests.map(t => `
        <div class="test-card-row">
            <div><strong>${t.title}</strong><br><small>${t.questions.length} Questions</small></div>
            <div>
                <button class="btn-secondary btn-sm" onclick="editTest('${t.id}')"><i class="fas fa-edit"></i></button>
                <button class="btn-danger btn-sm" onclick="deleteTest('${t.id}')"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join('');
}

async function deleteTest(id) {
    if (!confirm("Delete test permanently? Attempt history will be lost.")) return;
    let tests = JSON.parse(localStorage.getItem('tests') || '[]');
    tests = tests.filter(t => t.id != id);
    localStorage.setItem('tests', JSON.stringify(tests));
    
    // UPDATED: Ensure deletion syncs immediately via Supabase (Force)
    if(typeof saveToServer === 'function') await saveToServer(true);
    
    loadManageTests();
}