/* ================= CONTENT STUDIO VIEW UI ================= */

const ViewUI = {
    state: {
        selectedSubjectId: '',
        modal: {
            open: false,
            assetType: '',
            subjectId: '',
            entryId: '',
            watchBuffer: 0,
            lastTime: 0,
            seekStart: null,
            videoUrl: '',
            documentUrl: ''
        }
    },

    initDefaultSelection: function() {
        const entry = (typeof App.getActiveEntry === 'function') ? App.getActiveEntry() : DataService.getPrimaryEntry();
        if (entry && entry.subjects && entry.subjects.length) {
            const exists = entry.subjects.some(s => s.id === this.state.selectedSubjectId);
            if (!exists) this.state.selectedSubjectId = entry.subjects[0].id;
        } else {
            this.state.selectedSubjectId = '';
        }
    },

    setSubjectId: function(value) {
        this.state.selectedSubjectId = value;
        App.render();
        const row = document.querySelector(`[data-subject-id="${value}"]`);
        if (row && row.scrollIntoView) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    formatTimestamp: function(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds || 0)));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m}:${s.toString().padStart(2, '0')}`;
    },

    openDocument: async function(subjectId) {
        const entry = (typeof App.getActiveEntry === 'function') ? App.getActiveEntry() : DataService.getPrimaryEntry();
        const subject = entry ? (entry.subjects || []).find(s => s.id === subjectId) : null;
        if (!subject || !subject.hasDocument) return;
        this.state.selectedSubjectId = subjectId;

        const resolvedUrl = await DataService.resolveStorageUrl(subject.docBucket, subject.docPath, subject.docUrl);
        if (!resolvedUrl) {
            alert('No document link configured for this subject yet.');
            return;
        }

        const username = (AppContext.user && AppContext.user.user) ? AppContext.user.user : 'unknown_user';
        DataService.recordPlay(entry.id, subjectId, username);

        this.state.modal = {
            open: true,
            assetType: 'document',
            subjectId,
            entryId: entry.id,
            watchBuffer: 0,
            lastTime: 0,
            seekStart: null,
            videoUrl: '',
            documentUrl: resolvedUrl
        };
        App.render();
    },

    openVideo: async function(entryId, subjectId) {
        const entry = DataService.getEntries().find(e => e.id === entryId);
        const subject = entry ? (entry.subjects || []).find(s => s.id === subjectId) : null;
        if (!subject || !subject.hasVideo) return;
        this.state.selectedSubjectId = subjectId;

        const resolvedUrl = await DataService.resolveStorageUrl(subject.videoBucket, subject.videoPath, subject.videoUrl);
        if (!resolvedUrl) {
            alert('No video link configured for this subject yet.');
            return;
        }

        const username = (AppContext.user && AppContext.user.user) ? AppContext.user.user : 'unknown_user';
        DataService.recordPlay(entryId, subjectId, username);

        this.state.modal = {
            open: true,
            assetType: 'video',
            subjectId,
            entryId,
            watchBuffer: 0,
            lastTime: 0,
            seekStart: null,
            videoUrl: resolvedUrl,
            documentUrl: ''
        };
        App.render();
        this.bindVideoTracker();
        this.renderAnnotationList();
    },

    requestHostQuizLaunch: function(payload) {
        const safePayload = (payload && typeof payload === 'object') ? payload : {};
        const id = String(safePayload.testId || '').trim();
        if (!id) return false;

        // Primary bridge for Electron webview guest -> host renderer.
        try {
            if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                if (ipcRenderer && typeof ipcRenderer.sendToHost === 'function') {
                    ipcRenderer.sendToHost('content-studio-open-quiz', safePayload);
                    return true;
                }
            }
        } catch (err) {}

        // Fallback bridge for iframe/browser embedding.
        try {
            if (window.parent && window.parent !== window) {
                if (typeof window.parent.openTestTaker === 'function') {
                    window.parent.openTestTaker(id, true, {
                        popupMode: true,
                        returnTab: 'content-studio',
                        source: 'content-studio-fallback',
                        contentStudioContext: {
                            source: 'content_studio',
                            launchSurface: 'content_creator_view',
                            entryId: String(safePayload.entryId || ''),
                            subjectId: String(safePayload.subjectId || ''),
                            subjectCode: String(safePayload.subjectCode || ''),
                            subjectTitle: String(safePayload.subjectTitle || ''),
                            testId: id
                        }
                    });
                    return true;
                }
                if (typeof window.parent.postMessage === 'function') {
                    window.parent.postMessage({ type: 'content-studio-open-quiz', payload: safePayload }, '*');
                    return true;
                }
            }
        } catch (err) {}

        return false;
    },

    openQuestionnaire: function(subjectId) {
        const entry = (typeof App.getActiveEntry === 'function') ? App.getActiveEntry() : DataService.getPrimaryEntry();
        const subject = entry ? (entry.subjects || []).find(s => s.id === subjectId) : null;
        if (!subject || !subject.hasQuestionnaire) return;
        this.state.selectedSubjectId = subjectId;

        const testId = String(subject.questionnaireTestId || '').trim();
        if (!testId) {
            alert('No quiz has been linked for this subject.');
            return;
        }

        const linkedTest = DataService.getTestById(testId);
        if (!linkedTest) {
            alert('Linked quiz test could not be found. Refresh Content Creator or relink this subject.');
            return;
        }

        if (!this.requestHostQuizLaunch({
            testId,
            entryId: entry ? entry.id : '',
            subjectId: subject.id || '',
            subjectCode: subject.code || '',
            subjectTitle: ContentStudioUtils.stripHtml(subject.textHtml || '').slice(0, 120)
        })) {
            alert('Could not launch quiz from Content Creator in this runtime.');
        }
    },

    closeVideo: function() {
        if (this.state.modal.assetType === 'video') this.flushWatchBuffer();
        this.state.modal.open = false;
        this.state.modal.assetType = '';
        this.state.modal.subjectId = '';
        this.state.modal.entryId = '';
        this.state.modal.videoUrl = '';
        this.state.modal.documentUrl = '';
        App.render();
    },

    flushWatchBuffer: function(videoEl) {
        const seconds = this.state.modal.watchBuffer;
        if (!(seconds > 0)) return;

        const username = (AppContext.user && AppContext.user.user) ? AppContext.user.user : 'unknown_user';
        const lastPosition = videoEl ? Number(videoEl.currentTime || 0) : this.state.modal.lastTime;
        DataService.recordWatchDelta(this.state.modal.entryId, this.state.modal.subjectId, username, seconds, lastPosition);
        this.state.modal.watchBuffer = 0;
    },

    bindVideoTracker: function() {
        if (this.state.modal.assetType !== 'video') return;
        const video = document.getElementById('cs-video-player');
        if (!video) return;

        const username = (AppContext.user && AppContext.user.user) ? AppContext.user.user : 'unknown_user';

        const onPlay = () => {
            this.state.modal.lastTime = Number(video.currentTime || 0);
        };

        const onTimeUpdate = () => {
            if (video.paused || video.seeking) return;
            const current = Number(video.currentTime || 0);
            const delta = current - this.state.modal.lastTime;
            if (delta > 0 && delta < 2.5) {
                this.state.modal.watchBuffer += delta;
                if (this.state.modal.watchBuffer >= 5) this.flushWatchBuffer(video);
            }
            this.state.modal.lastTime = current;
        };

        const onSeeking = () => {
            this.state.modal.seekStart = Number(this.state.modal.lastTime || video.currentTime || 0);
        };

        const onSeeked = () => {
            const from = Number(this.state.modal.seekStart || this.state.modal.lastTime || 0);
            const to = Number(video.currentTime || 0);
            if (to - from > 2.5) {
                DataService.recordSkip(this.state.modal.entryId, this.state.modal.subjectId, username, from, to);
            }
            this.state.modal.lastTime = to;
            this.state.modal.seekStart = null;
        };

        const onPause = () => this.flushWatchBuffer(video);
        const onEnded = () => this.flushWatchBuffer(video);

        video.addEventListener('play', onPlay);
        video.addEventListener('timeupdate', onTimeUpdate);
        video.addEventListener('seeking', onSeeking);
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('pause', onPause);
        video.addEventListener('ended', onEnded);
    },

    jumpToAnnotation: function(seconds) {
        const video = document.getElementById('cs-video-player');
        if (!video) return;
        const sec = Math.max(0, Number(seconds || 0));
        video.currentTime = sec;
        video.play().catch(() => {});
    },

    renderAnnotationList: function() {
        const listEl = document.getElementById('cs-video-annotation-list');
        if (!listEl || !this.state.modal.open) return;

        const username = (AppContext.user && AppContext.user.user) ? AppContext.user.user : 'unknown_user';
        const notes = DataService.getSubjectAnnotations(this.state.modal.entryId, this.state.modal.subjectId, username);
        if (!notes.length) {
            listEl.innerHTML = `<div class="cs-note-empty">No notes/questions yet for this video.</div>`;
            return;
        }

        const rows = notes.map(n => {
            const chipClass = n.type === 'question' ? 'question' : 'note';
            const typeLabel = n.type === 'question' ? 'Question' : 'Note';
            const ts = this.formatTimestamp(n.timestampSec);
            const safeText = App.escapeHtml(n.text || '');
            const safeStamp = App.escapeHtml(this.formatDateTime ? this.formatDateTime(n.createdAt) : (n.createdAt || ''));
            return `
                <div class="cs-note-item">
                    <div class="cs-note-meta">
                        <span class="cs-note-chip ${chipClass}">${typeLabel}</span>
                        <button type="button" class="btn-secondary btn-sm" onclick="ViewUI.jumpToAnnotation(${Number(n.timestampSec || 0)})">${ts}</button>
                        <span class="cs-note-date">${safeStamp}</span>
                    </div>
                    <div class="cs-note-text">${safeText}</div>
                </div>
            `;
        }).join('');

        listEl.innerHTML = rows;
    },

    addNoteQuestionAtCurrentTime: async function() {
        const video = document.getElementById('cs-video-player');
        if (!video || !this.state.modal.open) return;

        video.pause();
        this.flushWatchBuffer(video);
        const current = Number(video.currentTime || 0);
        const isQuestion = confirm('Create as Question? Click OK for Question, Cancel for Note.');
        const type = isQuestion ? 'question' : 'note';
        const text = prompt(`Add ${type} at ${this.formatTimestamp(current)}:`, '');
        if (text === null) return;

        const clean = String(text || '').trim();
        if (!clean) return;
        const username = (AppContext.user && AppContext.user.user) ? AppContext.user.user : 'unknown_user';

        const result = await DataService.addVideoAnnotation(
            this.state.modal.entryId,
            this.state.modal.subjectId,
            username,
            type,
            clean,
            current
        );
        if (!result.ok) {
            alert(result.message || 'Could not save note/question.');
            return;
        }
        this.renderAnnotationList();
    },

    formatDuration: function(seconds) {
        const total = Math.max(0, Math.round(Number(seconds || 0)));
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    },

    formatDateTime: function(value) {
        if (!value) return '-';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '-';
        return d.toLocaleString();
    },

    render: function() {
        this.initDefaultSelection();
        const esc = App.escapeHtml;
        const entry = (typeof App.getActiveEntry === 'function') ? App.getActiveEntry() : DataService.getPrimaryEntry();
        const subjects = entry ? (entry.subjects || []) : [];
        const username = (AppContext.user && AppContext.user.user) ? AppContext.user.user : 'unknown_user';

        const subjectRows = subjects.map(subject => {
            const userStats = DataService.getUserSubjectAnalytics(entry.id, subject.id, username);
            const isActive = this.state.selectedSubjectId === subject.id;
            const textHtml = ContentStudioUtils.sanitizeRichHtml(subject.textHtml || '');
            const showVideoIcon = !!subject.hasVideo && (!!subject.videoUrl || !!subject.videoPath);
            const showDocIcon = !!subject.hasDocument && (!!subject.docUrl || !!subject.docPath);
            const showQuizIcon = !!subject.hasQuestionnaire && !!subject.questionnaireTestId;

            return `
                <div class="cs-subject-row ${isActive ? 'is-active' : ''}" data-subject-id="${esc(subject.id)}" onclick="ViewUI.setSubjectId('${esc(subject.id)}')">
                    <div class="cs-subject-index">${esc(subject.code)}</div>
                    <div class="cs-subject-text">${textHtml || '<span class="cs-muted">No subject text captured.</span>'}</div>
                    <div class="cs-subject-actions">
                        ${showVideoIcon ? `
                            <button class="cs-icon-btn" title="Play Video" onclick="event.stopPropagation(); ViewUI.openVideo('${esc(entry.id)}', '${esc(subject.id)}')">
                                <i class="fas fa-play"></i>
                            </button>
                        ` : ''}
                        ${showDocIcon ? `
                            <button class="cs-icon-btn" title="Open Document" onclick="event.stopPropagation(); ViewUI.openDocument('${esc(subject.id)}')">
                                <i class="fas fa-link"></i>
                            </button>
                        ` : ''}
                        ${showQuizIcon ? `
                            <button class="cs-icon-btn" title="Open Questionnaire" onclick="event.stopPropagation(); ViewUI.openQuestionnaire('${esc(subject.id)}')">
                                <i class="fas fa-circle-question"></i>
                            </button>
                        ` : ''}
                    </div>
                    <div class="cs-subject-metrics">
                        Watched ${this.formatDuration(userStats.watchSeconds)} | Skips ${userStats.skips}
                    </div>
                </div>
            `;
        }).join('');

        const modalHtml = (() => {
            if (!this.state.modal.open || !entry) return '';
            const subject = subjects.find(s => s.id === this.state.modal.subjectId);
            if (!subject) return '';
            const isVideo = this.state.modal.assetType === 'video';
            return `
                <div class="cs-modal-backdrop" onclick="ViewUI.closeVideo()">
                    <div class="cs-modal" onclick="event.stopPropagation()">
                        <div class="cs-modal-head">
                            <h3>${esc(subject.code)} - ${esc(ContentStudioUtils.stripHtml(subject.textHtml).slice(0, 100))}</h3>
                            <button class="cs-icon-btn" onclick="ViewUI.closeVideo()"><i class="fas fa-xmark"></i></button>
                        </div>
                        ${isVideo ? `
                            <div class="cs-video-actions">
                                <button type="button" class="btn-secondary btn-sm" onclick="ViewUI.addNoteQuestionAtCurrentTime()">
                                    <i class="fas fa-note-sticky"></i> Add Note / Question
                                </button>
                            </div>
                            <video id="cs-video-player" controls controlsList="nodownload noplaybackrate" disablePictureInPicture oncontextmenu="return false;" autoplay playsinline src="${esc(this.state.modal.videoUrl || '')}" style="width:100%; max-height:68vh; border-radius:10px; background:#000;"></video>
                            <div class="cs-note-panel">
                                <h4>My Notes & Questions</h4>
                                <div id="cs-video-annotation-list"></div>
                            </div>
                        ` : `
                            <iframe src="${esc(this.state.modal.documentUrl || '')}" style="width:100%; height:80vh; border:1px solid var(--cs-border); border-radius:10px; background:#fff;" title="Document Viewer"></iframe>
                            <div style="display:flex; justify-content:flex-end; margin-top:10px;">
                                <a class="btn-secondary btn-sm" href="${esc(this.state.modal.documentUrl || '')}" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> Open in New Tab</a>
                            </div>
                        `}
                    </div>
                </div>
            `;
        })();

        return `
            <div class="cs-shell">
                ${entry ? `
                    <div class="cs-document-shell">
                        <div class="cs-doc-header">
                            <h2>${esc(entry.header || 'Content Creator')}</h2>
                        </div>
                        <div class="cs-doc-body">
                            ${subjectRows || '<p class="cs-muted">No subjects have been built yet. Open Builder to add subjects.</p>'}
                        </div>
                    </div>
                ` : `
                    <div class="cs-empty">
                        <h3>No content yet</h3>
                        <p>Use the Builder tab to create a header and subject list.</p>
                    </div>
                `}
            </div>
            ${modalHtml}
        `;
    }
};

window.ViewUI = ViewUI;
