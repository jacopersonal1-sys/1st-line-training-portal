/* ================= ASSESSMENT QUIZ FLOW ================= */
/* Sequential quiz runtime (no per-question correctness reveal) */

(function initQuizFlowRuntime() {
    const QUIZ_RUNTIME_VERSION = 2;

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function isAnswerProvided(question, answer) {
        if (typeof isAssessmentAnswerProvided === 'function') {
            return isAssessmentAnswerProvided(question, answer);
        }
        if (!question) return false;
        const type = String(question.type || 'multiple_choice');
        if (type === 'multi_select' || type === 'drag_drop' || type === 'ranking') {
            return Array.isArray(answer) && answer.length > 0;
        }
        if (type === 'matching') {
            const expected = Array.isArray(question.pairs) ? question.pairs.length : 0;
            return Array.isArray(answer) && answer.length >= expected && answer.every(v => String(v || '').trim());
        }
        if (type === 'matrix') {
            const expected = Array.isArray(question.rows) ? question.rows.length : 0;
            return !!answer && typeof answer === 'object' && Object.keys(answer).length >= expected;
        }
        return !(answer === undefined || answer === null || answer === '');
    }

    function getDefaultFallbackSubject() {
        const ctx = window.CURRENT_TEST_CONTEXT || {};
        const code = String(ctx.subjectCode || '').trim();
        const title = String(ctx.subjectTitle || '').trim();
        if (code && title) return `${code} - ${title}`;
        return code || title || '';
    }

    const QuizFlow = {
        ensureState: function(containerId = 'takingQuestions') {
            if (!window.CURRENT_TEST) return null;
            const total = Array.isArray(window.CURRENT_TEST.questions) ? window.CURRENT_TEST.questions.length : 0;
            const existing = (window.CURRENT_TEST.quizRuntimeState && typeof window.CURRENT_TEST.quizRuntimeState === 'object')
                ? window.CURRENT_TEST.quizRuntimeState
                : null;

            const state = {
                version: QUIZ_RUNTIME_VERSION,
                containerId,
                currentIndex: 0,
                finished: false
            };

            if (existing && Number(existing.version || 0) === QUIZ_RUNTIME_VERSION) {
                state.currentIndex = Number.isFinite(Number(existing.currentIndex))
                    ? Math.max(0, Math.min(total > 0 ? total - 1 : 0, Number(existing.currentIndex)))
                    : 0;
                state.finished = !!existing.finished;
                state.containerId = existing.containerId || containerId;
            }

            window.CURRENT_TEST.quizRuntimeState = state;
            return state;
        },

        persistState: function() {
            if (!window.CURRENT_TEST || !window.CURRENT_TEST.quizRuntimeState) return;
            window.CURRENT_TEST.quizRuntimeState = {
                ...window.CURRENT_TEST.quizRuntimeState,
                version: QUIZ_RUNTIME_VERSION
            };
            if (typeof saveAssessmentDraft === 'function') {
                try { saveAssessmentDraft(); } catch (error) {}
            }
        },

        bindAutosave: function(container) {
            if (!container || container.dataset.quizAutosaveBound === '1') return;
            container.addEventListener('input', () => {
                if (typeof saveAssessmentDraft === 'function') saveAssessmentDraft();
            });
            container.addEventListener('change', () => {
                if (typeof saveAssessmentDraft === 'function') saveAssessmentDraft();
            });
            container.dataset.quizAutosaveBound = '1';
        },

        getSummary: function() {
            const questions = Array.isArray(window.CURRENT_TEST?.questions) ? window.CURRENT_TEST.questions : [];
            const fallbackSubject = getDefaultFallbackSubject();
            const failedSubjects = [];
            const failedSubjectSet = new Set();

            questions.forEach((question, idx) => {
                const answer = window.USER_ANSWERS[idx];
                const calc = typeof calculateQuestionAutoScore === 'function'
                    ? calculateQuestionAutoScore(question, answer)
                    : { score: 0, pointsMax: 0, requiresManual: false };
                const isFailed = !calc.requiresManual && Number(calc.score || 0) < Number(calc.pointsMax || 0);
                if (!isFailed) return;
                const mapped = String(question.reviewSubject || fallbackSubject || '').trim();
                if (!mapped) return;
                const key = mapped.toLowerCase();
                if (failedSubjectSet.has(key)) return;
                failedSubjectSet.add(key);
                failedSubjects.push(mapped);
            });

            const result = (typeof calculateAssessmentAutoResult === 'function')
                ? calculateAssessmentAutoResult(window.CURRENT_TEST, window.USER_ANSWERS)
                : { percent: 0, autoPoints: 0, maxPoints: 0, needsManual: false };

            return {
                percent: Number(result.percent || 0),
                autoPoints: Number(result.autoPoints || 0),
                maxPoints: Number(result.maxPoints || 0),
                needsManual: !!result.needsManual,
                failedSubjects
            };
        },

        renderSummary: function(container) {
            const summary = this.getSummary();
            const subjectsHtml = summary.failedSubjects.length
                ? summary.failedSubjects.map(subject => `<li>${escapeHtml(subject)}</li>`).join('')
                : '<li>No review subjects required from this attempt.</li>';

            const subtitle = summary.needsManual
                ? 'Some question types still require manual review by admin.'
                : 'Quiz completed. Review these subjects, restudy, and retake if needed.';

            container.innerHTML = `
                <div class="test-paper">
                    <div class="test-paper-head">
                        <div class="test-paper-eyebrow">Quiz Complete</div>
                        <h2 class="test-paper-title">${escapeHtml(window.CURRENT_TEST?.title || 'Questionnaire')}</h2>
                        <p class="test-paper-subtitle">${escapeHtml(subtitle)}</p>
                        <div class="test-paper-meta">
                            <span><i class="fas fa-percent"></i> Score: ${summary.percent}%</span>
                            <span><i class="fas fa-check-double"></i> ${summary.autoPoints} / ${summary.maxPoints} points</span>
                        </div>
                    </div>

                    <div style="padding:16px; border:1px solid var(--border-color); border-radius:10px; background:var(--bg-input); margin-bottom:20px;">
                        <div style="font-weight:700; margin-bottom:8px;">Subjects To Review</div>
                        <ul style="margin:0; padding-left:18px; line-height:1.6;">${subjectsHtml}</ul>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
                        <button class="btn-secondary" type="button" onclick="QuizFlow.backToLastQuestion()"><i class="fas fa-arrow-left"></i> Back</button>
                        <button class="btn-primary" type="button" onclick="QuizFlow.finalizeQuizSubmission()"><i class="fas fa-paper-plane"></i> Submit Quiz</button>
                    </div>
                </div>
            `;
        },

        renderQuestion: function(container, state) {
            const questions = Array.isArray(window.CURRENT_TEST?.questions) ? window.CURRENT_TEST.questions : [];
            if (!questions.length) {
                container.innerHTML = '<div class="test-paper"><p class="test-paper-subtitle">No quiz questions configured.</p></div>';
                return;
            }

            const idx = Math.max(0, Math.min(questions.length - 1, Number(state.currentIndex || 0)));
            state.currentIndex = idx;
            const question = questions[idx];
            const answer = window.USER_ANSWERS[idx];
            const answered = isAnswerProvided(question, answer);
            const isLast = idx === questions.length - 1;
            const title = window.CURRENT_TEST?.title || 'Questionnaire';

            container.innerHTML = `
                <div class="test-paper">
                    <div class="test-paper-head">
                        <div class="test-paper-eyebrow">Quiz Question ${idx + 1} of ${questions.length}</div>
                        <h2 class="test-paper-title">${escapeHtml(title)}</h2>
                        <p class="test-paper-subtitle">Answer each question in sequence. Results only appear after you finish the full quiz.</p>
                        <div class="test-paper-meta">
                            <span><i class="fas fa-list-ol"></i> Progress: ${idx + 1}/${questions.length}</span>
                        </div>
                    </div>

                    <div class="taking-card ${answered ? 'answered' : ''}" id="card_q_${idx}" style="margin-bottom:22px;">
                        <div class="q-text-large taking-question-title" style="font-weight:700; font-size:1.2rem; margin-bottom:16px; line-height:1.5;">
                            ${idx + 1}. ${question.text || ''}
                            <span class="taking-points-chip" style="font-size:0.8rem; font-weight:normal; color:var(--text-muted); float:right; margin-left:10px;">(${question.points || 1} pts)</span>
                        </div>
                        <div class="question-input-area" id="q_area_${idx}">${typeof renderQuestionInput === 'function' ? renderQuestionInput(question, idx) : ''}</div>
                    </div>

                    <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; border-top:1px solid var(--border-color); padding-top:18px;">
                        <button class="btn-secondary" type="button" onclick="QuizFlow.previousQuestion()" ${idx > 0 ? '' : 'disabled'}><i class="fas fa-arrow-left"></i> Previous</button>
                        <button class="btn-primary" type="button" onclick="QuizFlow.nextQuestion()">${isLast ? '<i class="fas fa-flag-checkered"></i> Finish Quiz' : '<i class="fas fa-arrow-right"></i> Next Question'}</button>
                    </div>
                </div>
            `;

            setTimeout(() => {
                container.querySelectorAll('textarea.auto-expand').forEach(el => autoResize(el));
            }, 0);
        },

        render: function(containerId = 'takingQuestions') {
            const container = document.getElementById(containerId);
            if (!container) return;
            const state = this.ensureState(containerId);
            if (!state) return;

            if (state.finished) this.renderSummary(container);
            else this.renderQuestion(container, state);

            this.bindAutosave(container);
            this.persistState();
        },

        nextQuestion: function() {
            const state = this.ensureState();
            if (!state) return;
            const questions = Array.isArray(window.CURRENT_TEST?.questions) ? window.CURRENT_TEST.questions : [];
            const idx = Number(state.currentIndex || 0);
            const question = questions[idx];
            if (!question) return;

            const answer = window.USER_ANSWERS[idx];
            if (!isAnswerProvided(question, answer)) {
                if (typeof showToast === 'function') showToast('Please answer this question before continuing.', 'warning');
                return;
            }

            if (idx >= questions.length - 1) {
                state.finished = true;
            } else {
                state.currentIndex = idx + 1;
            }

            this.persistState();
            this.render(state.containerId || 'takingQuestions');
        },

        previousQuestion: function() {
            const state = this.ensureState();
            if (!state) return;
            const idx = Number(state.currentIndex || 0);
            if (idx <= 0) return;
            state.currentIndex = idx - 1;
            this.persistState();
            this.render(state.containerId || 'takingQuestions');
        },

        backToLastQuestion: function() {
            const state = this.ensureState();
            if (!state) return;
            const questions = Array.isArray(window.CURRENT_TEST?.questions) ? window.CURRENT_TEST.questions : [];
            state.finished = false;
            state.currentIndex = Math.max(0, questions.length - 1);
            this.persistState();
            this.render(state.containerId || 'takingQuestions');
        },

        finalizeQuizSubmission: function() {
            if (typeof submitTest === 'function') {
                submitTest(false, { skipConfirm: true, fromQuizFlow: true });
            }
        }
    };

    window.QuizFlow = QuizFlow;
})();
