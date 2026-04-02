const CalendarUI = {
    render(items, monthDate) {
        const month = new Date(monthDate);
        const year = month.getFullYear();
        const monthIndex = month.getMonth();
        const firstDay = new Date(year, monthIndex, 1);
        const lastDay = new Date(year, monthIndex + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startDay = firstDay.getDay();
        const monthName = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const todayStr = this.toDateString(new Date());

        let html = `
            <div class="studio-toolbar" style="margin-bottom:14px;">
                <div class="studio-toolbar-left">
                    <button class="studio-btn secondary" onclick="App.changeMonth(-1)"><i class="fas fa-chevron-left"></i> Prev</button>
                    <button class="studio-btn secondary" onclick="App.changeMonth(1)">Next <i class="fas fa-chevron-right"></i></button>
                </div>
                <div><strong>${monthName}</strong></div>
            </div>
            <div class="studio-calendar">
                ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<div class="studio-calendar-head">${day}</div>`).join('')}
        `;

        for (let i = 0; i < startDay; i++) {
            html += `<div class="studio-day"></div>`;
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateObj = new Date(year, monthIndex, day);
            const dateStr = this.toDateString(dateObj);
            const events = items.filter(item => this.itemIncludesDate(item, dateStr));
            html += `
                <div class="studio-day ${dateStr === todayStr ? 'today' : ''}">
                    <div class="studio-day-number">${day}</div>
                    ${events.map(item => `<div class="studio-day-event" style="background:${this.getColor(item)}">${this.escape(item.courseName || 'Untitled')}</div>`).join('')}
                </div>
            `;
        }

        html += '</div>';
        return html;
    },

    itemIncludesDate(item, dateStr) {
        const range = ScheduleData.parseRange(item);
        if (!range.start) return false;
        if (dateStr < range.start) return false;
        if (range.end && dateStr > range.end) return false;
        return true;
    },

    getColor(item) {
        if (item.isVetting) return '#e74c3c';
        if (item.isLive) return '#2ecc71';
        if (item.linkedTestId) return '#f39c12';
        return 'var(--primary)';
    },

    toDateString(dateObj) {
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
    },

    escape(value) {
        return TimelineUI.escape(value);
    }
};
