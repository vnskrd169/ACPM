"""Local-only connected workspace using isolated sample data and real modules."""
from pathlib import Path
import re
import time
root=Path(__file__).resolve().parent.parent
source=(root/'workspace.html').read_text(encoding='utf-8')
materials=source[source.index('<div id="materialsPanel"'):source.index('<!-- === BILLING PANEL')]
site=source[source.index('<div id="sitelogPanel"'):source.index('<!-- === SUPPLIERS PANEL')]
modals=source[source.index('<div id="deliveryModal"'):source.index('<!-- === EDIT CONTRACT MODAL')]
html='''<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ACPM connected workspace — sample preview</title><link rel="stylesheet" href="../style.css?v=114"><link rel="stylesheet" href="../materials-workspace.css?v=2"><link rel="stylesheet" href="../workspace-insights.css?v=1"><style>body{padding:24px}.preview-wrap{max-width:1320px;margin:auto}.preview-nav{display:flex;gap:12px;flex-wrap:wrap;padding:16px 0;margin-bottom:20px;border-bottom:1px solid var(--border)}.panel-skeleton{display:none}.panel-content-wrap{display:block!important;opacity:1!important;transform:none!important}.panel:not(.hidden){display:block}@media(max-width:600px){body{padding:12px}}</style></head><body><main class="preview-wrap"><p>ACPM · Sample project · Local preview</p><nav class="preview-nav"><button class="btn-ws-secondary" onclick="switchTab('dashboard')">Mission Board</button><button class="btn-ws-secondary" onclick="switchTab('materials')">Materials</button><button class="btn-ws-secondary" onclick="switchTab('sitelog')">Site update</button><button class="btn-ws-secondary" onclick="changeRole()">Switch Boss / APM</button><button class="btn-ws-secondary" onclick="document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light'">Toggle theme</button></nav><div id="workspaceView"><div id="dashboardPanel" class="panel"></div>'''+materials+site+'''<div id="tasksPanel" class="panel hidden"><p>Tasks module links are covered by the isolated integration checks.</p></div></div></main>'''+modals+'''<script src="materials-fixture.js?v=2"></script><script src="../utils.js"></script><script src="../materials.js?v=99"></script><script src="../materials-workspace.js?v=2"></script><script src="../workspace-insights.js?v=1"></script><script src="../sitelog.js?v=96"></script><script>
if(!['localhost','127.0.0.1'].includes(location.hostname)){document.body.textContent='Local preview only';}else{
window.firebase=createMaterialsFixture();window._currentPid='materials-demo';window._currentUser={uid:'demo-user',name:'Alex Santos',role:'boss'};
window.requireEdit=()=>true;window.canEditProject=()=>true;window.hidePanelSkeleton=()=>{};window.auditLog=()=>{};window.notifyProject=async()=>{};window.toggleExtraTabs=()=>{};
window.switchTab=tab=>document.querySelectorAll('#workspaceView>.panel').forEach(panel=>panel.classList.toggle('hidden',panel.id!==tab+'Panel'));
window.changeRole=()=>{window._currentUser.role=window._currentUser.role==='boss'?'apm':'boss';renderConnectedWorkspace('materials-demo',firebase.read('projects/materials-demo'));};
const today=materialToday(),yesterday=materialToday(new Date(Date.now()-86400000));
firebase.put('projects/materials-demo/name','Sample residence · Fit-out');
firebase.put('projects/materials-demo/tasks',{t1:{title:'Confirm ceiling layout',status:'blocked',assignedToName:'APM Ana',blockedReason:'Waiting for the revised reflected ceiling plan',dueDate:yesterday,createdAt:Date.now()-2*86400000},t2:{title:'Inspect framing installation',status:'for_verification',assignedToName:'APM Ana',submittedForVerificationAt:Date.now()-86400000},t3:{title:'Prepare room handover',status:'in_progress',dueDate:today,assignedToName:'APM Ana'}});
firebase.put('projects/materials-demo/purchaseOrders/demo-po/invoiceAmount',4300);firebase.put('projects/materials-demo/purchaseOrders/demo-po/invoiceNo','INV-0042');firebase.put('projects/materials-demo/purchaseOrders/demo-po/invoiceStatus','mismatch');
firebase.put('projects/materials-demo/siteLogs/log-one',{logNo:'SL-0001',date:yesterday,status:'posted',workAccomplished:'Ceiling framing installed in bedroom',createdAt:Date.now()-86400000,createdByName:'APM Ana'});
window.fetchAccessibleProjectsOnce=async()=>[{id:'second-site',name:'Sample office',materialGroups:{paint:{name:'Painting essentials',items:[{desc:'Primer',unit:'pail',qty:2},{desc:'Roller',unit:'pcs',qty:3}]}}}];
initMaterials('materials-demo');initSiteLog('materials-demo');firebase.database().ref('projects/materials-demo').on('value',s=>renderConnectedWorkspace('materials-demo',s.val()));}
</script></body></html>'''
html=re.sub(r'((?:src|href)="[^"\n]+\.(?:js|css)(?:\?[^"\n]*)?)(")',lambda m:m[1]+('&' if '?' in m[1] else '?')+'preview='+str(time.time_ns())+m[2],html)
(root/'dev/connected-preview.html').write_text(html,encoding='utf-8')
print('Created local connected workspace preview.')
