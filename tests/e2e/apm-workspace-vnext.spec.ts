import { expect, Page, test } from '@playwright/test';
import { buildInitScript, navigateToDashboard, navigateToWorkspace, setupConsoleTracking } from './helpers';

function localDate(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function apmProject(id = 'test-project-1', calm = false) {
  const today = localDate();
  const yesterday = localDate(-1);
  const workers = {
    'worker-1': { name: 'Ana Santos', trade: 'Carpentry', dailyRate: 900, active: true },
    'worker-2': { name: 'Ben Cruz', trade: 'Masonry', dailyRate: 850, active: true },
    'worker-3': { name: 'Carlo Reyes', trade: 'Electrical', dailyRate: 950, active: true },
  };
  const attendance = calm ? {
    'worker-1': { [yesterday]: { workerId: 'worker-1', date: yesterday, status: 'present' } },
    'worker-2': { [yesterday]: { workerId: 'worker-2', date: yesterday, status: 'leave' } },
    'worker-3': { [yesterday]: { workerId: 'worker-3', date: yesterday, status: 'rest' } },
  } : {
    'worker-1': {
      [yesterday]: { workerId: 'worker-1', date: yesterday, status: 'present' },
      [today]: { workerId: 'worker-1', date: today, status: 'present' },
    },
  };
  const tasks = calm ? {} : {
    overdue: { title: 'Close slab inspection comments', status: 'in_progress', dueDate: localDate(-2), priority: 'high', progress: 60 },
    blocked: { title: 'Release ceiling layout', status: 'blocked', dueDate: localDate(2), blockedReason: 'Awaiting drawing', priority: 'normal', progress: 20 },
    upcoming: { title: 'Coordinate door delivery', status: 'pending', dueDate: localDate(3), priority: 'normal', progress: 0 },
    completed: { title: 'Submit concrete report', status: 'completed', dueDate: localDate(-3), priority: 'low', progress: 100 },
  };
  const purchaseOrders = calm ? {} : {
    'po-1': {
      date: today,
      supplier: 'Site Supplier',
      status: 'partially_delivered',
      deliveryStatus: 'partially_delivered',
      items: [{ desc: 'Gypsum Board', size: '12mm', qtyOrdered: 100, qtyAccepted: 80, qtyRemaining: 20, unit: 'sheets', unitCost: 300, cost: 30000, total: 30000 }],
    },
  };
  const defects = calm ? {} : {
    'issue-1': { issue: 'Wall alignment requires verification', area: 'Level 2', status: 'New', priority: 'high', createdAt: Date.now() - 2 * 86_400_000 },
  };

  return {
    id,
    name: id === 'test-project-1' ? 'Riverside Residences' : 'Northgate Fit-out',
    location: id === 'test-project-1' ? 'Pasig City' : 'Quezon City',
    status: 'active',
    createdAt: id === 'test-project-1' ? 1780000000000 : 1770000000000,
    workers,
    attendance,
    tasks,
    purchaseOrders,
    defects,
  };
}

function fixtureData(options: { calm?: boolean; twoProjects?: boolean } = {}): Record<string, unknown> {
  const first = apmProject('test-project-1', !!options.calm);
  const second = apmProject('test-project-2', true);
  const projects = options.twoProjects ? { 'test-project-1': first, 'test-project-2': second } : { 'test-project-1': first };
  const data: Record<string, unknown> = {
    projects,
    'projects/test-project-1': first,
    'projects/test-project-1/workers': first.workers,
    'projects/test-project-1/attendance': first.attendance,
    'projects/test-project-1/advances': {},
    'projects/test-project-1/trades': {},
    'projects/test-project-1/settings': {},
    'projects/test-project-1/payrollConfig': {},
    'projects/test-project-1/payrollLogs': {},
    'projects/test-project-1/attendanceHistory': {},
    'projects/test-project-1/tasks': first.tasks,
    'projects/test-project-1/taskEvents': {},
    'projects/test-project-1/activity': {},
    'projects/test-project-1/purchaseOrders': first.purchaseOrders,
    'projects/test-project-1/inventory': {},
    'projects/test-project-1/ledger': {},
    'projects/test-project-1/materialMovements': {},
    'projects/test-project-1/deliveries': {},
    'projects/test-project-1/defects': first.defects,
    'projects/test-project-1/siteLogs': {},
    suppliers: {},
  };
  if (options.twoProjects) {
    data['users/test-field-user-uid'] = {
      uid: 'test-field-user-uid', name: 'Test Field User', displayName: 'Test Field User', email: 'field@test.com',
      role: 'apm', status: 'active', projects: { 'test-project-1': true, 'test-project-2': true },
      assignedProjects: { 'test-project-1': true, 'test-project-2': true }, profileComplete: true,
    };
    data['projects/test-project-2'] = second;
  }
  return data;
}

async function setupApm(page: Page, data = fixtureData()) {
  await page.addInitScript(buildInitScript('field', { databaseData: data }));
}

test.describe('APM Workspace vNext', () => {
  test('APM Home is exception-first and derives attention from assigned project records', async ({ page }) => {
    await setupApm(page);
    const errors = setupConsoleTracking(page);
    await navigateToDashboard(page);

    await expect(page.locator('#apmHome')).toBeVisible();
    await expect(page.locator('#apmHomeTitle')).toContainText(/Good (morning|afternoon|evening), Test/);
    await expect(page.locator('#apmTodaySection')).toContainText('4 things need attention');
    await expect(page.locator('[data-apm-attention]')).toHaveCount(4);
    await expect(page.locator('#apmAttentionList')).toContainText('2 attendance entries are still unmarked');
    await expect(page.locator('#apmAttentionList')).toContainText('1 overdue and 1 blocked tasks need follow-up');
    await expect(page.locator('#apmAttentionList')).toContainText('1 material delivery is pending');
    await expect(page.locator('#apmAttentionList')).toContainText('1 site issue needs follow-up');
    await expect(page.locator('#apmProjectList')).toContainText('Riverside Residences');
    await expect(page.locator('#hubView > .hub-command')).toBeHidden();
    await expect(page.locator('#openAiCommandCenterBtn')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__mockDbPaths.some((path: string) => path.startsWith('ai/')))).toBe(false);
    if (process.env.ACPM_CAPTURE_SCREENSHOTS === '1') {
      await page.screenshot({ path: 'test-results/apm-home-desktop.png', fullPage: true });
    }
    expect(errors).toEqual([]);
  });

  test('zero-attention Home stays calm and avoids success-card noise', async ({ page }) => {
    await setupApm(page, fixtureData({ calm: true }));
    await navigateToDashboard(page);

    await expect(page.locator('#apmCalmState')).toBeVisible();
    await expect(page.locator('#apmCalmState')).toContainText('Everything is on track');
    await expect(page.locator('[data-apm-attention]')).toHaveCount(0);
    await expect(page.locator('#apmTodaySection')).toContainText('Your assigned projects are calm today.');
  });

  test('quick actions switch projects, preserve routes, and Back returns Home', async ({ page }) => {
    await setupApm(page, fixtureData({ twoProjects: true }));
    await navigateToDashboard(page);
    await expect(page.locator('#apmQuickProject option')).toHaveCount(2);
    await page.locator('#apmQuickProject').selectOption('test-project-2');

    await page.evaluate(() => {
      (window as any).__apmQuickAction = null;
      (window as any).openApmQuickAction = (tab: string) => {
        (window as any).__apmQuickAction = {
          tab,
          projectId: (document.querySelector('#apmQuickProject') as HTMLSelectElement)?.value || '',
        };
      };
    });
    await page.evaluate(() => {
      const select = document.querySelector('#apmQuickProject') as HTMLSelectElement;
      select.value = 'test-project-2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      (document.querySelector('.apm-quick-grid button:last-child') as HTMLButtonElement).click();
    });
    expect(await page.evaluate(() => (window as any).__apmQuickAction)).toEqual({ tab: 'tasks', projectId: 'test-project-2' });
    expect(await page.evaluate(() => (window as any).appUrl('workspace', { projectId: 'test-project-2', tab: 'tasks' })))
      .toBe('/workspace.html?projectId=test-project-2&tab=tasks');

    await navigateToWorkspace(page, 'test-project-2');
    await page.locator('#tab_tasks').click();
    await expect(page.locator('#tasksPanel')).toBeVisible();
    await expect(page.locator('#wsName')).toHaveText('Northgate Fit-out');

    await page.getByRole('button', { name: /Back to Hub/ }).click();
    await page.waitForURL(/\/dashboard(?:\.html)?/);
    await expect(page.locator('#apmHome')).toBeVisible();
  });

  test('project Home and simplified navigation keep advanced permitted tools reachable', async ({ page }) => {
    await setupApm(page);
    await navigateToWorkspace(page);

    await expect(page.locator('#dashboardPanel')).toBeVisible();
    await expect(page.locator('.apm-project-home')).toContainText('Daily operations');
    await expect(page.locator('.apm-project-home')).toContainText('Current work');
    await expect(page.locator('.apm-project-home')).toContainText('Wall alignment requires verification');
    await expect(page.locator('#tab_dashboard')).toHaveText('Home');
    await expect(page.locator('#tab_labor')).toHaveText('Attendance');
    await expect(page.locator('#tab_tasks')).toHaveText('Tasks');
    await expect(page.locator('#tab_materials')).toHaveText('Materials');
    await expect(page.locator('#tab_sitelog')).toHaveText('Site');
    await expect(page.locator('#extrasToggleBtn')).toHaveText('More');
    await expect(page.locator('#tab_defects')).toBeHidden();
    await page.locator('#extrasToggleBtn').click();
    await expect(page.locator('#tab_defects')).toBeVisible();
    await page.locator('#tab_defects').click();
    await expect(page.locator('#defectsPanel')).toBeVisible();
    await page.locator('#extrasToggleBtn').click();
    await expect(page.locator('#dashboardPanel')).toBeVisible();
    if (process.env.ACPM_CAPTURE_SCREENSHOTS === '1') {
      await page.screenshot({ path: 'test-results/apm-project-home-desktop.png', fullPage: true });
    }
  });

  test('daily attendance is explicit, mobile-safe, and bulk-present only fills unresolved workers', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await setupApm(page);
    await navigateToWorkspace(page);
    await page.locator('#tab_labor').click();

    await expect(page.locator('#apmAttendanceDaily')).toBeVisible();
    await expect(page.locator('#apmAttendanceRecorded')).toHaveText('1 / 3');
    await expect(page.locator('#apmAttendanceUnmarked')).toHaveText('2 unmarked');
    await expect(page.locator('#payrollCycle')).toBeHidden();
    const payrollWeekKey = await page.evaluate(() => {
      const start = (document.querySelector('#weekStart') as HTMLInputElement).value;
      const end = (document.querySelector('#weekEnd') as HTMLInputElement).value;
      return `${start}_${end}`;
    });
    expect(payrollWeekKey.split('_')[0]).not.toBe(payrollWeekKey.split('_')[1]);
    const statuses = await page.locator('.attendance-sel').evaluateAll(selects => selects.map(select => (select as HTMLSelectElement).value));
    expect(statuses.sort()).toEqual(['present', 'unmarked', 'unmarked']);
    await expect(page.locator('.attendance-sel').first().locator('option')).toHaveText(['Unmarked', 'Present', 'Half Day', 'Absent', 'Leave', 'Rest Day', 'Holiday']);

    await page.locator('#apmMarkAllPresent').click();
    const bulkUpdate = await page.evaluate(() => (window as any).__mockDbWrites.find((write: any) =>
      write.method === 'update' && write.path === '' && Object.keys(write.value || {}).some(path => path.includes('/attendance/'))
    ));
    const attendancePaths = Object.keys(bulkUpdate.value).filter(path => path.includes('/attendance/'));
    expect(attendancePaths).toHaveLength(2);
    expect(attendancePaths.some(path => path.includes('/worker-1/'))).toBe(false);
    expect(attendancePaths.some(path => path.includes('/worker-2/'))).toBe(true);
    expect(attendancePaths.some(path => path.includes('/worker-3/'))).toBe(true);
    attendancePaths.forEach(path => expect(bulkUpdate.value[path].weekKey).toBe(payrollWeekKey));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (process.env.ACPM_CAPTURE_SCREENSHOTS === '1') {
      await page.locator('.toast-msg').evaluateAll(toasts => toasts.forEach(toast => toast.remove()));
      await page.screenshot({ path: 'test-results/apm-attendance-mobile.png', fullPage: true });
    }
    await page.locator('#apmAttendanceMore').click();
    await expect(page.locator('#payrollCycle')).toBeVisible();
  });

  test('tasks default to daily work while completed history stays behind a filter', async ({ page }) => {
    await setupApm(page);
    await navigateToWorkspace(page);
    await page.locator('#tab_tasks').click();

    await expect(page.locator('[data-apm-task-filter="today"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.task-card')).toContainText('Close slab inspection comments');
    await expect(page.locator('#taskList')).not.toContainText('Coordinate door delivery');
    await expect(page.locator('#taskList')).not.toContainText('Submit concrete report');
    await page.locator('[data-apm-task-filter="upcoming"]').click();
    await expect(page.locator('#taskList')).toContainText('Coordinate door delivery');
    await page.locator('[data-apm-task-filter="blocked"]').click();
    await expect(page.locator('#taskList')).toContainText('Release ceiling layout');
    await page.locator('[data-apm-task-filter="history"]').click();
    await expect(page.locator('#taskList')).toContainText('Submit concrete report');
  });

  test('materials use honest delivery quantities and contain long tables on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await setupApm(page);
    await navigateToWorkspace(page);
    await page.locator('#tab_materials').click();

    const flow = page.locator('#apmMaterialsFlow');
    await expect(flow).toContainText('Gypsum Board');
    await expect(flow).toContainText('100 sheets');
    await expect(flow).toContainText('80 sheets');
    await expect(flow).toContainText('20 sheets');
    await expect(flow).toContainText('Stock not verified');
    await expect(flow).not.toContainText(/Out of Stock/i);
    const tableMetrics = await flow.locator('.apm-table-wrap').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    expect(tableMetrics.scroll).toBeGreaterThan(tableMetrics.client);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await expect(page.locator('#mbBudget')).toBeHidden();
    await page.locator('#apmMaterialsMore').click();
    await expect(page.locator('#mbBudget')).toBeVisible();
  });
});
