const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'changeorders.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function functionBody(name) {
  const patterns = [`async function ${name}(`, `function ${name}(`];
  const start = patterns.map(p => source.indexOf(p)).filter(i => i >= 0).sort((a, b) => a - b)[0];
  assert(start >= 0, `Missing ${name}()`);
  const signatureEnd = source.indexOf(') {', start);
  assert(signatureEnd >= 0, `Could not find ${name}() signature end`);
  const brace = signatureEnd + 2;
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, i);
    }
  }
  throw new Error(`Could not parse ${name}() body`);
}

function main() {
  const create = functionBody('createChangeOrder');
  const updateStatus = functionBody('updateChangeOrderStatus');
  const activeDelete = functionBody('deleteCO');
  const link = functionBody('linkChangeOrderBilling');
  const rollup = functionBody('calculateChangeOrderRollup');
  const syncBudget = functionBody('syncProjectBudgetDeltasFromChangeOrders');
  const watch = functionBody('watchChangeOrders');

  assert(!source.includes('window.legacyDeleteCO'), 'legacy delete helper must not be exported');
  assert(!source.includes('window.legacyApproveRejectCO'), 'legacy approve/reject helper must not be exported');
  assert(!/changeOrders[^;]+\.remove\(/.test(source), 'Change Orders must not be removed through .remove()');
  assert(!/changeOrders[^;]+set\(null/.test(source), 'Change Orders must not be deleted through set(null)');

  assert(create.includes('status: CHANGE_ORDER_STATUSES.pending'), 'New change orders must start pending');
  assert(create.includes('statusHistory'), 'New change orders must create status history');
  assert(create.includes('changeOrderEvents'), 'New change orders must write changeOrderEvents');
  assert(create.includes('notificationEvents'), 'New change orders must create notification events');
  assert(create.includes('await finalizeChangeOrderFinancials(projectId)'), 'New change orders must rebuild financial rollups');

  assert(updateStatus.includes('statusHistory'), 'Status updates must append status history');
  assert(updateStatus.includes('changeOrderEvents'), 'Status updates must write events');
  assert(updateStatus.includes('notificationEvents'), 'Status updates must write notification events');
  assert(updateStatus.includes('await finalizeChangeOrderFinancials(projectId)'), 'Status updates must rebuild financial rollups');
  assert(updateStatus.includes('voidReason'), 'Void status must preserve a reason');
  assert(updateStatus.includes('rejectReason'), 'Reject status must preserve a reason');

  assert(activeDelete.includes('Void this change order?'), 'Active UI deleteCO must be a void action');
  assert(activeDelete.includes('A reason is required'), 'Voiding must require a reason');
  assert(activeDelete.includes('voidChangeOrder(_copid, key, reason.trim())'), 'deleteCO must call voidChangeOrder');
  assert(activeDelete.includes("auditLog('void', 'changeOrder'"), 'Voiding must create an audit log');

  assert(link.includes("billingType !== 'change_order'"), 'Billing linkage must only accept change_order billings');
  assert(link.includes('Only approved active change orders'), 'Billing linkage must reject non-approved COs');
  assert(link.includes('changeOrderIds'), 'Billing linkage must mirror link under billing record');
  assert(link.includes('change_order_billing_linked'), 'Billing linkage must create notification event');

  assert(rollup.includes('status === CHANGE_ORDER_STATUSES.voided'), 'Rollup must ignore voided rows');
  assert(rollup.includes('status === CHANGE_ORDER_STATUSES.approved'), 'Rollup must explicitly sum approved rows');
  assert(syncBudget.includes('coIsApproved(co) && !coIsVoided(co)'), 'Budget deltas must rebuild from approved non-void rows');
  assert(watch.includes('finalizeChangeOrderFinancials(pid'), 'Watcher must rebuild financials after live changes');

  for (const exportName of [
    'createChangeOrder',
    'updateChangeOrderStatus',
    'approveChangeOrder',
    'rejectChangeOrder',
    'voidChangeOrder',
    'linkChangeOrderBilling',
    'deleteCO'
  ]) {
    assert(source.includes(`window.${exportName} = ${exportName}`), `${exportName} must be exported`);
  }

  console.log(JSON.stringify({
    result: 'PASS',
    checks: [
      'no exported permanent delete path',
      'create/review/approve/reject/void workflow helpers',
      'status history and events',
      'notification hooks',
      'void reason and audit path',
      'rebuild-based rollups and budget deltas',
      'billing linkage validation'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ result: 'FAILED', error: error.message }, null, 2));
  process.exit(1);
}
