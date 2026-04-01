/* ================= FEEDBACK REVIEW UI ================= */

const FeedbackReviewUI = {
    viewMode: 'roster', // 'roster' or 'history'
    selectedTrainee: null,

    render: function() {
        if (this.viewMode === 'roster') {
            return this._renderRoster();
        } else {
            return this._renderHistory();
        }
    },

    _getClassification: function(selectionStr) {
        const backendData = DataService.getBackendData();
        let fbMap = backendData.feedback_categories || {};
        if (Array.isArray(fbMap)) { fbMap = { 0: fbMap }; } // Legacy migration fallback
        
        for (const qIndex in fbMap) {
            const cats = fbMap[qIndex];
            if (Array.isArray(cats)) {
                const found = cats.find(c => c.name === selectionStr);
                if (found) return found.classification;
            }
        }
        return 'Pass'; // Default
    },

    _renderRoster: function() {
        const allFeedback = DataService.getAgentFeedback();
        
        // Group by trainee
        const traineeMap = {};
        allFeedback.forEach(f => {
            if (!f.trainee) return; // Skip malformed entries
            
            if (!traineeMap[f.trainee]) {
                traineeMap[f.trainee] = { lastDate: f.date, fails: 0, improves: 0, count: 0 };
            }
            traineeMap[f.trainee].count++;
            if (new Date(f.date) > new Date(traineeMap[f.trainee].lastDate)) {
                traineeMap[f.trainee].lastDate = f.date;
            }
            
            (f.feedback || []).forEach(ans => {
                if (ans.selection) {
                    const cls = this._getClassification(ans.selection);
                    if (cls === 'Fail') traineeMap[f.trainee].fails++;
                    if (cls === 'Improve') traineeMap[f.trainee].improves++;
                }
            });
        });

        let rowsHtml = '';
        Object.keys(traineeMap).sort().forEach(trainee => {
            const stats = traineeMap[trainee];
            const failBadge = stats.fails > 0 ? `<span style="color:#e74c3c; font-weight:bold;">${stats.fails}</span>` : '0';
            const impBadge = stats.improves > 0 ? `<span style="color:#f39c12; font-weight:bold;">${stats.improves}</span>` : '0';
            
            rowsHtml += `
                <tr>
                    <td><strong>${trainee}</strong></td>
                    <td>${stats.lastDate}</td>
                    <td>${stats.count}</td>
                    <td>${failBadge}</td>
                    <td>${impBadge}</td>
                    <td><button class="btn-primary btn-sm" onclick="FeedbackReviewUI.viewHistory('${trainee.replace(/'/g, "\\'")}')">View History</button></td>
                </tr>
            `;
        });

        if (rowsHtml === '') {
            rowsHtml = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:30px;">No feedback records found yet.</td></tr>';
        }

        return `
            <div class="card">
                <h3>Feedback Review Dashboard</h3>
                <p style="color:var(--text-muted); margin-bottom:15px;">Overview of all trainees with captured production feedback.</p>
                <div class="table-responsive">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Trainee Name</th>
                                <th>Last Feedback</th>
                                <th>Total Sessions</th>
                                <th>Total Fails</th>
                                <th>Total Improves</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    viewHistory: function(trainee) {
        this.selectedTrainee = trainee;
        this.viewMode = 'history';
        App.render();
    },

    backToRoster: function() {
        this.selectedTrainee = null;
        this.viewMode = 'roster';
        App.render();
    },

    _renderHistory: function() {
        const allFeedback = DataService.getAgentFeedback();
        const myFeedback = allFeedback.filter(f => f.trainee === this.selectedTrainee).sort((a,b) => new Date(b.date) - new Date(a.date));

        let historyHtml = '';
        let totalFails = 0;
        let totalImproves = 0;
        let totalPasses = 0;

        myFeedback.forEach(session => {
            let answersHtml = '';
            (session.feedback || []).forEach(ans => {
                let cls = 'Pass';
                let clsColor = '#2ecc71';
                
                if (ans.selection) cls = this._getClassification(ans.selection);
                
                if (cls === 'Fail') { clsColor = '#e74c3c'; totalFails++; }
                else if (cls === 'Improve') { clsColor = '#f39c12'; totalImproves++; }
                else { totalPasses++; }

                let answerDetail = ans.selection || ans.desc || (ans.rating !== undefined ? `Rating: ${ans.rating}/5` : 'N/A');
                
                let proofHtml = '';
                if (ans.mentored) proofHtml += `<span style="background:rgba(46, 204, 113, 0.1); color:#2ecc71; padding:2px 6px; border-radius:4px; font-size:0.75rem; margin-left:10px;"><i class="fas fa-chalkboard-teacher"></i> Mentored</span> `;
                if (ans.proofDesc) proofHtml += `<div style="font-size:0.8rem; margin-top:5px; color:var(--text-muted);"><i class="fas fa-info-circle"></i> ${ans.proofDesc}</div>`;
                if (ans.proofFile) proofHtml += `<div style="margin-top:5px;"><button class="btn-secondary btn-sm" onclick="FeedbackReviewUI.viewProof('${ans.proofFile}')"><i class="fas fa-image"></i> View Attachment</button> <span style="font-size:0.7rem; color:var(--text-muted);">${ans.fileName||''}</span></div>`;

                answersHtml += `
                    <div style="border-bottom:1px solid var(--border-color); padding:10px 0;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                            <div style="flex:1;">
                                <div style="font-weight:bold; margin-bottom:5px;">${ans.question}</div>
                                <div style="color:var(--text-main);">${answerDetail}</div>
                                ${ans.ticket ? `<div style="font-size:0.8rem; color:var(--primary); margin-top:3px;"><i class="fas fa-ticket-alt"></i> Ticket: ${ans.ticket}</div>` : ''}
                                ${proofHtml}
                            </div>
                            <div style="font-weight:bold; color:${clsColor}; border:1px solid ${clsColor}; padding:2px 8px; border-radius:4px; font-size:0.8rem;">
                                ${cls}
                            </div>
                        </div>
                    </div>
                `;
            });

            historyHtml += `
                <div class="card" style="margin-bottom:20px; border-left:4px solid var(--primary);">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:10px;">
                        <div>
                            <h4 style="margin:0;">Session Date: ${session.date}</h4>
                            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">Submitted by TL: ${session.tl}</div>
                        </div>
                    </div>
                    <div>${answersHtml}</div>
                </div>
            `;
        });

        return `
            <div class="no-print" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <button class="btn-secondary" onclick="FeedbackReviewUI.backToRoster()"><i class="fas fa-arrow-left"></i> Back to Roster</button>
                <button class="btn-primary" onclick="window.print()"><i class="fas fa-print"></i> Export to PDF</button>
            </div>
            
            <h2 style="margin:0 0 20px 0;">Detailed History: <span style="color:var(--primary);">${this.selectedTrainee}</span></h2>
            
            <div class="card" style="margin-bottom:20px; background:var(--bg-input);">
                <h3 style="margin-top:0;">Performance Trend Summary</h3>
                <div style="display:flex; gap:20px; text-align:center;">
                    <div style="flex:1; background:var(--bg-card); padding:15px; border-radius:8px; border:1px solid #2ecc71;">
                        <div style="font-size:2rem; font-weight:bold; color:#2ecc71;">${totalPasses}</div>
                        <div style="color:var(--text-muted); font-size:0.9rem;">Passes</div>
                    </div>
                    <div style="flex:1; background:var(--bg-card); padding:15px; border-radius:8px; border:1px solid #f39c12;">
                        <div style="font-size:2rem; font-weight:bold; color:#f39c12;">${totalImproves}</div>
                        <div style="color:var(--text-muted); font-size:0.9rem;">Improves</div>
                    </div>
                    <div style="flex:1; background:var(--bg-card); padding:15px; border-radius:8px; border:1px solid #e74c3c;">
                        <div style="font-size:2rem; font-weight:bold; color:#e74c3c;">${totalFails}</div>
                        <div style="color:var(--text-muted); font-size:0.9rem;">Fails</div>
                    </div>
                </div>
            </div>

            ${historyHtml}
        `;
    },
    
    viewProof: function(base64Data) {
        const win = window.open();
        win.document.write('<iframe src="' + base64Data  + '" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>');
    }
};