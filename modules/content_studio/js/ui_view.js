/* ================= CONTENT STUDIO VIEW UI ================= */

const ViewUI = {
    state: {
        selectedScheduleKey: '',
        selectedSubjectId: '',
        modal: {
            open: false,
            subjectId: '',
            entryId: '',
            watchBuffer: 0,
            lastTime: 0,
            seekStart: null
        }
    },

    initDefaultSelection: function() {
        const options = DataService.getScheduleOptions();
        if (!this.state.selectedScheduleKey && options.length) {
            this.state.selectedScheduleKey = options[0].key;
        }

        const entry = DataService.getEntryByScheduleKey(this.state.selectedScheduleKey);
        if (entry && entry.subjects && entry.subjects.length) {
            const exists = entry.subjects.some(s => s.id === this.state.selectedSubjectId);
            if (!exists) this.state.selectedSubjectId = entry.subjects[0].id;
        } else {
            this.state.selectedSubjectId = '';
        }
    },

    setScheduleKey: function(value) {
        this.state.selectedScheduleKey = value;
        this.state.selectedSubjectId = '';
        App.render();
    },

    setSubjectId: function(value) {
        this.state.selectedSubjectId = value;
        App.render();
        const row = document.querySelector(`[data-subject-id="${value}"]`);
        if (row && row.scrollIntoView) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    openDocument: function(url) {
        if (!url) {
            alert('No document link configured for this subject yet.');
            return;
        }
        window.open(url, '_blank');
    },

    openVideo: function(entryId, subjectId) {
        const entry = DataService.getEntries().find(e => e.id === entryId);
        const subject = entry ? (entry.subjects || []).find(s => s.id === subjectId) : null;
        if (!subject || !subject.videoUrl) {
            alert('No video link configured for this subject yet.');
            return;
        }

        const username = (AppContext.user && AppContext.user.user) ? AppContext.user.user : 'unknown_user';
        DataService.recordPlay(entryId, subjectId, username);

        this.state.modal = {
            open: true,
            subjectId,
            entryId,
            watchBuffer: 0,
            lastTime: 0,
            seekStart: null
        };
        App.render();
        this.bindVideoTracker();
    },

    closeVideo: function() {
        this.flushWatchBuffer();
        this.state.modal.open = false;
        this.state.modal.subjectId = '';
        this.state.modal.entryId = '';
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

    formatDuration: function(seconds) {
        const total = Math.max(0, Math.round(Number(seconds || 0)));
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    },

    render: function() {
        this.initDefaultSelection();
        const esc = App.escapeHtml;
        const options = DataService.getScheduleOptions();
        const entry = DataService.getEntryByScheduleKey(this.state.selectedScheduleKey);
        const subjects = entry ? (entry.subjects || []) : [];
        const username = (AppContext.user && AppContext.user.user) ? AppContext.user.user : 'unknown_user';

        const subjectRows = subjects.map(subject => {
            const userStats = DataService.getUserSubjectAnalytics(entry.id, subject.id, username);
            const isActive = this.state.selectedSubjectId === subject.id;
            const textHtml = ContentStudioUtils.sanitizeRichHtml(subject.textHtml || '');
            return `
                <div class="cs-subject-row ${isActive ? 'is-active' : ''}" data-subject-id="${esc(subject.id)}">
                    <div class="cs-subject-index">${esc(subject.code)}</div>
                    <div class="cs-subject-text">${textHtml || '<span class="cs-muted">No subject text captured.</span>'}</div>
                    <div class="cs-subject-actions">
                        <button class="cs-icon-btn" title="Play Video" onclick="ViewUI.openVideo('${esc(entry.id)}', '${esc(subject.id)}')">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="cs-icon-btn" title="Open Document" onclick="ViewUI.openDocument('${esc(subject.docUrl || '')}')">
                            <i class="fas fa-link"></i>
                        </button>
                    </div>
                    <div class="cs-subject-metrics">
                        Watched ${this.formatDuration(userStats.watchSeconds)} | Skips ${userStats.skips}
                    </div>
                </div>
            `;
        }).join('');

        const subjectDropdown = subjects.map(s => `<option value="${esc(s.id)}" ${this.state.selectedSubjectId === s.id ? 'selected' : ''}>${esc(`${s.code} - ${ContentStudioUtils.stripHtml(s.textHtml).slice(0, 72)}`)}</option>`).join('');

        const modalHtml = (() => {
            if (!this.state.modal.open || !entry) return '';
            const subject = subjects.find(s => s.id === this.state.modal.subjectId);
            if (!subject) return '';
            return `
                <div class="cs-modal-backdrop" onclick="ViewUI.closeVideo()">
                    <div class="cs-modal" onclick="event.stopPropagation()">
                        <div class="cs-modal-head">
                            <h3>${esc(subject.code)} - ${esc(ContentStudioUtils.stripHtml(subject.textHtml).slice(0, 100))}</h3>
                            <button class="cs-icon-btn" onclick="ViewUI.closeVideo()"><i class="fas fa-xmark"></i></button>
                        </div>
                        <video id="cs-video-player" controls autoplay playsinline src="${esc(subject.videoUrl || '')}" style="width:100%; border-radius:10px; background:#000;"></video>
                    </div>
                </div>
            `;
        })();

        return `
            <div class="cs-shell">
                <div class="cs-toolbar">
                    <div class="cs-field">
                        <label>Schedule Timeline Item</label>
                        <select onchange="ViewUI.setScheduleKey(this.value)">
                            <option value="">-- Select Timeline Item --</option>
                            ${options.map(opt => `<option value="${esc(opt.key)}" ${this.state.selectedScheduleKey === opt.key ? 'selected' : ''}>${esc(opt.label)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="cs-field">
                        <label>Subjects</label>
                        <select onchange="ViewUI.setSubjectId(this.value)" ${subjects.length ? '' : 'disabled'}>
                            <option value="">-- Select Subject --</option>
                            ${subjectDropdown}
                        </select>
                    </div>
                </div>

                ${entry ? `
                    <div class="cs-document-shell">
                        <div class="cs-doc-header">
                            <h2>${esc(entry.header || entry.scheduleLabel || 'Header goes here')}</h2>
                        </div>
                        <div class="cs-doc-body">
                            ${subjectRows || '<p class="cs-muted">No subjects have been built for this timeline item yet. Open Builder to add subjects.</p>'}
                        </div>
                    </div>
                ` : `
                    <div class="cs-empty">
                        <h3>Nothing linked yet</h3>
                        <p>Select a timeline item above. If subjects were not built yet, use the Builder tab to create the header and subject list.</p>
                    </div>
                `}
            </div>
            ${modalHtml}
        `;
    }
};

window.ViewUI = ViewUI;
