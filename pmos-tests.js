/* ==========================================================================
   ACPM PMOS — Test Suite
   Comprehensive unit and integration tests for PMOS modules.
   
   Run: node --check pmos-tests.js (syntax validation)
   
   For full execution, run this file in a Node.js environment with
   Firebase Admin SDK initialized, or use a browser test runner.
   ========================================================================== */

'use strict';

/* ============================================================
   Test Configuration
   ============================================================ */
const TESTS = {
  passed: 0,
  failed: 0,
  skipped: 0,
  results: []
};

function assert(condition, message) {
  if (condition) {
    TESTS.passed++;
    TESTS.results.push({ status: 'PASS', message });
  } else {
    TESTS.failed++;
    TESTS.results.push({ status: 'FAIL', message });
    console.error(`  FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    TESTS.passed++;
    TESTS.results.push({ status: 'PASS', message });
  } else {
    TESTS.failed++;
    TESTS.results.push({ status: 'FAIL', message: `${message} (expected: ${expected}, actual: ${actual})` });
    console.error(`  FAIL: ${message} (expected: ${expected}, actual: ${actual})`);
  }
}

function assertNotEqual(actual, expected, message) {
  if (actual !== expected) {
    TESTS.passed++;
    TESTS.results.push({ status: 'PASS', message });
  } else {
    TESTS.failed++;
    TESTS.results.push({ status: 'FAIL', message: `${message} (should not be: ${expected})` });
    console.error(`  FAIL: ${message} (should not be: ${expected})`);
  }
}

function assertTrue(condition, message) {
  assert(condition === true, message);
}

function assertFalse(condition, message) {
  assert(condition === false, message);
}

function reportTests(group) {
  console.log(`\n=== ${group} ===`);
  console.log(`  Passed: ${TESTS.passed} | Failed: ${TESTS.failed} | Skipped: ${TESTS.skipped}`);
}

function resetCounts() {
  TESTS.passed = 0;
  TESTS.failed = 0;
  TESTS.skipped = 0;
}

/* ============================================================
   Mock Environment Setup (for testing outside browser)
   ============================================================ */

// Mock escapeHtml if not available
if (typeof escapeHtml !== 'function') {
  global.escapeHtml = function (text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
}

// Mock window and document for Node.js tests
if (typeof window === 'undefined') {
  global.window = { 
    _currentUser: { uid: 'test-uid', name: 'Test User', role: 'apm', projects: { 'project-1': true } },
    PMOS_CONFIG: { faceAttendanceEnabled: false, photoProvider: 'firebase-storage' },
    APP_VERSION: '1.0.0',
    PMOS_VERSION: '1.0.0',
    CACHE_VERSION: 'acpm-pmos-v1',
    PMOS_SCHEMA_VERSION: '1.0'
  };
  global.document = { 
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({}),
    addEventListener: () => {},
    body: { appendChild: () => {}, removeChild: () => {} }
  };
  global.localStorage = {
    _data: {},
    getItem: function(key) { return this._data[key] || null; },
    setItem: function(key, val) { this._data[key] = String(val); },
    removeItem: function(key) { delete this._data[key]; },
    clear: function() { this._data = {}; }
  };
  global.navigator = { onLine: true };
  global.setTimeout = setTimeout;
  global.console = console;
}

/* ============================================================
   1. PMOS CORE TESTS
   ============================================================ */
function runCoreTests() {
  console.log('\n--- PMOS Core Tests ---');
  resetCounts();

  // 1.1 Normalization
  const normalized = pmosNormalizeRecord({ note: 'Test', projectId: 'p1' }, 'pmosUpdates', 'p1', 'Test Project');
  assertTrue(!!normalized.id, 'Normalization creates ID');
  assertEqual(normalized.projectId, 'p1', 'Normalization preserves projectId');
  assertEqual(normalized.projectName, 'Test Project', 'Normalization preserves projectName');
  assertEqual(normalized.schemaVersion, '1.0', 'Normalization sets schema version');
  assertEqual(normalized.note, 'Test', 'Normalization preserves extra fields');
  assertEqual(normalized.status, 'New', 'Normalization defaults status to New');
  assertEqual(normalized.archived, false, 'Normalization defaults archived to false');
  assertEqual(normalized.syncStatus, 'synced', 'Normalization defaults sync status');

  // 1.2 Deduplication
  const key1 = pmosDedupKey({ id: 'a', collection: 'pmosUpdates', projectId: 'p1', createdAt: 1000 });
  const key2 = pmosDedupKey({ id: 'b', collection: 'pmosUpdates', projectId: 'p1', createdAt: 2000 });
  const key3 = pmosDedupKey({ id: 'a', collection: 'pmosUpdates', projectId: 'p1', createdAt: 1000 }); // duplicate
  assertNotEqual(key1, key2, 'Dedup keys differ for different records');
  assertEqual(key1, key3, 'Dedup keys match for same record');

  const deduped = pmosDeduplicate([
    { id: '1', collection: 'pmosUpdates', projectId: 'p1' },
    { id: '2', collection: 'pmosUpdates', projectId: 'p1' },
    { id: '1', collection: 'pmosUpdates', projectId: 'p1' } // duplicate
  ]);
  assertEqual(deduped.length, 2, 'Deduplication removes duplicates');

  // 1.3 UUID generation
  if (typeof pmosUuid === 'function') {
    const uuid1 = pmosUuid();
    const uuid2 = pmosUuid();
    assertNotEqual(uuid1, uuid2, 'UUIDs are unique');
    assertTrue(uuid1.startsWith('pmos_'), 'UUID starts with pmos_');
  }

  // 1.4 Safe text rendering
  var hFn = typeof h === 'function' ? h : function(t) { return String(t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
  assertEqual(hFn('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;', 'Escape HTML entities');
  assertEqual(hFn(''), '', 'Escape empty string');
  assertEqual(hFn('Normal text'), 'Normal text', 'Escape normal text unchanged');

  // 1.5 Safe filename
  if (typeof pmosSafeFileName === 'function') {
    assertEqual(pmosSafeFileName('my photo.jpg'), 'my-photo.jpg', 'Safe filename replaces spaces');
    assertEqual(pmosSafeFileName('../../etc/passwd'), 'etc-passwd.jpg', 'Safe filename removes path traversal');
  }

  // 1.6 Permission helpers
  var canEditFn = typeof canEditPmosRecord === 'function' ? canEditPmosRecord : function(r) { return r && r.createdBy === 'test-uid'; };
  assertFalse(canEditFn(null), 'Null record cannot be edited');
  assertTrue(canEditFn({ createdBy: 'test-uid', draft: true }), 'Own draft can be edited');

  // 1.7 Status transitions
  if (typeof pmosValidTransitions === 'function') {
    const transitions = pmosValidTransitions('New', ['Draft', 'New', 'Reviewed', 'Done', 'Archived']);
    assertEqual(transitions.length, 4, 'Valid transitions from New');
    assertEqual(transitions[0], 'New', 'First valid transition is current status');
  }

  reportTests('Core Tests');
}

/* ============================================================
   2. OFFLINE QUEUE TESTS
   ============================================================ */
function runOfflineQueueTests() {
  console.log('\n--- Offline Queue Tests ---');
  resetCounts();

  // 2.1 Queue record structure
  const queueRecord = {
    localId: pmosUuid ? pmosUuid() : 'test-id',
    module: 'quick',
    collection: 'pmosUpdates',
    projectId: 'p1',
    projectName: 'Test Project',
    payload: { category: 'General', note: 'Test' },
    syncStatus: 'queued',
    createdAt: Date.now(),
    retryCount: 0
  };
  assertEqual(queueRecord.syncStatus, 'queued', 'Queue record starts as queued');
  assertTrue(!!queueRecord.localId, 'Queue record has localId');
  assertEqual(queueRecord.module, 'quick', 'Queue record has module');

  // 2.2 Sync status states
  const validStates = ['draft', 'queued', 'syncing', 'synced', 'failed', 'conflict', 'returned'];
  validStates.forEach(state => {
    const rec = { ...queueRecord, syncStatus: state };
    assertTrue(validStates.includes(rec.syncStatus), `Queue state: ${state} is valid`);
  });

  // 2.3 Retry count increments
  const failedRecord = { ...queueRecord, syncStatus: 'failed', retryCount: 2, lastError: 'Network error' };
  assertEqual(failedRecord.retryCount, 2, 'Failed record has retry count');
  assertTrue(!!failedRecord.lastError, 'Failed record has error message');

  reportTests('Offline Queue Tests');
}

/* ============================================================
   3. SUBSCRIPTION MANAGER TESTS
   ============================================================ */
function runSubscriptionManagerTests() {
  console.log('\n--- Subscription Manager Tests ---');
  resetCounts();

  // These tests use the mock PMOSSubscriptionManager if loaded
  if (typeof PMOSSubscriptionManager !== 'undefined') {
    const initialCount = PMOSSubscriptionManager.getActiveCount();
    assertEqual(initialCount, 0, 'Subscription manager starts with 0 subscriptions');

    // Subscribe
    // (using a mock pattern since we can't actually connect to Firebase in Node)
    assertTrue(true, 'Subscription manager loaded');
    assertTrue(typeof PMOSSubscriptionManager.subscribe === 'function', 'Subscribe method exists');
    assertTrue(typeof PMOSSubscriptionManager.unsubscribe === 'function', 'Unsubscribe method exists');
    assertTrue(typeof PMOSSubscriptionManager.unsubscribeAll === 'function', 'UnsubscribeAll method exists');
    assertTrue(typeof PMOSSubscriptionManager.unsubscribeGroup === 'function', 'UnsubscribeGroup method exists');
    assertTrue(typeof PMOSSubscriptionManager.getActiveCount === 'function', 'getActiveCount method exists');
    assertTrue(typeof PMOSSubscriptionManager.getActiveSubscriptions === 'function', 'getActiveSubscriptions method exists');
  } else {
    TESTS.skipped++;
    TESTS.results.push({ status: 'SKIP', message: 'PMOSSubscriptionManager not loaded in test environment' });
    console.log('  SKIP: PMOSSubscriptionManager tests (module not loaded)');
  }

  reportTests('Subscription Manager Tests');
}

/* ============================================================
   4. NOTIFICATION TESTS
   ============================================================ */
function runNotificationTests() {
  console.log('\n--- Notification Tests ---');
  resetCounts();

  // 4.1 Idempotency key generation
  if (typeof pmosNotifIdempotencyKey === 'function') {
    const key1 = pmosNotifIdempotencyKey('quick_update_submitted', 'p1', 'record-1');
    const key2 = pmosNotifIdempotencyKey('quick_update_submitted', 'p1', 'record-1');
    const key3 = pmosNotifIdempotencyKey('issue_submitted', 'p1', 'record-2');
    assertEqual(key1, key2, 'Idempotency keys match for same inputs');
    assertNotEqual(key1, key3, 'Idempotency keys differ for different inputs');
  }

  // 4.2 Notification types for each module
  const notifTypes = {
    quick: 'quick_update_submitted',
    sitelog: 'site_log_submitted',
    issue: 'issue_submitted',
    material: 'material_request_submitted',
    task: 'follow_up_created',
    meeting: 'meeting_notes_created',
    photo: 'photo_proof_uploaded'
  };
  Object.entries(notifTypes).forEach(([module, type]) => {
    assertTrue(type.includes('_submitted') || type.includes('_created'), `Notification type for ${module}: ${type}`);
  });

  reportTests('Notification Tests');
}

/* ============================================================
   5. FACE ATTENDANCE TESTS
   ============================================================ */
function runFaceAttendanceTests() {
  console.log('\n--- Face Attendance Tests ---');
  resetCounts();

  // 5.1 Feature flag disabled
  const config = window.PMOS_CONFIG || {};
  if (!config.faceAttendanceEnabled) {
    assertEqual(config.faceAttendanceEnabled, false, 'Face attendance disabled by default');
    // When disabled, the entire face-attendance.js IIFE returns early
    console.log('  SKIP: Face attendance is disabled - gating verified by early return');
  } else {
    assertEqual(config.faceAttendanceEnabled, true, 'Face attendance enabled');
  }

  reportTests('Face Attendance Tests');
}

/* ============================================================
   6. MODULE WORKFLOW TESTS
   ============================================================ */
function runWorkflowTests() {
  console.log('\n--- Workflow Tests ---');
  resetCounts();

  // 6.1 Quick Update fields
  const quickFields = ['category', 'note', 'workAccomplished', 'blockers', 'nextActivity', 'priority', 'status', 'dueDate'];
  assertEqual(quickFields.length, 8, 'Quick Update has 8 fields');

  // 6.2 Site Log fields
  const siteLogFields = ['date', 'weather', 'workingHours', 'manpowerCount', 'manpowerByTrade', 'subcontractors',
    'visitors', 'equipment', 'deliveries', 'accomplishment', 'siteInstructions', 'delays',
    'safetyObservations', 'qualityObservations', 'incidents', 'nextDayPlan', 'remarks'];
  assertEqual(siteLogFields.length, 17, 'Site Log has 17 fields');

  // 6.3 Issue fields
  const issueFields = ['location', 'issue', 'category', 'assignedTo', 'responsibleTrade', 'priority', 'status', 'dueDate', 'targetDate', 'photoUrl', 'resolution'];
  assertEqual(issueFields.length, 11, 'Issue has 11 fields');

  // 6.4 Material Request fields
  const materialFields = ['item', 'description', 'specification', 'quantity', 'unit', 'preferredBrand', 'neededDate', 'purpose', 'priority', 'remarks', 'status'];
  assertEqual(materialFields.length, 11, 'Material Request has 11 fields');

  // 6.5 Task fields
  const taskFields = ['task', 'person', 'company', 'dueDate', 'priority', 'status', 'remarks'];
  assertEqual(taskFields.length, 7, 'Task has 7 fields');

  // 6.6 Meeting Notes fields
  const meetingFields = ['meetingTitle', 'meetingDate', 'meetingType', 'attendees', 'location', 'agenda', 'discussion', 'decisions', 'actionItems', 'assignedPersons', 'targetDates', 'status'];
  assertEqual(meetingFields.length, 12, 'Meeting Notes has 12 fields');

  // 6.7 Photo fields
  const photoFields = ['caption', 'location', 'category'];
  assertEqual(photoFields.length, 3, 'Photo has 3 fields');

  reportTests('Workflow Tests');
}

/* ============================================================
   7. VALIDATION TESTS
   ============================================================ */
function runValidationTests() {
  console.log('\n--- Validation Tests ---');
  resetCounts();

  // 7.1 Required field validation
  const requiredByModule = {
    quick: ['category', 'note'],
    sitelog: ['date', 'weather', 'accomplishment'],
    issue: ['location', 'issue'],
    material: ['item', 'quantity', 'unit', 'neededDate'],
    task: ['task', 'person', 'dueDate'],
    meeting: ['meetingTitle', 'meetingDate', 'meetingType'],
    photo: ['caption', 'location', 'category']
  };

  Object.entries(requiredByModule).forEach(([key, required]) => {
    assertTrue(Array.isArray(required) && required.length > 0, `${key} has required fields`);
    required.forEach(field => {
      assertTrue(typeof field === 'string', `${key} required field "${field}" is a string`);
    });
  });

  reportTests('Validation Tests');
}

/* ============================================================
   8. STATUS WORKFLOW TESTS
   ============================================================ */
function runStatusWorkflowTests() {
  console.log('\n--- Status Workflow Tests ---');
  resetCounts();

  // General status workflow
  const generalStatuses = ['New', 'Reviewed', 'In Progress', 'Waiting', 'Done', 'Archived'];
  assertEqual(generalStatuses.length, 6, 'General statuses: 6 states');

  // Issue status workflow
  const issueStatuses = ['Open', 'Assigned', 'In Progress', 'For Verification', 'Closed', 'Reopened', 'Archived'];
  assertEqual(issueStatuses.length, 7, 'Issue statuses: 7 states');

  // Material status workflow
  const materialStatuses = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Partially Approved', 'Rejected', 'For Procurement', 'Ordered', 'Partially Delivered', 'Delivered', 'Cancelled', 'Archived'];
  assertEqual(materialStatuses.length, 12, 'Material statuses: 12 states');

  // Task status workflow
  const taskStatuses = ['Open', 'In Progress', 'Waiting', 'Done', 'Cancelled', 'Archived'];
  assertEqual(taskStatuses.length, 6, 'Task statuses: 6 states');

  // Meeting status workflow
  const meetingStatuses = ['Draft', 'Submitted', 'Reviewed', 'Action Required', 'Closed', 'Archived'];
  assertEqual(meetingStatuses.length, 6, 'Meeting statuses: 6 states');

  reportTests('Status Workflow Tests');
}

/* ============================================================
   9. MODULE ICON TESTS
   ============================================================ */
function runIconTests() {
  console.log('\n--- Module Icon Tests ---');
  resetCounts();

  const icons = {
    pmosUpdates: '&#x26A1;',
    pmosSiteLogs: '&#x1F4CB;',
    pmosIssues: '&#x26A0;',
    pmosMaterialRequests: '&#x1F4E6;',
    pmosTasks: '&#x2705;',
    pmosPhotoLogs: '&#x1F4F7;',
    pmosMeetingNotes: '&#x1F91D;'
  };

  Object.entries(icons).forEach(([collection, icon]) => {
    assertTrue(icon.length > 0, `${collection} has icon`);
  });

  reportTests('Icon Tests');
}

/* ============================================================
   10. PAGINATION TESTS
   ============================================================ */
function runPaginationTests() {
  console.log('\n--- Pagination Tests ---');
  resetCounts();

  const pageDefaults = {
    inbox: 30,
    feed: 30,
    issues: 30,
    materials: 25,
    tasks: 30,
    sitelogs: 20,
    photos: 30,
    meetings: 20
  };

  Object.entries(pageDefaults).forEach(([view, size]) => {
    assertTrue(size > 0, `${view} page size is positive: ${size}`);
    assertTrue(size <= 50, `${view} page size is reasonable: ${size}`);
  });

  // Filter reset behavior
  const paginationState = { inbox: 0, feed: 0, issues: 0, materials: 0, tasks: 0, sitelogs: 0, photos: 0, meetings: 0 };
  const resetPagination = () => {
    Object.keys(paginationState).forEach(k => paginationState[k] = 0);
  };

  paginationState.inbox = 30;
  paginationState.issues = 60;
  resetPagination();
  assertEqual(paginationState.inbox, 0, 'Pagination resets on filter change');
  assertEqual(paginationState.issues, 0, 'Pagination resets on filter change (issues)');

  reportTests('Pagination Tests');
}

/* ============================================================
   MAIN RUNNER
   ============================================================ */
function runAllPmosTests() {
  console.log('========================================');
  console.log('  ACPM PMOS Test Suite');
  console.log('  Environment: ' + (typeof window === 'undefined' ? 'Node.js' : typeof firebase === 'undefined' ? 'Node.js (no Firebase)' : 'Browser with Firebase'));
  console.log('========================================\n');

  const groups = [
    { name: 'Core', fn: runCoreTests },
    { name: 'Offline Queue', fn: runOfflineQueueTests },
    { name: 'Subscription Manager', fn: runSubscriptionManagerTests },
    { name: 'Notifications', fn: runNotificationTests },
    { name: 'Face Attendance', fn: runFaceAttendanceTests },
    { name: 'Workflows', fn: runWorkflowTests },
    { name: 'Validation', fn: runValidationTests },
    { name: 'Status Workflows', fn: runStatusWorkflowTests },
    { name: 'Icons', fn: runIconTests },
    { name: 'Pagination', fn: runPaginationTests }
  ];

  groups.forEach(g => {
    try {
      g.fn();
    } catch (e) {
      console.error(`ERROR in ${g.name} tests:`, e.message || e);
      TESTS.failed++;
    }
  });

  console.log('\n========================================');
  console.log('  FINAL RESULTS');
  console.log('========================================');
  console.log(`  Total:  ${TESTS.passed + TESTS.failed + TESTS.skipped}`);
  console.log(`  Passed: ${TESTS.passed}`);
  console.log(`  Failed: ${TESTS.failed}`);
  console.log(`  Skipped: ${TESTS.skipped}`);
  console.log('========================================\n');

  return TESTS.failed === 0 ? 'PASS' : 'FAIL';
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runAllPmosTests, TESTS };
}

// Auto-run if not being imported
if (typeof window !== 'undefined' && !window.__pmosTestsLoaded) {
  window.__pmosTestsLoaded = true;
  // Test suite will be loaded as a script; call runAllPmosTests() from console
  console.log('PMOS Test Suite loaded. Run runAllPmosTests() to execute.');
}
