# ACPM APM Workspace vNext

## Primary user

This release is designed for ACPM's Assistant Project Managers (APMs). It prioritizes daily construction coordination: attendance, current tasks, site issues, material requests and delivery follow-up, and site updates. It does not expand billing, company finance, payroll processing, inventory management, or executive analytics.

The design goal is operational familiarity. An experienced construction user coming from Excel or manual logs should be able to identify today's work and begin an update without first interpreting an executive dashboard.

## Information hierarchy

The APM experience uses three disclosure levels:

1. **Needs attention now.** APM Home surfaces only unresolved attendance from yesterday, overdue or blocked tasks, pending deliveries, and open site issues. A calm `Everything is on track` state replaces success-card walls when no exception exists.
2. **Current operational detail.** Quick actions, assigned-project rows, the project daily summary, and compact record tables expose the work needed to act.
3. **History, audit, and advanced tools.** Existing less-frequent modules remain available through `More`, `View details`, module-specific advanced controls, or explicit history filters.

Counts and alerts come from the existing assigned-project data. The APM layer does not create a parallel business-data source.

## Navigation

APM Home exposes a small daily navigation set:

- Home
- Projects
- Attendance
- Tasks
- Materials
- Site
- More

Inside a project, the primary tabs are Home, Attendance, Tasks, Materials, and Site. Existing permitted modules are grouped behind More. Tasks are no longer treated as an advanced module for APMs.

The navigation changes are role-scoped presentation changes. Existing route authorization and project access checks remain authoritative. The APM `More` state is session-only and does not alter global feature configuration.

## Exception-first approach

Normal data is quiet. The default home view prioritizes overdue, unresolved, pending, blocked, due-today, and follow-up states. Healthy projects use a short `Everything on track` summary rather than several green KPI cards.

The project home follows the same pattern: today's attendance completion, tasks due or overdue, open issues, and pending deliveries appear first, followed by current-work tables. Budget and finance KPIs do not dominate the APM view.

## Excel-familiar interaction

Cards are limited to summaries and actions. Operational records continue to use rows, dates, explicit status columns, quantities, and compact tables. Wide tables scroll within their own container on narrow screens rather than forcing document-level horizontal overflow.

Attendance is date-oriented and explicit. Each active worker starts as `Unmarked` when no record exists. Missing data is never displayed or persisted as `Absent`. `Mark All Present` writes only unresolved workers for the selected date and does not overwrite an existing status.

Materials show ordered, received, pending, delivery status, and verified on-site inventory when an exact inventory record is available. Otherwise the interface states `Stock not verified`; it does not infer stock from an order or claim an out-of-stock state without reliable inventory data.

Tasks default to Today, with Upcoming, Blocked, and For Verification views available directly. Completed and cancelled records remain accessible through the explicit Completed / History filter and are hidden from daily views.

## Role boundaries

The new experience activates only for the normalized `apm` role. Boss, owner, admin, PM, reviewer, and other existing role experiences retain their current dashboards and module organization.

No database or storage rules are changed. No role permissions are broadened. Existing edit checks remain in the module write paths. AI Command Center is intentionally absent from APM Home because the current security model does not allow APM access to AI output; `/ai/config`, `/ai/uiStatus`, and AI-result access remain unchanged.

## Responsive behavior

The daily navigation and quick actions wrap on compact screens. Project summaries stack, table containers provide intentional horizontal scrolling, and the workspace tab bar remains sticky and horizontally scrollable. Existing modal, overlay, keyboard, listener-cleanup, service-worker, and navigation hardening stays in place.

## Intentionally deferred

- Payroll workflow redesign or payroll blocking for unresolved attendance
- New billing, finance, owner, or executive dashboards
- Warehouse-style inventory and mandatory physical counts
- New material-request or issue business workflows beyond existing modules
- AI recommendations for APMs or any AI permission change
- Destructive removal of existing advanced capabilities
- Broad redesign of non-APM role experiences

This milestone simplifies discovery and presentation around existing capabilities. Future work should validate the flow with the first three APMs before adding new operational systems.
