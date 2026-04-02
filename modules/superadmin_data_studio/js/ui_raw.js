const RawExplorerUI = {
    render(state) {
        const sources = StudioData.listExplorerSources();
        const selectedSource = state.explorerSource || 'users';
        const payload = StudioData.getExplorerPayload(selectedSource) || [];
        const filtered = payload.filter(item => StudioUI.matchesSearch(item, state.searchTerm));

        return `
            <div class="studio-split">
                <section class="studio-panel tight">
                    <div class="studio-section-head">
                        <div>
                            <h2 class="studio-section-title">Explorer Sources</h2>
                            <p class="studio-section-note">Switch between the readable entity sources and the raw document index.</p>
                        </div>
                    </div>
                    <div class="studio-source-list">
                        ${sources.map(source => `
                            <button class="studio-source-button ${selectedSource === source.id ? 'active' : ''}" onclick="App.setExplorerSource('${StudioUI.escapeHtml(source.id)}')">
                                <i class="fas ${StudioUI.escapeHtml(source.icon || 'fa-circle')}"></i>
                                ${StudioUI.escapeHtml(source.label)}
                            </button>
                        `).join('')}
                    </div>
                </section>

                <section class="studio-panel">
                    <div class="studio-section-head">
                        <div>
                            <h2 class="studio-section-title">Raw Explorer</h2>
                            <p class="studio-section-note">This is the power view. It still uses live data, but the layout is closer to the stored JSON.</p>
                        </div>
                        <div class="studio-inline-actions">
                            ${selectedSource === 'users' ? `<button class="studio-mini-btn" onclick="App.openNewBlobArrayItem('users')"><i class="fas fa-plus"></i> Add User</button>` : ''}
                            ${selectedSource === 'tests' ? `<button class="studio-mini-btn" onclick="App.openNewBlobArrayItem('tests')"><i class="fas fa-plus"></i> Add Assessment</button>` : ''}
                            ${selectedSource === 'rosters' ? `<button class="studio-mini-btn" onclick="App.openNewRoster()"><i class="fas fa-plus"></i> Add Group</button>` : ''}
                            ${selectedSource !== 'app_documents_all' && StudioData.sourceCatalog[selectedSource] && StudioData.sourceCatalog[selectedSource].type === 'row' ? `<button class="studio-mini-btn" onclick="App.openNewRow('${StudioUI.escapeHtml(selectedSource)}')"><i class="fas fa-plus"></i> New Row</button>` : ''}
                        </div>
                    </div>
                    ${filtered.length ? `
                        <div class="studio-grid cards">
                            ${filtered.map(item => this.renderItemCard(selectedSource, item)).join('')}
                        </div>
                    ` : '<div class="studio-empty">No rows or documents matched the current search.</div>'}
                </section>
            </div>
        `;
    },

    renderItemCard(sourceId, item) {
        if (sourceId === 'app_documents_all') {
            return `
                <article class="studio-card">
                    <h3 class="studio-card-title">${StudioUI.escapeHtml(item.key)}</h3>
                    <div class="studio-card-meta">${StudioUI.escapeHtml(StudioUI.formatDate(item.updated_at))}</div>
                    <div class="studio-code-preview">${StudioUI.escapeHtml(JSON.stringify(item.content, null, 2).slice(0, 1200))}</div>
                    <div class="studio-card-actions">
                        <button class="studio-mini-btn" onclick="App.openDocumentEditor('${StudioUI.escapeHtml(item.key)}')"><i class="fas fa-pen"></i> Edit</button>
                    </div>
                </article>
            `;
        }

        if (sourceId === 'rosters') {
            return `
                <article class="studio-card">
                    <h3 class="studio-card-title">${StudioUI.escapeHtml(item.groupName)}</h3>
                    <div class="studio-card-meta">${Array.isArray(item.members) ? item.members.length : 0} group members</div>
                    <div class="studio-code-preview">${StudioUI.escapeHtml(JSON.stringify(item.members, null, 2))}</div>
                    <div class="studio-card-actions">
                        <button class="studio-mini-btn" onclick="App.openRosterEditor('${StudioUI.escapeHtml(item.groupName)}')"><i class="fas fa-pen"></i> Edit</button>
                        <button class="studio-mini-btn danger" onclick="App.deleteRoster('${StudioUI.escapeHtml(item.groupName)}')"><i class="fas fa-trash"></i> Delete</button>
                    </div>
                </article>
            `;
        }

        const source = StudioData.sourceCatalog[sourceId];
        const keyValue = source && source.keyField ? item[source.keyField] : (item.id ?? '');
        const codePreview = JSON.stringify(item, null, 2).slice(0, 1400);

        return `
            <article class="studio-card">
                <h3 class="studio-card-title">${StudioUI.escapeHtml(String(keyValue || source?.label || 'Entry'))}</h3>
                <div class="studio-card-meta">${StudioUI.escapeHtml(source ? source.label : 'Unknown Source')}</div>
                <div class="studio-code-preview">${StudioUI.escapeHtml(codePreview)}</div>
                <div class="studio-card-actions">
                    ${source?.type === 'blob_array' ? `<button class="studio-mini-btn" onclick="App.openBlobArrayEditor('${StudioUI.escapeHtml(sourceId)}', '${StudioUI.escapeHtml(String(keyValue))}')"><i class="fas fa-pen"></i> Edit</button>` : ''}
                    ${source?.type === 'row' ? `<button class="studio-mini-btn" onclick="App.openRowEditor('${StudioUI.escapeHtml(sourceId)}', '${StudioUI.escapeHtml(String(keyValue))}')"><i class="fas fa-pen"></i> Edit</button>` : ''}
                    ${source?.type === 'blob_array' ? `<button class="studio-mini-btn danger" onclick="App.deleteBlobArrayItem('${StudioUI.escapeHtml(sourceId)}', '${StudioUI.escapeHtml(String(keyValue))}')"><i class="fas fa-trash"></i> Delete</button>` : ''}
                    ${source?.type === 'row' && keyValue !== '' ? `<button class="studio-mini-btn danger" onclick="App.deleteRow('${StudioUI.escapeHtml(sourceId)}', '${StudioUI.escapeHtml(String(keyValue))}')"><i class="fas fa-trash"></i> Delete</button>` : ''}
                </div>
            </article>
        `;
    }
};
