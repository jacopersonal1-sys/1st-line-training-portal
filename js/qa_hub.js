/* ================= Q&A HUB LOADER + HOST BRIDGE ================= */
const QAHub = {
    dataKey: 'qa_data',

    esc(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    jsString(value) {
        return String(value || '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r?\n/g, ' ');
    },

    renderUI() {
        const container = document.getElementById('qa-hub-content');
        if (!container) return;

        if (!CURRENT_USER || !['admin', 'super_admin'].includes(CURRENT_USER.role)) {
            container.innerHTML = `
                <div class="card" style="max-width:760px; margin:24px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252; margin-bottom:8px;">Access Denied</h3>
                    <p style="color:var(--text-muted); margin:0;">Q&A Hub is available to Admin and Super Admin only.</p>
                </div>
            `;
            return;
        }

        const userParam = encodeURIComponent(JSON.stringify(CURRENT_USER || {}));
        const credsParam = encodeURIComponent(JSON.stringify(window.CLOUD_CREDENTIALS || {}));
        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const modulePath = `${basePath}/modules/qa_hub/index.html`;

        container.innerHTML = `
            <iframe
                id="qa-hub-frame"
                src="${modulePath}?user=${userParam}&creds=${credsParam}"
                title="Q&A Hub"
                style="width:100%; height:calc(100vh - 190px); border:none; background:transparent;"
            ></iframe>
        `;

        const frame = document.getElementById('qa-hub-frame');
        if (frame) {
            frame.addEventListener('load', () => {
                if (typeof applyThemeToEmbeddedFrame === 'function') applyThemeToEmbeddedFrame(frame);
            });
        }
    },

    async submitTraineeQuestion(questionText) {
        const text = String(questionText || '').trim();
        if (!text) return false;

        if (typeof loadFromServer === 'function') {
            try { await loadFromServer(true); } catch (error) {}
        }

        let data = {};
        try {
            data = JSON.parse(localStorage.getItem(this.dataKey) || '{}') || {};
        } catch (error) {
            data = {};
        }

        if (!Array.isArray(data.questions)) data.questions = [];
        if (!Array.isArray(data.submissions)) data.submissions = [];

        data.submissions.unshift({
            id: `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            question: text,
            trainee: CURRENT_USER && CURRENT_USER.user ? CURRENT_USER.user : 'Trainee',
            status: 'new',
            createdAt: new Date().toISOString()
        });
        data.updatedAt = new Date().toISOString();
        data.updatedBy = CURRENT_USER && CURRENT_USER.user ? CURRENT_USER.user : 'Trainee';

        localStorage.setItem(this.dataKey, JSON.stringify(data));
        if (typeof emitDataChange === 'function') emitDataChange(this.dataKey, 'qa_trainee_submit');

        if (typeof saveToServer === 'function') {
            const ok = await saveToServer([this.dataKey], true, false);
            if (ok && typeof showToast === 'function') showToast('Question sent to the admin team.', 'success');
            return ok;
        }
        return true;
    },

    getData() {
        try {
            return JSON.parse(localStorage.getItem(this.dataKey) || '{}') || {};
        } catch (error) {
            return { questions: [], submissions: [], updatedAt: null, updatedBy: null };
        }
    },

    async saveData(data) {
        const normalized = data && typeof data === 'object' ? data : {};
        if (!Array.isArray(normalized.questions)) normalized.questions = [];
        if (!Array.isArray(normalized.submissions)) normalized.submissions = [];
        normalized.updatedAt = new Date().toISOString();
        normalized.updatedBy = CURRENT_USER && CURRENT_USER.user ? CURRENT_USER.user : 'Admin';
        localStorage.setItem(this.dataKey, JSON.stringify(normalized));
        if (typeof emitDataChange === 'function') emitDataChange(this.dataKey, 'qa_admin_bridge');
        if (typeof saveToServer === 'function') {
            return await saveToServer([this.dataKey], true, false);
        }
        return true;
    },

    inferResourceType(resource = {}) {
        const type = String(resource.type || '').toLowerCase();
        const mime = String(resource.mime || '').toLowerCase();
        const name = String(resource.name || resource.url || '').toLowerCase();
        const dataUrl = String(resource.dataUrl || '').toLowerCase();
        if (type === 'sharepoint_video' || type === 'sharepoint_link') return type;
        if (!resource.dataUrl && /sharepoint\.com|1drv\.ms|office\.com|microsoftstream\.com|stream\.office\.com/i.test(String(resource.url || ''))) {
            return type === 'video' ? 'sharepoint_video' : 'sharepoint_link';
        }
        if (type === 'image' || mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(name)) return 'image';
        if (type === 'video' || mime.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v|avi|mkv)$/i.test(name)) return 'video';
        if (type === 'audio' || mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return 'audio';
        if (type === 'pdf' || mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
        if (type === 'text' || mime.startsWith('text/') || /\.(txt|csv|log|md|json|xml|html|css|js)$/i.test(name)) return 'text';
        if (/\.(docx?|pptx?|xlsx?|odt|ods|odp|rtf)$/i.test(name) || /(word|excel|spreadsheet|powerpoint|presentation|officedocument)/i.test(mime)) return 'office';
        if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return 'archive';
        if (dataUrl.startsWith('data:image/')) return 'image';
        if (dataUrl.startsWith('data:video/')) return 'video';
        if (dataUrl.startsWith('data:audio/')) return 'audio';
        if (dataUrl.startsWith('data:application/pdf')) return 'pdf';
        if (dataUrl.startsWith('data:text/')) return 'text';
        return 'document';
    },

    iconForResource(type) {
        if (type === 'sharepoint_video' || type === 'sharepoint_link') return 'fa-cloud-arrow-up';
        if (type === 'video') return 'fa-circle-play';
        if (type === 'image') return 'fa-image';
        if (type === 'pdf') return 'fa-file-pdf';
        if (type === 'audio') return 'fa-file-audio';
        if (type === 'text') return 'fa-file-lines';
        if (type === 'office') return 'fa-file-word';
        if (type === 'archive') return 'fa-file-zipper';
        return 'fa-file';
    },

    openResource(resource = {}) {
        const target = resource.dataUrl || resource.url || '';
        if (!target) {
            if (typeof showToast === 'function') showToast('Answer resource has no link or upload attached.', 'warning');
            return;
        }

        const type = this.inferResourceType(resource);
        if ((type === 'sharepoint_video' || type === 'sharepoint_link') && this.openInStudyBrowser(target, resource.label || resource.name || 'Q&A SharePoint Resource')) {
            return;
        }
        this.showResourceModal(resource, type);
    },

    openInStudyBrowser(url, title = 'Q&A Resource') {
        const target = String(url || '').trim();
        if (!target) return false;
        if (window.StudyMonitor && typeof window.StudyMonitor.openStudyWindow === 'function') {
            window.StudyMonitor.openStudyWindow(target, title);
            return true;
        }
        return false;
    },

    closeResourceModal() {
        const modal = document.getElementById('qa-resource-modal');
        if (modal) modal.remove();
    },

    showResourceModal(resource, type) {
        this.closeResourceModal();
        const target = resource.dataUrl || resource.url || '';
        const label = resource.label || resource.name || 'Answer resource';
        const escapedLabel = this.esc(label);
        const escapedTarget = this.esc(target);
        const escapedName = this.esc(resource.name || label);
        const isUpload = !!resource.dataUrl;
        const openAttr = isUpload ? `download="${escapedName}"` : 'target="_blank" rel="noopener"';
        const actionLabel = type === 'sharepoint_video'
            ? 'Open SharePoint Video In App'
            : (type === 'sharepoint_link' ? 'Open SharePoint Link In App' : (isUpload ? 'Download' : 'Open'));
        const externalActionLabel = isUpload ? 'Download' : 'Open Outside App';
        const inAppAction = (type === 'sharepoint_video' || type === 'sharepoint_link')
            ? `
                <button type="button" class="btn-primary btn-sm" onclick="QAHub.openInStudyBrowser('${this.jsString(target)}', '${this.jsString(label)}')">
                    <i class="fas fa-window-restore"></i> ${actionLabel}
                </button>
            `
            : '';
        const actionBar = `
            <div class="qa-resource-actions">
                ${inAppAction}
                <a class="${type === 'sharepoint_video' || type === 'sharepoint_link' ? 'btn-secondary' : 'btn-primary'} btn-sm" href="${escapedTarget}" ${openAttr}>
                    <i class="fas ${isUpload ? 'fa-download' : 'fa-up-right-from-square'}"></i> ${type === 'sharepoint_video' || type === 'sharepoint_link' ? externalActionLabel : actionLabel}
                </a>
            </div>
        `;

        let body = '';
        if (type === 'image') {
            body = `
                <img class="qa-resource-preview-img" src="${escapedTarget}" alt="${escapedLabel}" onerror="this.closest('.qa-resource-body').classList.add('preview-failed')">
                <div class="qa-resource-preview-fallback">
                    <i class="fas fa-image"></i>
                    <strong>Image preview could not be loaded.</strong>
                    <span>Use the ${actionLabel.toLowerCase()} button below to view the file directly.</span>
                </div>
                ${actionBar}
            `;
        } else if (type === 'video') {
            body = `
                <video class="qa-resource-preview-video" src="${escapedTarget}" controls playsinline onerror="this.closest('.qa-resource-body').classList.add('preview-failed')"></video>
                <div class="qa-resource-preview-fallback">
                    <i class="fas fa-circle-play"></i>
                    <strong>Video preview is not supported for this file.</strong>
                    <span>Use the ${actionLabel.toLowerCase()} button below to view or download it.</span>
                </div>
                ${actionBar}
            `;
        } else if (type === 'audio') {
            body = `
                <div class="qa-resource-preview-audio">
                    <i class="fas fa-file-audio"></i>
                    <audio src="${escapedTarget}" controls onerror="this.closest('.qa-resource-body').classList.add('preview-failed')"></audio>
                </div>
                <div class="qa-resource-preview-fallback">
                    <i class="fas fa-file-audio"></i>
                    <strong>Audio preview is not supported for this file.</strong>
                    <span>Use the ${actionLabel.toLowerCase()} button below to view or download it.</span>
                </div>
                ${actionBar}
            `;
        } else if (type === 'sharepoint_video' || type === 'sharepoint_link') {
            body = `
                <webview
                    class="qa-resource-sharepoint-viewer"
                    src="${escapedTarget}"
                    partition="persist:study_session"
                    allowpopups
                    useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0"
                ></webview>
                <p class="qa-resource-note">SharePoint stays inside the app. If Microsoft asks you to sign in, complete it in this viewer.</p>
                ${actionBar}
            `;
        } else if (type === 'pdf') {
            body = `
                <iframe class="qa-resource-preview-frame" src="${escapedTarget}" title="${escapedLabel}"></iframe>
                ${actionBar}
            `;
        } else if (type === 'text') {
            body = `
                <iframe class="qa-resource-preview-frame" src="${escapedTarget}" title="${escapedLabel}"></iframe>
                ${actionBar}
            `;
        } else {
            body = `
                <div class="qa-resource-preview-file">
                    <i class="fas ${this.esc(this.iconForResource(type))}"></i>
                    <strong>${escapedLabel}</strong>
                    <span>${this.esc(resource.mime || resource.name || 'Uploaded document')}</span>
                    ${actionBar}
                </div>
            `;
        }

        const modal = document.createElement('div');
        modal.id = 'qa-resource-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-box qa-resource-modal-box">
                <div class="qa-resource-modal-head">
                    <h3>${escapedLabel}</h3>
                    <button type="button" class="icon-btn" onclick="QAHub.closeResourceModal()" title="Close"><i class="fas fa-xmark"></i></button>
                </div>
                <div class="qa-resource-body">${body}</div>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal) this.closeResourceModal();
        });
        document.body.appendChild(modal);
    }
};

window.QAHub = QAHub;
