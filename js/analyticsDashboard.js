/* ================= ANALYTICS DASHBOARD ENGINE ================= */
/* Handles high-level data aggregation for Department Overview */

const AnalyticsEngine = {
    
    // --- DATA AGGREGATION ---

    // 1. Department Health (Critical vs On-Track)
    calculateDepartmentHealth: function(groupId) {
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        
        // Filter trainees by group if provided
        let trainees = users.filter(u => u.role === 'trainee');
        if (groupId && rosters[groupId]) {
            trainees = trainees.filter(t => rosters[groupId].includes(t.user));
        }

        const totalTrainees = trainees.length;
        
        if (totalTrainees === 0) return { critical: 0, warning: 0, onTrack: 0, total: 0 };

        const reviews = JSON.parse(localStorage.getItem('insightReviews') || '[]');
        const records = JSON.parse(localStorage.getItem('records') || '[]');
        
        let criticalCount = 0;
        let warningCount = 0;
        let onTrackCount = 0;

        trainees.forEach(t => {
            // Check Manual Review first (Admin Override)
            const review = reviews.find(r => r.trainee === t.user);
            if (review) {
                if (review.status === 'Critical' || review.status === 'Fail') criticalCount++;
                else if (review.status === 'Semi-Critical' || review.status === 'Improvement') warningCount++;
                else onTrackCount++;
            } else {
                // Auto-calc based on records (Heuristic)
                const myRecords = records.filter(r => r.trainee === t.user);
                // Check for any failed assessments (< 80%)
                const hasFailures = myRecords.some(r => r.score < 80);
                const hasCriticalFailures = myRecords.some(r => r.score < 60);
                
                if (hasCriticalFailures) criticalCount++;
                else if (hasFailures) warningCount++;
                else onTrackCount++;
            }
        });

        return {
            critical: Math.round((criticalCount / totalTrainees) * 100),
            warning: Math.round((warningCount / totalTrainees) * 100),
            onTrack: Math.round((onTrackCount / totalTrainees) * 100),
            total: totalTrainees
        };
    },

    // 2. Group Knowledge Gaps (Deep Dive)
    calculateGroupGaps: function(groupId, testFilter = null) {
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        const members = rosters[groupId] || [];
        
        if (members.length === 0) return [];

        const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
        const tests = JSON.parse(localStorage.getItem('tests') || '[]');
        
        // Filter submissions for this group
        let groupSubs = submissions.filter(s => members.includes(s.trainee));
        
        if (testFilter) {
            groupSubs = groupSubs.filter(s => s.testTitle === testFilter);
        }
        
        const questionStats = {}; // { "TestName - QText": { total: 0, failed: 0 } }

        groupSubs.forEach(sub => {
            // Use snapshot if available, else fallback to current test def
            let testDef = sub.testSnapshot;
            if (!testDef) testDef = tests.find(t => t.id == sub.testId);
            
            if (testDef && testDef.questions) {
                testDef.questions.forEach((q, idx) => {
                    // Identify question uniquely
                    const key = `${sub.testTitle} - ${q.text.substring(0, 40)}...`;
                    
                    if (!questionStats[key]) questionStats[key] = { total: 0, failed: 0, text: q.text, test: sub.testTitle };
                    
                    questionStats[key].total++;
                    
                    // Check if answer was correct
                    const maxPts = parseFloat(q.points || 1);
                    let earned = 0;

                    // 1. Try explicit score (Admin marked)
                    if (sub.scores && sub.scores[idx] !== undefined) {
                        earned = sub.scores[idx];
                    } 
                    // 2. Try auto-grade (if completed but not manually marked per question)
                    else if (sub.status === 'completed') {
                        const ans = sub.answers ? sub.answers[idx] : undefined;
                        
                        if (q.type === 'multiple_choice') {
                            if (ans == q.correct) earned = maxPts;
                        } else if (q.type === 'multi_select') {
                             const correctArr = (q.correct || []).map(Number);
                             const userArr = (ans || []).map(Number);
                             let match = 0;
                             let incorrect = 0;
                             userArr.forEach(a => { if(correctArr.includes(a)) match++; else incorrect++; });
                             if(correctArr.length > 0) {
                                let raw = ((match - incorrect) / correctArr.length) * maxPts;
                                earned = Math.max(0, raw);
                             }
                        } else if (q.type === 'matching') {
                             let correctCount = 0;
                             (q.pairs || []).forEach((p, pIdx) => {
                                if (ans && ans[pIdx] === p.right) correctCount++;
                             });
                             if (correctCount === (q.pairs || []).length) earned = maxPts;
                        } else if (q.type === 'matrix') {
                             let correctRows = 0;
                             (q.rows || []).forEach((r, rIdx) => {
                                const correctColIdx = q.correct ? q.correct[rIdx] : null;
                                if (ans && ans[rIdx] == correctColIdx) correctRows++;
                             });
                             if ((q.rows || []).length > 0) {
                                earned = (correctRows / q.rows.length) * maxPts;
                             }
                        } else if (q.type === 'drag_drop' || q.type === 'ranking') {
                             let isExact = true;
                             if (!ans || ans.length !== q.items.length) isExact = false;
                             else {
                                ans.forEach((item, i) => { if (item !== q.items[i]) isExact = false; });
                             }
                             if (isExact) earned = maxPts;
                        }
                    }
                    
                    // Threshold for "Failure" in a question: < 50% of points
                    if (earned < (maxPts * 0.5)) {
                        questionStats[key].failed++;
                    }
                });
            }
        });

        // Convert to array and sort by failure rate
        const gaps = Object.values(questionStats).map(stat => ({
            question: stat.text,
            test: stat.test,
            failureRate: Math.round((stat.failed / stat.total) * 100),
            count: stat.failed
        }));

        // Return Top 5 Failed Questions
        return gaps.filter(g => g.failureRate > 0).sort((a, b) => b.failureRate - a.failureRate).slice(0, 5);
    },

    // 3. Individual At-Risk Score
    calculateAtRiskScore: function(userId) {
        let riskScore = 0;
        const weights = { focus: 30, attendance: 30, admin: 40 };

        // A. Focus Score (< 60% is bad)
        const history = JSON.parse(localStorage.getItem('monitor_history') || '[]');
        const userHistory = history.filter(h => h.user === userId);
        
        if (userHistory.length > 0) {
            // Calculate average focus over last 7 entries
            const recent = userHistory.slice(-7);
            let totalFocus = 0;
            recent.forEach(h => {
                const s = h.summary;
                const focus = s.total > 0 ? (s.study / s.total) * 100 : 0;
                totalFocus += focus;
            });
            const avgFocus = totalFocus / recent.length;
            
            if (avgFocus < 40) riskScore += weights.focus; // High risk
            else if (avgFocus < 60) riskScore += (weights.focus / 2); // Med risk
        }

        // B. Lateness (2+ instances)
        const attendance = JSON.parse(localStorage.getItem('attendance_records') || '[]');
        const lates = attendance.filter(r => r.user === userId && r.isLate).length;
        
        if (lates >= 3) riskScore += weights.attendance;
        else if (lates >= 1) riskScore += (weights.attendance / 2);

        // C. Admin Critical Flags
        const reviews = JSON.parse(localStorage.getItem('insightReviews') || '[]');
        const review = reviews.find(r => r.trainee === userId);
        
        if (review) {
            if (review.status === 'Critical' || review.status === 'Fail') riskScore += weights.admin;
            else if (review.status === 'Semi-Critical') riskScore += (weights.admin / 2);
        } else {
            // Fallback to record average if no review
            const records = JSON.parse(localStorage.getItem('records') || '[]');
            const myRecords = records.filter(r => r.trainee === userId);
            if (myRecords.length > 0) {
                let totalScore = 0;
                myRecords.forEach(r => totalScore += r.score);
                const avg = totalScore / myRecords.length;
                if (avg < 70) riskScore += (weights.admin / 2);
            }
        }

        return Math.min(100, Math.round(riskScore));
    },

    // --- UI RENDERING ---

    // Helper: Render Trend Chart (Bar)
    renderTrendChart: function(data) {
        let html = '<div style="display:flex; align-items:flex-end; justify-content:space-around; height:160px; padding-top:10px;">';
        
        data.forEach(d => {
            const height = d.count > 0 ? d.score : 2; 
            const color = d.count === 0 ? 'var(--bg-input)' : (d.score >= 80 ? '#2ecc71' : (d.score >= 60 ? '#f1c40f' : '#ff5252'));
            
            html += `
                <div style="display:flex; flex-direction:column; align-items:center; width:18%; height:100%;">
                    <div style="font-weight:bold; color:${d.count > 0 ? color : 'var(--text-muted)'}; margin-bottom:auto; font-size:1.1rem;">${d.count > 0 ? d.score + '%' : '-'}</div>
                    <div style="width:100%; background:var(--bg-input); height:100px; position:relative; border-radius:4px; overflow:hidden; border:1px solid var(--border-color);">
                        <div style="position:absolute; bottom:0; left:0; width:100%; height:${height}%; background:${color}; transition:height 0.5s; opacity:0.8;"></div>
                    </div>
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:10px;">${d.label}</div>
                </div>`;
        });
        html += '</div>';
        return html;
    },

    // 4. Department Overview UI
    renderDepartmentDashboard: function(container, navHTML, groupId) {
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        
        let trainees = users.filter(u => u.role === 'trainee');
        if (groupId && rosters[groupId]) {
            trainees = trainees.filter(t => rosters[groupId].includes(t.user));
        }

        const records = JSON.parse(localStorage.getItem('records') || '[]');
        const groupRecords = records.filter(r => trainees.some(t => t.user === r.trainee));
        
        const history = JSON.parse(localStorage.getItem('monitor_history') || '[]');

        // Calculate Average Assessment Score for Group
        let totalScore = 0;
        let scoreCount = 0;
        groupRecords.forEach(r => {
            if (r.phase === 'Assessment') {
                totalScore += r.score;
                scoreCount++;
            }
        });
        const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;

        // --- 1. EFFORT VS PERFORMANCE ---
        // Correlate Focus Score (Effort) with Assessment Average (Performance) per trainee
        const correlationData = trainees.map(t => {
            // Get Focus
            const userHist = history.filter(h => h.user === t.user);
            let totalFocus = 0;
            let days = 0;
            userHist.forEach(h => {
                if(h.summary.total > 0) {
                    totalFocus += (h.summary.study / h.summary.total) * 100;
                    days++;
                }
            });
            const avgFocus = days > 0 ? Math.round(totalFocus / days) : 0;

            // Get Performance
            const myRecs = groupRecords.filter(r => r.trainee === t.user && r.phase === 'Assessment');
            let myTotal = 0;
            myRecs.forEach(r => myTotal += r.score);
            const myAvg = myRecs.length > 0 ? Math.round(myTotal / myRecs.length) : 0;

            return { user: t.user, focus: avgFocus, score: myAvg, count: myRecs.length };
        }).filter(d => d.count > 0); // Only show those with data

        // Sort by Score Ascending (Worst performers first)
        correlationData.sort((a,b) => a.score - b.score);

        const effortHtml = correlationData.map(d => {
            // Logic: High Focus + Low Score = Struggle (Needs Help)
            // Low Focus + Low Score = Slacking (Discipline)
            let status = '';
            let color = '';
            
            if (d.score < 80) {
                if (d.focus > 70) { status = 'Struggling (High Effort)'; color = '#f1c40f'; }
                else { status = 'At Risk (Low Effort)'; color = '#ff5252'; }
            } else {
                status = 'On Track'; color = '#2ecc71';
            }

            return `
                <div style="display:grid; grid-template-columns: 2fr 1fr 1fr 2fr; gap:10px; padding:8px; border-bottom:1px solid var(--border-color); font-size:0.85rem; align-items:center;">
                    <div style="font-weight:bold;">${d.user}</div>
                    <div>${d.focus}% Focus</div>
                    <div style="font-weight:bold;">${d.score}% Avg</div>
                    <div style="color:${color}; font-weight:bold;">${status}</div>
                </div>
            `;
        }).join('') || '<div style="padding:15px; text-align:center; color:var(--text-muted);">No correlation data available.</div>';

        // --- 2. GROUP STRUGGLE AREAS ---
        // Which assessments have a low average for THIS group?
        const assessmentStats = {};
        groupRecords.forEach(r => {
            if (!assessmentStats[r.assessment]) assessmentStats[r.assessment] = { total: 0, count: 0 };
            assessmentStats[r.assessment].total += r.score;
            assessmentStats[r.assessment].count++;
        });

        const struggles = Object.entries(assessmentStats)
            .map(([name, stat]) => ({ name, avg: Math.round(stat.total / stat.count) }))
            .filter(s => s.avg < 80)
            .sort((a,b) => a.avg - b.avg);

        const struggleHtml = struggles.length > 0 ? struggles.map(s => `
            <div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid var(--border-color);">
                <span>${s.name}</span>
                <span style="color:#ff5252; font-weight:bold;">${s.avg}% Avg</span>
            </div>
        `).join('') : '<div style="padding:15px; text-align:center; color:var(--text-muted);">No significant struggle areas detected.</div>';

        // --- 3. GLOBAL PAIN POINTS (Cross-Group) ---
        // Which assessments fail most often across ALL groups?
        const allRecords = records; // Already loaded
        const globalStats = {};
        allRecords.forEach(r => {
            if (!globalStats[r.assessment]) globalStats[r.assessment] = { total: 0, count: 0, fails: 0 };
            globalStats[r.assessment].total += r.score;
            globalStats[r.assessment].count++;
            if (r.score < 80) globalStats[r.assessment].fails++;
        });

        const globalPain = Object.entries(globalStats)
            .map(([name, stat]) => ({ 
                name, 
                failRate: Math.round((stat.fails / stat.count) * 100),
                count: stat.count 
            }))
            .filter(s => s.failRate > 20 && s.count > 5) // Threshold: >20% fail rate, min 5 attempts
            .sort((a,b) => b.failRate - a.failRate)
            .slice(0, 5);

        const globalPainHtml = globalPain.length > 0 ? globalPain.map(s => `
            <div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid var(--border-color);">
                <span>${s.name}</span>
                <span style="color:#e74c3c; font-weight:bold;">${s.failRate}% Fail Rate</span>
            </div>
        `).join('') : '<div style="padding:15px; text-align:center; color:var(--text-muted);">No global pain points detected.</div>';

        // Calculate Top Performers
        const performerStats = trainees.map(t => {
            const myRecords = groupRecords.filter(r => r.trainee === t.user && r.phase === 'Assessment');
            let total = 0;
            if (myRecords.length > 0) {
                myRecords.forEach(r => total += r.score);
                return { user: t.user, avg: Math.round(total / myRecords.length), count: myRecords.length };
            }
            return { user: t.user, avg: 0, count: 0 };
        });

        performerStats.sort((a, b) => b.avg - a.avg);
        const top3 = performerStats.filter(p => p.count > 0).slice(0, 3);

        let topPerformersHtml = '';
        if (top3.length > 0) {
            topPerformersHtml = top3.map((p, idx) => {
                const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : '🥉');
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-color);">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="font-size:1.5rem;">${medal}</span>
                            <div>
                                <div style="font-weight:bold;">${p.user}</div>
                                <div style="font-size:0.8rem; color:var(--text-muted);">${p.count} Assessments</div>
                            </div>
                        </div>
                        <div style="font-weight:bold; color:#2ecc71; font-size:1.1rem;">${p.avg}%</div>
                    </div>`;
            }).join('');
        } else {
            topPerformersHtml = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No assessment data available.</div>';
        }

        // Build HTML Structure
        const html = `
            <div class="analytics-dashboard" style="margin-top:20px;">
                <!-- Row 1: High Level Cards -->
                <div class="grid-2">
                    <div class="card">
                        <div style="text-align:center; padding:15px;">
                            <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px;">Group Average</div>
                            <h3 style="color:#3498db; font-size:3rem; margin:5px 0;">${avgScore}%</h3>
                            <div style="font-size:0.8rem;">Across all assessments</div>
                        </div>
                    </div>
                    <div class="card">
                        <h3><i class="fas fa-trophy" style="color:#f1c40f; margin-right:10px;"></i>Top Performers</h3>
                        <div style="margin-top:15px;">
                            ${topPerformersHtml}
                        </div>
                    </div>
                </div>

                <!-- Row 2: Effort vs Performance -->
                <div class="card" style="margin-top:20px;">
                    <h3><i class="fas fa-balance-scale" style="color:var(--primary); margin-right:10px;"></i>Effort vs. Performance</h3>
                    <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:15px;">Correlation between Study Focus (Effort) and Assessment Scores (Performance).</p>
                    <div style="display:grid; grid-template-columns: 2fr 1fr 1fr 2fr; gap:10px; padding:8px; background:var(--bg-input); font-weight:bold; border-radius:4px;">
                        <div>Trainee</div><div>Focus</div><div>Score</div><div>Status</div>
                    </div>
                    <div style="max-height:300px; overflow-y:auto;">
                        ${effortHtml}
                    </div>
                </div>

                <!-- Row 3: Struggle Areas -->
                <div class="grid-2" style="margin-top:20px;">
                    <div class="card">
                        <h3><i class="fas fa-exclamation-circle" style="color:#ff5252; margin-right:10px;"></i>Group Struggle Areas</h3>
                        <p style="color:var(--text-muted); font-size:0.8rem; margin-bottom:10px;">Assessments where THIS group averages < 80%.</p>
                        <div style="max-height:250px; overflow-y:auto;">
                            ${struggleHtml}
                        </div>
                    </div>
                    <div class="card">
                        <h3><i class="fas fa-globe-americas" style="color:#e67e22; margin-right:10px;"></i>Global Pain Points</h3>
                        <p style="color:var(--text-muted); font-size:0.8rem; margin-bottom:10px;">Modules with high failure rates across ALL groups.</p>
                        <div style="max-height:250px; overflow-y:auto;">
                            ${globalPainHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = navHTML + html;
    },

    // 5. Group/Cohort UI
    renderGroupDashboard: function(container, groupId) {
        // Get available tests for filter
        const rosters = JSON.parse(localStorage.getItem('rosters') || '{}');
        const members = rosters[groupId] || [];
        const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
        const groupTests = new Set();
        submissions.forEach(s => {
            if (members.includes(s.trainee)) groupTests.add(s.testTitle);
        });
        
        const testOptions = Array.from(groupTests).sort().map(t => `<option value="${t}">${t}</option>`).join('');

        const gaps = this.calculateGroupGaps(groupId);
        
        // Fetch Lateness Data for this group
        const attendance = JSON.parse(localStorage.getItem('attendance_records') || '[]');
        
        // Filter lates for this group
        const groupLates = attendance.filter(r => members.includes(r.user) && r.isLate);
        // Sort by date desc
        groupLates.sort((a,b) => new Date(b.date) - new Date(a.date));

        // Fetch Badges (Aggregate)
        // We don't have a centralized badge store, so we calculate on fly or skip for now.
        // Let's skip badges for this iteration to keep it simple, or just count total lates.

        const gapsHtml = this.buildGapList(gaps);

        let latesHtml = '';
        if (groupLates.length > 0) {
            latesHtml = groupLates.slice(0, 5).map(l => `
                <div style="padding:8px; border-bottom:1px solid var(--border-color); font-size:0.85rem;">
                    <div style="display:flex; justify-content:space-between;">
                        <strong>${l.user}</strong>
                        <span style="color:var(--text-muted);">${l.date}</span>
                    </div>
                    <div style="color:#e74c3c; font-style:italic;">"${l.lateData ? l.lateData.reason : 'No reason'}"</div>
                </div>
            `).join('');
        } else {
            latesHtml = '<div style="padding:20px; text-align:center; color:var(--text-muted);">No recent lateness recorded.</div>';
        }

        const html = `
            <div class="grid-2" style="margin-top:20px;">
                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <h3 style="margin:0;"><i class="fas fa-fire" style="color:#ff5252; margin-right:10px;"></i>Knowledge Gaps</h3>
                        <select id="gapTestFilter" onchange="AnalyticsEngine.updateGroupHeatmap('${groupId}', this.value)" style="width:150px; margin:0; padding:5px; font-size:0.8rem; background:var(--bg-input); color:var(--text-main); border:1px solid var(--border-color); border-radius:4px;">
                            <option value="">All Tests</option>
                            ${testOptions}
                        </select>
                    </div>
                    <div id="groupGapContent" style="max-height:300px; overflow-y:auto;">${gapsHtml}</div>
                </div>
                <div class="card">
                    <h3><i class="fas fa-clock" style="color:#f1c40f; margin-right:10px;"></i>Recent Lateness</h3>
                    <div style="max-height:300px; overflow-y:auto;">${latesHtml}</div>
                </div>
            </div>`;
        
        // Append to container (assuming container already has header/nav)
        container.insertAdjacentHTML('beforeend', html);
    },

    updateGroupHeatmap: function(groupId, testFilter) {
        const gaps = this.calculateGroupGaps(groupId, testFilter || null);
        const container = document.getElementById('groupGapContent');
        if(container) container.innerHTML = this.buildGapList(gaps);
    },

    buildGapList: function(gaps) {
        if (gaps.length > 0) {
            return gaps.map(g => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--border-color);">
                    <div style="flex:1;">
                        <div style="font-weight:bold; font-size:0.9rem;">${g.question}</div>
                        <div style="font-size:0.8rem; color:var(--text-muted);">${g.test}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:bold; color:#ff5252;">${g.failureRate}% Fail</div>
                        <div style="font-size:0.7rem; color:var(--text-muted);">${g.count} Trainees</div>
                    </div>
                </div>
            `).join('');
        } else {
            return '<div style="padding:20px; text-align:center; color:var(--text-muted);">No significant knowledge gaps detected.</div>';
        }
    },

    // 6. Individual Profile UI
    renderIndividualProfile: function(container, userId) {
        const risk = this.calculateAtRiskScore(userId);
        
        // Fetch Data
        const records = JSON.parse(localStorage.getItem('records') || '[]');
        const attendance = JSON.parse(localStorage.getItem('attendance_records') || '[]');
        const notes = JSON.parse(localStorage.getItem('agentNotes') || '{}');
        const reviews = JSON.parse(localStorage.getItem('insightReviews') || '[]');

        // Filter
        const userRecords = records.filter(r => r.trainee === userId);
        const userLates = attendance.filter(r => r.user === userId && r.isLate);
        const userReviews = reviews.filter(r => r.trainee === userId);
        const userNote = notes[userId] || "No private notes.";

        // Build Timeline
        let timeline = [];
        
        userRecords.forEach(r => timeline.push({
            date: r.date,
            type: 'assessment',
            icon: 'fa-clipboard-check',
            title: r.assessment,
            detail: `Score: ${r.score}%`,
            isBad: r.score < 80
        }));

        userLates.forEach(l => timeline.push({
            date: l.date,
            type: 'late',
            icon: 'fa-clock',
            title: 'Late Arrival',
            detail: l.lateData ? l.lateData.reason : 'No reason provided',
            isBad: true
        }));

        userReviews.forEach(r => timeline.push({
            date: r.date ? r.date.split('T')[0] : 'Unknown',
            type: 'review',
            icon: 'fa-search',
            title: 'Admin Review',
            detail: `${r.status} - ${r.comment}`,
            isBad: r.status === 'Critical' || r.status === 'Fail'
        }));

        // Sort Timeline (Newest First)
        timeline.sort((a,b) => new Date(b.date) - new Date(a.date));

        // UI Logic
        let riskColor = '#2ecc71'; // Green
        let riskBg = 'rgba(46, 204, 113, 0.1)';
        
        if (risk >= 70) { 
            riskColor = '#ff5252'; // Red
            riskBg = 'rgba(255, 82, 82, 0.1)';
        } else if (risk >= 40) { 
            riskColor = '#f1c40f'; // Orange
            riskBg = 'rgba(241, 196, 15, 0.1)';
        }

        let timelineHtml = '';
        if (timeline.length > 0) {
            timelineHtml = timeline.map(t => `
                <div style="display:flex; gap:15px; padding-bottom:15px; border-left:2px solid var(--border-color); padding-left:20px; position:relative;">
                    <div style="position:absolute; left:-9px; top:0; width:16px; height:16px; border-radius:50%; background:${t.isBad ? '#ff5252' : 'var(--bg-card)'}; border:2px solid ${t.isBad ? '#ff5252' : 'var(--text-muted)'};"></div>
                    <div style="flex:1;">
                        <div style="font-size:0.8rem; color:var(--text-muted);">${t.date}</div>
                        <div style="font-weight:bold; margin-bottom:2px;"><i class="fas ${t.icon}" style="width:20px;"></i> ${t.title}</div>
                        <div style="font-size:0.9rem; color:${t.isBad ? '#ff5252' : 'var(--text-main)'};">${t.detail}</div>
                    </div>
                </div>
            `).join('');
        } else {
            timelineHtml = '<div style="color:var(--text-muted); font-style:italic;">No activity recorded.</div>';
        }

        const html = `
            <div class="analytics-profile" style="margin-top:20px;">
                <div class="card" style="border-left:5px solid ${riskColor}; background:${riskBg};">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <h3 style="margin:0; color:${riskColor};">At-Risk Score</h3>
                            <p style="margin:5px 0 0 0; font-size:0.9rem;">Calculated based on Focus, Attendance, and Grades.</p>
                        </div>
                        <div style="font-size:2.5rem; font-weight:800; color:${riskColor};">${risk}%</div>
                    </div>
                </div>

                <div class="grid-2">
                    <div class="card">
                        <h3><i class="fas fa-history" style="color:var(--primary); margin-right:10px;"></i>Activity Timeline</h3>
                        <div style="max-height:300px; overflow-y:auto; margin-top:15px;">
                            ${timelineHtml}
                        </div>
                    </div>
                    <div class="card">
                        <h3><i class="fas fa-sticky-note" style="color:#f1c40f; margin-right:10px;"></i>Private Notes</h3>
                        <div style="background:var(--bg-input); padding:15px; border-radius:8px; border:1px solid var(--border-color); min-height:100px; white-space:pre-wrap;">${userNote}</div>
                    </div>
                </div>
            </div>
        `;
        
        // Append to container
        container.insertAdjacentHTML('beforeend', html);
    }
};
