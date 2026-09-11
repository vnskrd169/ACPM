"""Build a localhost-only preview from the real Materials markup and modules."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
source = (root / 'workspace.html').read_text(encoding='utf-8')
panel = source[source.index('<div id="materialsPanel"'):source.index('<!-- === BILLING PANEL')]
panel = panel.replace('class="panel hidden"', 'class="panel"', 1)
modals = source[source.index('<div id="deliveryModal"'):source.index('<!-- === EDIT CONTRACT MODAL')]
html = '''<!doctype html><html lang="en" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ACPM Materials — design preview</title>
<link rel="stylesheet" href="../style.css?v=114"><link rel="stylesheet" href="../materials-workspace.css?v=1">
<style>body{padding:24px;margin:0;background:var(--bg);color:var(--text)}main{max-width:1320px;margin:auto}#materialsPanel{display:block}#matSkeleton{display:none}.panel-content-wrap{display:block!important;opacity:1!important;transform:none!important}.preview-bar{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid var(--border);padding:0 0 16px;margin:0 0 24px;font-size:14px;color:var(--muted2)}.preview-bar strong{color:var(--text)}.preview-bar button{padding:10px 14px;border:1px solid var(--border2);background:var(--surface);color:var(--text);border-radius:8px;cursor:pointer}@media(max-width:600px){body{padding:12px}.preview-bar{flex-wrap:wrap}}</style>
</head><body><main><div class="preview-bar"><div><strong>ACPM / Materials preview</strong><br>Sample project · local test data</div><button type="button" onclick="document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light'">Toggle theme</button></div>'''+panel+'''</main>'''+modals+'''
<script src="materials-fixture.js"></script><script src="../utils.js"></script><script src="../materials.js?v=98"></script><script src="../materials-workspace.js?v=1"></script>
<script>
if(!['localhost','127.0.0.1'].includes(location.hostname)){document.body.textContent='Local preview only';}else{
window.firebase=createMaterialsFixture();window._currentUser={uid:'demo-user',name:'Alex Santos',role:'boss'};
window.requireEdit=()=>true;window.canEditProject=()=>true;window.hidePanelSkeleton=()=>{};window.auditLog=()=>{};window.notifyProject=async()=>{};
initMaterials('materials-demo');}
</script></body></html>'''
(root / 'dev/materials-preview.html').write_text(html, encoding='utf-8')
print('Created dev/materials-preview.html using the current Materials workspace.')
