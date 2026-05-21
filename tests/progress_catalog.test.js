describe('ProgressCatalog', () => {
  let ProgressCatalog;

  beforeEach(() => {
    localStorage.clear();
    delete require.cache[require.resolve('../js/progress_catalog.js')];
    ProgressCatalog = require('../js/progress_catalog.js');
  });

  test('builds official candidates from Test Engine first when no manual config exists', () => {
    localStorage.setItem('schedules', JSON.stringify({
      group1: {
        items: [
          { courseName: 'Course 1 - Terms', linkedTestId: 't1' },
          { courseName: 'Live Assessment - Router Setup' }
        ]
      }
    }));
    localStorage.setItem('tests', JSON.stringify([
      { id: 't1', title: 'Course 1 - Terms', type: 'standard' },
      { id: 'live1', title: 'Live Assessment - Router Setup', type: 'live' }
    ]));
    localStorage.setItem('vettingTopics', JSON.stringify(['Wireless Standards']));

    const names = ProgressCatalog.getOfficialItems({ includeAuto: false }).map(item => `${item.type}:${item.name}`);

    expect(names).toContain('test:Course 1 - Terms');
    expect(names).toContain('live:Live Assessment - Router Setup');
    expect(names).not.toContain('vetting:1st Vetting - Wireless Standards');
    expect(names).not.toContain('vetting:Final Vetting - Wireless Standards');
  });

  test('calculates trainee progress from records, submissions, live bookings, reports, and reviews', () => {
    localStorage.setItem('insight_progress_config', JSON.stringify({
      requiredItems: [
        { name: 'Course 1 - Terms', type: 'assessment' },
        { name: '1st Vetting - Wireless Standards', type: 'vetting' },
        { name: 'Live Assessment - Router Setup', type: 'live' }
      ]
    }));

    const progress = ProgressCatalog.getTraineeProgress('Tshepo Raselabe', 'Group A', {
      includeAuto: true,
      data: {
        records: [
          { trainee: 'Tshepo Raselabe', assessment: 'Course 1 - Terms', score: 86 },
          { trainee: 'Tshepo Raselabe', assessment: '1st Vetting - Wireless Standards', score: 90 }
        ],
        submissions: [],
        liveBookings: [
          { trainee: 'Tshepo Raselabe', assessment: 'Live Assessment - Router Setup', status: 'Completed', score: 82 }
        ],
        savedReports: [{ trainee: 'Tshepo Raselabe' }],
        insightReviews: [{ trainee: 'Tshepo Raselabe' }],
        exemptions: []
      }
    });

    expect(progress.progress).toBe(100);
    expect(progress.completedCount).toBe(5);
    expect(progress.items.find(item => item.type === 'live').score).toBe(82);
  });

  test('can calculate archive progress from a builder snapshot and retrain N/A exemptions from another group', () => {
    const builderSnapshot = {
      requiredItems: [
        { name: 'Course 1 - Terms', type: 'assessment' },
        { name: 'Final Vetting - Wireless Standards', type: 'vetting' }
      ]
    };
    localStorage.setItem('insight_progress_config', JSON.stringify({
      requiredItems: [
        { name: 'Different Current Builder Item', type: 'assessment' }
      ]
    }));

    const items = ProgressCatalog.getOfficialItemsFromConfig(builderSnapshot, { includeAuto: true });
    const progress = ProgressCatalog.getTraineeProgress('Hloni Masenkane', 'Old Group', {
      includeAuto: true,
      items,
      ignoreExemptionGroup: true,
      data: {
        records: [
          { trainee: 'Hloni Masenkane', assessment: 'Course 1 - Terms', score: 81 }
        ],
        submissions: [],
        liveBookings: [],
        savedReports: [{ trainee: 'Hloni Masenkane' }],
        insightReviews: [{ trainee: 'Hloni Masenkane' }],
        exemptions: [
          { trainee: 'Hloni Masenkane', groupID: 'New Retrain Group', item: 'Final Vetting - Wireless Standards' }
        ]
      }
    });

    expect(progress.progress).toBe(100);
    expect(progress.items.map(item => item.name)).toContain('Final Vetting - Wireless Standards');
    expect(progress.items.find(item => item.name === 'Final Vetting - Wireless Standards').status).toBe('exempt');
    expect(progress.items.map(item => item.name)).not.toContain('Different Current Builder Item');
  });
});
