# ACPM System Review

Date: 2026-06-23

## Scope

This review maps the current UI action surface, the functions behind each action, and the main data flows through the app. It is focused on operational reliability, permission boundaries, and where the system still trusts the browser too much.

## Entry Points

### Global app controls

- `toggleTheme()` in `index.html`
- `refreshHub()` in `main.js`
- `logout()` in `auth.js`
- `exitHub()` in `main.js`
- `showHubTab(tab)` in `main.js`
- `switchTab(tab)` in `main.js`

### Hub actions

- `createProject(event)` in `main.js`
- `filterProjects(query)` in `main.js`
- `exportHubCSV()` in `main.js`
- `markComplete(pid)` in `main.js`
- `reopenProject(pid)` in `main.js`
- `deleteProject(pid)` in `main.js`
- `openEditProjectModal(pid)` / `editProject()` in `main.js`

### Workspace actions

- `saveProjectNotes()` in `main.js`
- `exportAllData()` in `main.js`
- module init functions in workspace:
  - `initLabor(pid)`
  - `initMaterials(pid)`
  - `initBilling(pid)`
  - `initChangeOrders(pid)`
  - `initSiteLog(pid)`
  - `initSuppliers()`
  - `initTasks(pid)`
  - `initEquipment(pid)`
  - `initCompliance(pid)`
  - `initDefects(pid)`
  - `initNotifications()`

### Procurement / PO actions

- `addDraftItem()`
- `submitPO()`
- `approvePO(poId)`
- `openDeliveryModal(poId)` / `confirmDelivery()`
- `openInvoiceModal(poId)` / `confirmInvoice()`
- `updateLedgerStatus(key, status)`
- `deleteLedgerItem(key, desc)`
- `filterPOHistory(query)`
- `exportLedgerCSV()`
- `exportPOImage(poId)`

### Billing actions

- `saveContract()`
- `openEditContractModal()` / `saveEditContract()`
- `addBillingRequest()`
- `updateBillingStatus(key, status)`
- `deleteBilling(key)`
- `addCollection()`
- `deleteCollection(key)`
- `exportBillingSummary()`

### Labor actions

- `savePayrollConfig()`
- `saveProjectSettings()`
- `addTrade()` / `renameTrade()` / `deleteTrade()`
- `addWorker()` / `removeWorker()`
- `saveAdvance()` / `deleteAdvance()`
- attendance and payroll functions:
  - `markAttendance()`
  - `updateAttendanceOT()`
  - `applyWeek()`
  - `compilePayroll()`
  - `confirmSavePayroll()`
  - `generatePayslips()`
  - `downloadSinglePayslip()`
  - `downloadAllPayslips()`
  - `generateRFP()`
  - `copyRFP()`
  - `downloadRFP()`
  - `exportPayrollCSV()`

### Other modules

- `addSupplier()` / `saveEditSupplier()` / `deleteSupplier()` / `exportSuppliersCSV()`
- `addTask()` / `updateTaskStatus()` / `updateTaskProgress()` / `deleteTask()` / `saveEditTask()`
- `addEquipment()` / `logEquipHours()` / `logEquipExpense()` / `scheduleEquipService()` / `deleteEquipment()`
- `addCompliance()` / `renewCompliance()` / `deleteCompliance()` / `scanComplianceAcrossProjects()`
- `addDefect()` / `closeDefect()` / `reopenDefect()` / `deleteDefect()` / `exportDefectsCSV()`
- `addChangeOrder()` / `approveRejectCO()` / `deleteCO()` / `exportCOsCSV()`
- `sendNotification()` / `notifyProject()` / `markNotifRead()` / `markAllNotifRead()`

## Current Flow

### Authentication and profile loading

1. Firebase Auth establishes the session.
2. `loadUserProfile(uid)` reads `/users/{uid}`.
3. `applyProfile(profile)` sets `window._currentUser`.
4. `initAppForUser()` updates the UI based on role.
5. Boss-only controls are shown or hidden.

### Hub flow

1. `renderHub()` subscribes to `/projects`.
2. The selected hub tab filters by `status`.
3. `buildProjectCard()` renders the card and action buttons.
4. `canAccessProject(pid)` controls whether the card opens.
5. `canEditProject(pid)` controls edit/delete actions.

### Workspace flow

1. `enterProject(pid)` sets `window._currentPid`.
2. Each module attaches listeners under its own project subtree.
3. Actions write directly to Firebase via `safeDb()`.
4. `auditLog()` records the action in `auditLogs`.
5. `exitHub()` detaches listeners and returns to the hub.

### Procurement flow

1. `submitPO()` writes a PO and mirrored ledger rows.
2. `approvePO()` changes PO status and updates matching ledger rows.
3. `confirmDelivery()` records receipt, inventory, and delivery state.
4. `confirmInvoice()` records invoice match state.

## What Is Strong

- The app is small enough that the action flow is understandable.
- The module split is sensible: labor, materials, billing, tasks, equipment, compliance, defects, suppliers.
- The shared helpers in `utils.js` reduce duplication.
- `auditLog()` gives you a useful historical trail.
- The UI already uses consistent tab and modal patterns.

## Main Risks

### 1. Client-side trust is still high

Many write paths still trust the browser to enforce access before calling Firebase. The recent guards help, but the browser is still the last line of defense in a lot of places.

### 2. Role correctness is data-dependent

`window._currentUser.role` depends on `/users/{uid}`. If the DB record is wrong, the UI behavior changes immediately.

### 3. Some module actions do not consistently check access

The codebase has been hardened in the most visible paths, but there are still many write functions across modules that should be reviewed in the same way as:

- `createProject()`
- `markComplete()`
- `approvePO()`
- `saveProjectNotes()`

### 4. Notifications can still be noisy if called from the wrong place

`sendNotification()` and `notifyProject()` now check more than before, but they still rely on client execution.

### 5. Firebase rules lag behind the UI

The database rules are stricter than before, but several collections still rely on broad authenticated writes or client-managed permissions.

## Button/Action Coverage Snapshot

### Header

- Theme toggle
- Notifications dropdown
- Mark all notifications read
- Refresh dashboard
- Sign out
- Hub return

### Hub

- Create project
- Search projects
- Export CSV
- Hub tab switch
- Open workspace
- Mark complete
- Reopen
- Edit project
- Delete project

### Workspace

- Export project JSON
- Save project notes
- Tab switching
- Unlock for edit

### Labor

- Payroll settings
- Project settings
- Trade roster
- Worker roster
- Advance records
- Attendance
- Payroll compile and export
- RFP generation

### Materials / PO

- Draft PO items
- Submit PO
- Approve PO
- Record delivery
- Approve invoice
- Update ledger status
- Delete ledger item
- Export ledger CSV
- Export PO image

### Billing

- Save contract
- Edit contract
- Add billing request
- Update billing status
- Add collection
- Delete billing or collection

### Other project modules

- Site log save/export/delete
- Supplier add/edit/delete/export
- Task add/edit/move/delete
- Equipment add/log/delete
- Compliance add/renew/delete/scan
- Punch list add/close/reopen/delete/export
- Change order submit/approve/delete/export

## Recommended Next Pass

1. Add access checks to every remaining write action that still assumes the caller is authorized.
2. Standardize error handling so each mutation reports the real Firebase or validation error.
3. Tighten Firebase rules where writes should be project-scoped or role-scoped.
4. Add a small admin panel or account summary surface so you can see the current role and allowed projects without opening DevTools.
5. Revisit notifications and exports, since those are the next most likely places for operational surprises.

## Bottom Line

The system is structurally solid for a small team, but it still behaves like a client-heavy Firebase app rather than a fully self-defending system. The recent work moved it in the right direction. The next step is to harden the rest of the module actions using the same pattern we used for project and PO flows.

