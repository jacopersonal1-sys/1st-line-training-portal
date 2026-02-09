/* ================= ADMIN: COMPLETED ASSESSMENT HISTORY ================= */
/* Handles the 'Completed Assessments' sub-menu in the Test Engine */

function showTestEngineSub(viewName, btn) {
    // Toggle Views
    document.getElementById('engine-view-overview').classList.add('hidden');
    document.getElementById('engine-view-history').classList.add('hidden');
    
    document.getElementById('engine-view-' + viewName).classList.remove('hidden');
    
    // Toggle Buttons
    const container = btn.parentElement;
    container.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Load Data
    if (viewName === 'history') {
        loadCompletedHistory();
    }
}

function loadCompletedHistory() {
    const container = document.getElementById('completedHistoryList');
    if (!container) return;

    const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
    const search = document.getElementById('historySearch') ? document.getElementById('historySearch').value.toLowerCase() : '';

    // Filter for Completed items
    let completed = subs.filter(s => s.status === 'completed');

    // Apply Search
    if (search) {
        completed = completed.filter(s => 
            s.trainee.toLowerCase().includes(search) || 
            s.testTitle.toLowerCase().includes(search)
        );
    }

    // Sort by Date Descending (Newest First)
    completed.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (completed.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">No completed assessments found.</div>';
        return;
    }

    let html = `
    <table class="admin-table">
        <thead>
            <tr>
                <th>Date</th>
                <th>Trainee</th>
                <th>Test Title</th>
                <th>Score</th>
                <th>Last Edited By</th>
                <th>Action</th>
            </tr>
        </thead>
        <tbody>`;
    
    completed.forEach(s => {
        const editedBy = s.lastEditedBy ? `<span style="font-size:0.8rem;">${s.lastEditedBy}<br><span style="color:var(--text-muted);">${new Date(s.lastEditedDate).toLocaleDateString()}</span></span>` : '-';
        
        // Score Color
        let scoreColor = 'var(--text-main)';
        if (s.score >= 90) scoreColor = '#2ecc71'; // Green
        else if (s.score < 80) scoreColor = '#ff5252'; // Red
        
        html += `
            <tr>
                <td>${s.date}</td>
                <td><strong>${s.trainee}</strong></td>
                <td>${s.testTitle}</td>
                <td><span style="font-weight:bold; color:${scoreColor};">${s.score}%</span></td>
                <td>${editedBy}</td>
                <td>
                    <button class="btn-primary btn-sm" onclick="openAdminMarking('${s.id}')" title="Raw Edit Score"><i class="fas fa-pen"></i> Edit</button>
                </td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}
