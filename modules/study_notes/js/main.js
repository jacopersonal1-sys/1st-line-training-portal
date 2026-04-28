/* ================= STUDY NOTES MODULE ================= */
(function () {
    const STORAGE_KEY = 'study_notes_v2';
    const SAVE_DEBOUNCE_MS = 500;
    let saveTimer = null;
    let hostSyncBound = false;

    function getHost() {
        return AppContext.host || window;
    }

    function getCurrentUser() {
        const host = getHost();
        return host.CURRENT_USER || AppContext.user || null;
    }

    function showToast(message, type) {
        const host = getHost();
        if (host && typeof host.showToast === 'function') {
            host.showToast(message, type || 'info');
            return;
        }
        console.log(`[Study Notes] ${message}`);
    }

    async function askText(title, message, defaultValue) {
        const host = getHost();
        if (host && typeof host.customPrompt === 'function') {
            try {
                return await host.customPrompt(String(title || 'Input'), String(message || ''), String(defaultValue || ''));
            } catch (error) {}
        }
        return prompt(String(message || ''), String(defaultValue || ''));
    }

    async function askConfirm(title, message) {
        const host = getHost();
        if (host && typeof host.customPrompt === 'function') {
            const response = await host.customPrompt(
                String(title || 'Confirm'),
                `${String(message || '').trim()}\n\nType YES to confirm.`,
                ''
            );
            return String(response || '').trim().toLowerCase() === 'yes';
        }
        return confirm(String(message || 'Confirm this action?'));
    }

    function esc(v) {
        return String(v || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function makeId(prefix) {
        return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function storageGet(key, fallbackValue) {
        try {
            const host = getHost();
            const raw = (host.localStorage || localStorage).getItem(key);
            if (!raw) return fallbackValue;
            const parsed = JSON.parse(raw);
            return parsed == null ? fallbackValue : parsed;
        } catch (error) {
            return fallbackValue;
        }
    }

    function storageSet(key, value) {
        const host = getHost();
        (host.localStorage || localStorage).setItem(key, JSON.stringify(value));
    }

    function loadAllNotes() {
        const parsed = storageGet(STORAGE_KEY, {});
        return parsed && typeof parsed === 'object' ? parsed : {};
    }

    function saveAllNotes(all, immediate) {
        storageSet(STORAGE_KEY, all || {});
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        if (!immediate) {
            saveTimer = setTimeout(() => { saveTimer = null; }, SAVE_DEBOUNCE_MS);
        }
    }

    function getBookmarksForUser(user) {
        const all = storageGet('trainee_bookmarks', {}) || {};
        return Array.isArray(all[user]) ? all[user] : [];
    }

    function createDefaultWorkspace() {
        const sectionId = makeId('section');
        const pageId = makeId('page');
        return {
            sections: [
                {
                    id: sectionId,
                    title: 'General',
                    createdAt: nowIso(),
                    pages: [
                        {
                            id: pageId,
                            title: 'Quick Notes',
                            content: '',
                            createdAt: nowIso(),
                            updatedAt: nowIso()
                        }
                    ]
                }
            ],
            activeSectionId: sectionId,
            activePageId: pageId,
            updatedAt: nowIso()
        };
    }

    function ensureWorkspaceShape(workspace) {
        if (!workspace || typeof workspace !== 'object') workspace = createDefaultWorkspace();
        if (!Array.isArray(workspace.sections)) workspace.sections = [];

        if (workspace.sections.length === 0) {
            return createDefaultWorkspace();
        }

        workspace.sections.forEach(section => {
            if (!section.id) section.id = makeId('section');
            if (!section.title) section.title = 'Untitled Section';
            if (!Array.isArray(section.pages)) section.pages = [];
            if (section.pages.length === 0) {
                section.pages.push({
                    id: makeId('page'),
                    title: 'New Page',
                    content: '',
                    createdAt: nowIso(),
                    updatedAt: nowIso()
                });
            }
            section.pages.forEach(page => {
                if (!page.id) page.id = makeId('page');
                if (!page.title) page.title = 'Untitled Page';
                if (typeof page.content !== 'string') page.content = '';
                if (!page.createdAt) page.createdAt = nowIso();
                if (!page.updatedAt) page.updatedAt = nowIso();
            });
        });

        let activeSection = workspace.sections.find(s => s.id === workspace.activeSectionId);
        if (!activeSection) {
            activeSection = workspace.sections[0];
            workspace.activeSectionId = activeSection.id;
        }

        let activePage = activeSection.pages.find(p => p.id === workspace.activePageId);
        if (!activePage) {
            activePage = activeSection.pages[0];
            workspace.activePageId = activePage.id;
        }

        if (!workspace.updatedAt) workspace.updatedAt = nowIso();
        return workspace;
    }

    function getCurrentContext(createIfMissing) {
        const currentUser = getCurrentUser();
        if (!currentUser || !currentUser.user) return null;

        const user = currentUser.user;
        const all = loadAllNotes();

        if (!all[user] && createIfMissing) {
            all[user] = createDefaultWorkspace();
            saveAllNotes(all, true);
        }

        if (!all[user]) return null;
        all[user] = ensureWorkspaceShape(all[user]);
        return { all, user, workspace: all[user] };
    }

    function withWorkspace(mutator, immediate) {
        const ctx = getCurrentContext(true);
        if (!ctx) return;
        mutator(ctx.workspace, ctx.user);
        ctx.workspace.updatedAt = nowIso();
        ctx.all[ctx.user] = ensureWorkspaceShape(ctx.workspace);
        saveAllNotes(ctx.all, !!immediate);
    }

    function getActiveSection(workspace) {
        return workspace.sections.find(s => s.id === workspace.activeSectionId) || workspace.sections[0];
    }

    function getActivePage(workspace) {
        const section = getActiveSection(workspace);
        if (!section) return null;
        return section.pages.find(p => p.id === workspace.activePageId) || section.pages[0] || null;
    }

    function getSectionById(workspace, id) {
        return workspace.sections.find(s => s.id === id) || null;
    }

    function getPageById(section, id) {
        if (!section) return null;
        return section.pages.find(p => p.id === id) || null;
    }

    function renderWorkspace() {
        const hostEl = document.getElementById('app-container');
        if (!hostEl) return;

        const currentUser = getCurrentUser();
        AppContext.user = currentUser || null;

        if (!currentUser) {
            hostEl.innerHTML = '<div class="notes-card"><p class="notes-muted" style="margin:0;">Sign in to open Study Notes.</p></div>';
            return;
        }

        if (String(currentUser.role || '').toLowerCase() !== 'trainee') {
            hostEl.innerHTML = '<div class="notes-card"><p class="notes-muted" style="margin:0;">Study Notes workspace is available to trainee accounts.</p></div>';
            return;
        }

        const ctx = getCurrentContext(true);
        if (!ctx) {
            hostEl.innerHTML = '<div class="notes-card"><p class="notes-muted" style="margin:0;">Unable to load study notes.</p></div>';
            return;
        }

        const workspace = ensureWorkspaceShape(ctx.workspace);
        const section = getActiveSection(workspace);
        const page = getActivePage(workspace);
        const bookmarks = getBookmarksForUser(ctx.user);
        const selectedSectionName = section ? String(section.title || 'General') : 'General';
        const selectedPageName = page ? String(page.title || 'Quick Notes') : 'Quick Notes';

        const sectionList = workspace.sections.map(s => {
            const isActive = s.id === workspace.activeSectionId;
            const initial = (String(s.title || 'S').trim().charAt(0) || 'S').toUpperCase();
            return `
                <button class="notes-section-btn ${isActive ? 'active' : ''}" title="${esc(s.title)}" onclick="StudyNotesWorkspace.selectSection('${esc(s.id)}')">
                    <span class="notes-section-initial">${esc(initial)}</span>
                    <span class="notes-section-label">${esc(s.title)}</span>
                    ${isActive ? '<span class="notes-selected-pill">Selected</span>' : ''}
                </button>
            `;
        }).join('');

        const pageList = (section && Array.isArray(section.pages) ? section.pages : []).map(p => {
            const isActive = p.id === workspace.activePageId;
            return `
                <button class="notes-page-btn ${isActive ? 'active' : ''}" title="${esc(p.title)}" onclick="StudyNotesWorkspace.selectPage('${esc(p.id)}')">
                    ${esc(p.title)}
                </button>
            `;
        }).join('');

        const bookmarkList = bookmarks.length === 0
            ? '<div class="notes-muted">No clarity marks captured yet.</div>'
            : bookmarks.slice().reverse().map(b => {
                const title = esc(b.title || 'Untitled Mark');
                const note = esc(b.note || 'No note provided');
                return `
                    <div class="notes-bookmark-item">
                        <div class="notes-bookmark-title">${title}</div>
                        <div class="notes-bookmark-note">${note}</div>
                        <button class="btn-secondary btn-sm" style="width:auto;" onclick="StudyNotesWorkspace.insertBookmark(${Number(b.id) || 0})">
                            <i class="fas fa-plus"></i> Insert In Page
                        </button>
                    </div>
                `;
            }).join('');

        hostEl.innerHTML = `
            <div class="notes-shell">
                <div class="notes-card notes-shell-header">
                    <div class="notes-header-copy">
                        <div class="notes-selection-overview">
                            <span class="notes-selection-chip"><i class="fas fa-folder"></i> Section: <strong>${esc(selectedSectionName)}</strong></span>
                            <span class="notes-selection-chip"><i class="fas fa-file-alt"></i> Page: <strong>${esc(selectedPageName)}</strong></span>
                            <span class="notes-selection-chip"><i class="fas fa-lock"></i> Local only</span>
                        </div>
                    </div>
                    <div class="notes-shell-actions">
                        <button class="btn-secondary btn-sm" style="width:auto;" onclick="StudyNotesWorkspace.goPortalHome()"><i class="fas fa-house"></i> Home</button>
                    </div>
                </div>

                <div class="notes-flow">
                    <aside class="notes-card notes-sections-rail">
                        <div class="notes-rail-title">Sections</div>
                        <div class="notes-section-list">
                            ${sectionList}
                        </div>
                        <div class="notes-rail-actions">
                            <button class="notes-rail-btn" onclick="StudyNotesWorkspace.addSection()" title="New Section"><i class="fas fa-folder-plus"></i> New</button>
                            <button class="notes-rail-btn" onclick="StudyNotesWorkspace.renameSection()" title="Rename Section"><i class="fas fa-pen"></i> Rename</button>
                            <button class="notes-rail-btn" onclick="StudyNotesWorkspace.deleteSection()" title="Delete Section"><i class="fas fa-trash"></i> Delete</button>
                        </div>
                    </aside>

                    <section class="notes-card notes-main">
                        <div class="notes-pages-head">
                            <div class="notes-pages-title"><i class="fas fa-copy"></i> Pages</div>
                            <div class="notes-pages-actions">
                                <button class="btn-secondary btn-sm" style="width:auto;" onclick="StudyNotesWorkspace.addPage()"><i class="fas fa-file-circle-plus"></i> New Page</button>
                                <button class="btn-secondary btn-sm" style="width:auto;" onclick="StudyNotesWorkspace.renamePage()"><i class="fas fa-pen"></i> Rename</button>
                                <button class="btn-danger btn-sm" style="width:auto;" onclick="StudyNotesWorkspace.deletePage()"><i class="fas fa-trash"></i> Delete</button>
                            </div>
                        </div>

                        <div class="notes-pages-strip">
                            ${pageList}
                        </div>

                        <div class="notes-editor-panel">
                            <input id="studyNotesTitle" class="notes-title-input" type="text" value="${esc(page ? page.title : '')}" placeholder="Page title" oninput="StudyNotesWorkspace.updatePageTitle(this.value)">
                            <textarea id="studyNotesBody" class="notes-body-input" placeholder="Write your learning notes here..." oninput="StudyNotesWorkspace.updatePageContent(this.value)">${esc(page ? page.content : '')}</textarea>

                            <div class="notes-bookmarks-panel">
                                <div style="font-weight:600; margin-bottom:8px;">Clarity Marks From Study Browser</div>
                                <div class="notes-bookmark-list">${bookmarkList}</div>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        `;
    }

    function bindHostSync() {
        if (hostSyncBound) return;
        const host = getHost();
        if (!host || typeof host.addEventListener !== 'function') return;

        host.addEventListener('buildzone:data-changed', (event) => {
            const changedKey = event?.detail?.key;
            if (!changedKey) return;
            if (changedKey !== 'trainee_bookmarks') return;
            renderWorkspace();
        });
        hostSyncBound = true;
    }

    window.StudyNotesWorkspace = {
        renderUI: renderWorkspace,
        refresh: function () {},
        stopAutoRefresh: function () {},

        goPortalHome: function () {
            const host = getHost();
            if (host && typeof host.showTab === 'function') {
                host.showTab('trainee-portal');
                return;
            }
            showToast('Portal navigation is not available right now.', 'warning');
        },

        selectSection: function (sectionId) {
            withWorkspace((workspace) => {
                const section = getSectionById(workspace, sectionId);
                if (!section) return;
                workspace.activeSectionId = section.id;
                workspace.activePageId = section.pages[0].id;
            }, false);
            renderWorkspace();
        },

        selectPage: function (pageId) {
            withWorkspace((workspace) => {
                const section = getActiveSection(workspace);
                const page = getPageById(section, pageId);
                if (!page) return;
                workspace.activePageId = page.id;
            }, false);
            renderWorkspace();
        },

        addSection: async function () {
            const title = String(await askText('New Section', 'Enter section name:', 'New Section') || '').trim();
            if (!title) return;
            withWorkspace((workspace) => {
                const sectionId = makeId('section');
                const pageId = makeId('page');
                workspace.sections.push({
                    id: sectionId,
                    title,
                    createdAt: nowIso(),
                    pages: [{ id: pageId, title: 'New Page', content: '', createdAt: nowIso(), updatedAt: nowIso() }]
                });
                workspace.activeSectionId = sectionId;
                workspace.activePageId = pageId;
            }, true);
            renderWorkspace();
        },

        renameSection: async function () {
            const ctx = getCurrentContext(true);
            if (!ctx) return;
            const section = getActiveSection(ctx.workspace);
            if (!section) return;
            const title = String(await askText('Rename Section', 'Rename section:', section.title) || '').trim();
            if (!title) return;
            withWorkspace((workspace) => {
                const active = getActiveSection(workspace);
                if (!active) return;
                active.title = title;
            }, true);
            renderWorkspace();
        },

        deleteSection: async function () {
            const ctx = getCurrentContext(true);
            if (!ctx) return;
            if (ctx.workspace.sections.length <= 1) {
                showToast('At least one section is required.', 'warning');
                return;
            }
            const section = getActiveSection(ctx.workspace);
            if (!section) return;
            const proceed = await askConfirm('Delete Section', `Delete section "${section.title}" and all pages in it?`);
            if (!proceed) return;
            withWorkspace((workspace) => {
                const active = getActiveSection(workspace);
                if (!active) return;
                workspace.sections = workspace.sections.filter(s => s.id !== active.id);
                const fallback = workspace.sections[0];
                workspace.activeSectionId = fallback.id;
                workspace.activePageId = fallback.pages[0].id;
            }, true);
            renderWorkspace();
        },

        addPage: async function () {
            const title = String(await askText('New Page', 'Enter page title:', 'New Page') || '').trim();
            if (!title) return;
            withWorkspace((workspace) => {
                const section = getActiveSection(workspace);
                if (!section) return;
                const pageId = makeId('page');
                section.pages.push({ id: pageId, title, content: '', createdAt: nowIso(), updatedAt: nowIso() });
                workspace.activePageId = pageId;
            }, true);
            renderWorkspace();
        },

        renamePage: async function () {
            const ctx = getCurrentContext(true);
            if (!ctx) return;
            const page = getActivePage(ctx.workspace);
            if (!page) return;
            const title = String(await askText('Rename Page', 'Rename page:', page.title) || '').trim();
            if (!title) return;
            withWorkspace((workspace) => {
                const active = getActivePage(workspace);
                if (!active) return;
                active.title = title;
                active.updatedAt = nowIso();
            }, true);
            renderWorkspace();
        },

        deletePage: async function () {
            const ctx = getCurrentContext(true);
            if (!ctx) return;
            const section = getActiveSection(ctx.workspace);
            if (!section) return;
            if (section.pages.length <= 1) {
                showToast('At least one page is required in a section.', 'warning');
                return;
            }
            const page = getActivePage(ctx.workspace);
            if (!page) return;
            const proceed = await askConfirm('Delete Page', `Delete page "${page.title}"?`);
            if (!proceed) return;
            withWorkspace((workspace) => {
                const activeSection = getActiveSection(workspace);
                if (!activeSection) return;
                const activePage = getActivePage(workspace);
                if (!activePage) return;
                activeSection.pages = activeSection.pages.filter(p => p.id !== activePage.id);
                workspace.activePageId = activeSection.pages[0].id;
            }, true);
            renderWorkspace();
        },

        updatePageTitle: function (title) {
            withWorkspace((workspace) => {
                const page = getActivePage(workspace);
                if (!page) return;
                page.title = String(title || '').trim() || 'Untitled Page';
                page.updatedAt = nowIso();
            }, false);
        },

        updatePageContent: function (content) {
            withWorkspace((workspace) => {
                const page = getActivePage(workspace);
                if (!page) return;
                page.content = String(content || '');
                page.updatedAt = nowIso();
            }, false);
        },

        insertBookmark: function (bookmarkId) {
            const currentUser = getCurrentUser();
            const user = currentUser && currentUser.user ? currentUser.user : '';
            if (!user) return;
            const bookmarks = getBookmarksForUser(user);
            const target = bookmarks.find(b => Number(b.id) === Number(bookmarkId));
            if (!target) return;

            withWorkspace((workspace) => {
                const page = getActivePage(workspace);
                if (!page) return;
                const block = [
                    '',
                    '---',
                    `Clarity Mark: ${target.title || 'Untitled'}`,
                    `Note: ${target.note || 'No note'}`,
                    `Source: ${target.url || ''}`,
                    `Captured: ${target.timestamp || nowIso()}`,
                    '---',
                    ''
                ].join('\n');
                page.content = (page.content || '') + block;
                page.updatedAt = nowIso();
            }, true);

            renderWorkspace();
            showToast('Clarity mark inserted into the current page.', 'success');
        }
    };

    window.addEventListener('DOMContentLoaded', () => {
        bindHostSync();
        renderWorkspace();
    });
})();
