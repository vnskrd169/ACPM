(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ACPMAttention = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;
  var AGING_ISSUE_DAYS = 3;
  var CLOSED = ['completed', 'done', 'closed', 'cancelled', 'archived', 'rejected', 'delivered', 'fully_delivered', 'voided'];
  var PENDING_REQUEST = ['pending', 'submitted', 'under_review', 'approved', 'partially_approved', 'for_procurement', 'ordered', 'partially_delivered', 'bought'];
  var SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

  function rows(value) {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.map(function (record, index) { return Object.assign({ id: String(index) }, record || {}); });
    return Object.keys(value).map(function (id) { return Object.assign({ id: id }, value[id] || {}); });
  }

  function normalized(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  }

  function dateKey(timestamp) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date(timestamp));
    } catch (_) {
      return new Date(timestamp).toISOString().slice(0, 10);
    }
  }

  function shiftDateKey(key, days) {
    var parts = String(key).split('-').map(Number);
    if (parts.length !== 3 || parts.some(function (part) { return !Number.isFinite(part); })) return '';
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days)).toISOString().slice(0, 10);
  }

  function timestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (typeof value !== 'string' || !value.trim()) return 0;
    var parsed = Date.parse(value.length === 10 ? value + 'T00:00:00+08:00' : value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function ageDays(value, now) {
    var occurred = timestamp(value);
    return occurred ? Math.max(0, Math.floor((now - occurred) / DAY_MS)) : null;
  }

  function activeRecord(record) {
    return CLOSED.indexOf(normalized(record && record.status)) === -1;
  }

  function activeProject(project) {
    return ['completed', 'archived', 'cancelled'].indexOf(normalized(project && project.status || 'active')) === -1;
  }

  function storedSeverity(record) {
    var value = normalized(record && (record.severity || record.priority));
    if (value === 'critical') return 'critical';
    if (value === 'high' || value === 'major') return 'high';
    return '';
  }

  function taskStatus(value) {
    var status = normalized(value);
    if (['todo', 'open', 'new', 'pending'].indexOf(status) !== -1) return 'pending';
    if (['in_progress', 'ongoing'].indexOf(status) !== -1) return 'in_progress';
    if (['blocked', 'waiting'].indexOf(status) !== -1) return 'blocked';
    if (['review', 'for_verification'].indexOf(status) !== -1) return 'for_verification';
    if (['done', 'closed', 'completed'].indexOf(status) !== -1) return 'completed';
    if (['archived', 'cancelled'].indexOf(status) !== -1) return 'cancelled';
    return 'pending';
  }

  function projectTasks(project) {
    var seen = {};
    return rows(project.tasks).concat(rows(project.pmosTasks)).filter(function (task) {
      var key = String(task.id || '');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function expectedWorkers(project, day) {
    return rows(project.workers).filter(function (worker) {
      if (worker.active === false || ['inactive', 'archived'].indexOf(normalized(worker.status)) !== -1) return false;
      var start = String(worker.startDate || worker.hireDate || worker.dateStarted || '').slice(0, 10);
      var end = String(worker.endDate || worker.inactiveDate || worker.dateEnded || '').slice(0, 10);
      return (!start || start <= day) && (!end || end >= day);
    });
  }

  function attendanceItem(project, now) {
    var day = shiftDateKey(dateKey(now), -1);
    var workers = expectedWorkers(project, day);
    if (!workers.length) return null;
    var attendance = project.attendance || {};
    var recorded = workers.filter(function (worker) {
      var entry = attendance[worker.id] && attendance[worker.id][day];
      return entry && entry.status && normalized(entry.status) !== 'unmarked';
    });
    // A date is applicable only when at least one expected worker has a real
    // recorded state. This avoids treating a non-working day as incomplete.
    if (!recorded.length || recorded.length === workers.length) return null;
    var unresolved = workers.length - recorded.length;
    return makeItem(project, {
      id: 'attendance:' + project.id + ':' + day,
      category: 'attendance', severity: 'medium',
      title: 'Unresolved attendance',
      summary: unresolved + ' attendance entr' + (unresolved === 1 ? 'y is' : 'ies are') + ' unresolved for ' + day + '.',
      sourceType: 'attendance_date', sourceId: day,
      occurredAt: timestamp(day), age: ageDays(day, now), status: 'unresolved',
      recommendedDestination: 'attendance'
    });
  }

  function taskItems(project, now, today) {
    var items = [];
    projectTasks(project).forEach(function (task) {
      var status = taskStatus(task.status);
      if (status === 'completed' || status === 'cancelled') return;
      var due = String(task.dueDate || '').slice(0, 10);
      var overdue = !!due && due < today;
      var blocked = status === 'blocked';
      var verification = status === 'for_verification';
      if (!overdue && !blocked && !verification) return;
      var explicit = storedSeverity(task);
      var severity = explicit || (blocked && overdue ? 'high' : (overdue || blocked ? 'medium' : 'low'));
      var kind = blocked && overdue ? 'Blocked overdue task' : blocked ? 'Blocked task' : overdue ? 'Overdue task' : 'For verification';
      var occurred = timestamp(blocked ? (task.blockedAt || task.updatedAt || task.createdAt) : overdue ? due : (task.submittedForVerificationAt || task.updatedAt || task.createdAt));
      items.push(makeItem(project, {
        id: 'task:' + project.id + ':' + task.id,
        category: verification ? 'verification' : 'task', severity: severity,
        title: kind,
        summary: String(task.title || task.task || 'Task') + (blocked && task.blockedReason ? ' — ' + task.blockedReason : ''),
        sourceType: 'task', sourceId: String(task.id), occurredAt: occurred,
        age: ageDays(occurred, now), status: status, recommendedDestination: 'task'
      }));
    });
    return items;
  }

  function deliveryItems(project, now) {
    var items = [];
    rows(project.purchaseOrders).forEach(function (order) {
      var orderStatus = normalized(order.deliveryStatus || order.status);
      if (['approved', 'ordered', 'partially_delivered'].indexOf(orderStatus) === -1) return;
      rows(order.items).forEach(function (line, index) {
        var ordered = Number(line.qtyOrdered != null ? line.qtyOrdered : line.qty);
        var received = Number(line.qtyAccepted != null ? line.qtyAccepted : line.qtyReceived);
        if (!Number.isFinite(ordered) || !Number.isFinite(received) || ordered <= 0 || received < 0 || received >= ordered) return;
        var pending = ordered - received;
        var unit = String(line.unit || '').trim();
        var suffix = unit ? ' ' + unit : '';
        items.push(makeItem(project, {
          id: 'delivery:' + project.id + ':' + order.id + ':' + (line.id || index),
          category: 'delivery', severity: 'medium',
          title: String(line.desc || line.description || line.item || line.name || 'Material delivery'),
          summary: 'Received ' + received + suffix + ' / ' + ordered + suffix + '. Pending ' + pending + suffix + '.',
          sourceType: 'purchase_order', sourceId: String(order.id),
          occurredAt: timestamp(line.lastReceivedAt || order.lastDeliveryDate || order.date || order.createdAt),
          age: ageDays(line.lastReceivedAt || order.lastDeliveryDate || order.date || order.createdAt, now),
          status: 'partial_delivery', recommendedDestination: 'materials'
        }));
      });
    });
    return items;
  }

  function requestItems(project, now) {
    var seen = {};
    var items = [];
    rows(project.purchaseRequests).concat(rows(project.pmosMaterialRequests)).forEach(function (request) {
      var key = String(request.id || '');
      if (seen[key]) return;
      seen[key] = true;
      var status = normalized(request.status || 'pending');
      if (PENDING_REQUEST.indexOf(status) === -1) return;
      var explicit = storedSeverity(request);
      items.push(makeItem(project, {
        id: 'material_request:' + project.id + ':' + key,
        category: 'materials', severity: explicit || 'low',
        title: 'Material request pending',
        summary: String(request.item || request.description || request.material || 'Material request') + ' — ' + status.replace(/_/g, ' ') + '.',
        sourceType: 'material_request', sourceId: key,
        occurredAt: timestamp(request.createdAt || request.requestedAt || request.date),
        age: ageDays(request.createdAt || request.requestedAt || request.date, now),
        status: status, recommendedDestination: 'materials'
      }));
    });
    return items;
  }

  function issueItems(project, now) {
    var seen = {};
    var items = [];
    rows(project.punchList).concat(rows(project.pmosIssues), rows(project.defects)).forEach(function (issue) {
      var key = String(issue.id || '');
      if (seen[key] || !activeRecord(issue)) return;
      seen[key] = true;
      var occurred = timestamp(issue.createdAt || issue.reportedAt || issue.date);
      var age = ageDays(occurred, now);
      var aging = age !== null && age >= AGING_ISSUE_DAYS;
      var explicit = storedSeverity(issue);
      items.push(makeItem(project, {
        id: 'site_issue:' + project.id + ':' + key,
        category: 'site_issue', severity: explicit || (aging ? 'medium' : 'low'),
        title: aging ? 'Aging site issue' : 'Open site issue',
        summary: String(issue.description || issue.issue || issue.title || 'Site issue') + (aging ? ' — open for ' + age + ' days.' : ''),
        sourceType: 'site_issue', sourceId: key, occurredAt: occurred, age: age,
        status: normalized(issue.status || 'open'), recommendedDestination: 'issue'
      }));
    });
    return items;
  }

  function makeItem(project, values) {
    return Object.assign({
      id: '', projectId: String(project.id || ''), projectName: String(project.name || project.id || 'Project'),
      category: 'task', severity: 'low', title: '', summary: '', sourceType: '', sourceId: '',
      occurredAt: 0, age: null, status: 'open', recommendedDestination: 'project', detectedBy: 'deterministic'
    }, values);
  }

  function compareItems(a, b) {
    return (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
      || (b.age == null ? -1 : b.age) - (a.age == null ? -1 : a.age)
      || String(a.projectName).localeCompare(String(b.projectName))
      || String(a.id).localeCompare(String(b.id));
  }

  function derive(projects, options) {
    var now = options && Number.isFinite(options.now) ? options.now : Date.now();
    var today = dateKey(now);
    var items = [];
    (Array.isArray(projects) ? projects : []).filter(activeProject).forEach(function (project) {
      var attendance = attendanceItem(project, now);
      if (attendance) items.push(attendance);
      items = items.concat(taskItems(project, now, today), deliveryItems(project, now), requestItems(project, now), issueItems(project, now));
    });
    return items.sort(compareItems);
  }

  function summarizeProjects(projects, items) {
    return (Array.isArray(projects) ? projects : []).filter(activeProject).map(function (project) {
      var own = items.filter(function (item) { return item.projectId === String(project.id); });
      var counts = { critical: 0, high: 0, medium: 0, low: 0 };
      own.forEach(function (item) { if (Object.prototype.hasOwnProperty.call(counts, item.severity)) counts[item.severity] += 1; });
      return {
        projectId: String(project.id || ''), projectName: String(project.name || project.id || 'Project'),
        attentionCount: own.length, counts: counts, status: own.length ? 'needs_attention' : 'on_track'
      };
    }).sort(function (a, b) { return b.attentionCount - a.attentionCount || a.projectName.localeCompare(b.projectName); });
  }

  return {
    AGING_ISSUE_DAYS: AGING_ISSUE_DAYS,
    DESTINATIONS: Object.freeze(['attendance', 'task', 'materials', 'issue', 'project']),
    derive: derive,
    summarizeProjects: summarizeProjects,
    dateKey: dateKey,
    shiftDateKey: shiftDateKey
  };
});
