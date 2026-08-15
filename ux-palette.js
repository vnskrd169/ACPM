/* ══════════════════════════════════════════════════════════════
   ACPM — UX Command Palette & Experience Enhancements
   Loads after main.js.
   Hooks into window globals exposed by main.js and auth.js.
   ══════════════════════════════════════════════════════════════ */

// ════════════════════════════════════════════════════════════
//  COMMAND PALETTE — Ctrl+K / Cmd+K
//  Keyboard-first navigation and quick actions.
// ════════════════════════════════════════════════════════════

let _cmdPaletteOverlay = null;
let _cmdPaletteSelectedIndex = -1;
let _cmdPaletteItems = [];

function openCmdPalette() {
  closeCmdPalette(); // Remove any existing palette

  const overlay = document.createElement('div');
  overlay.className = 'cmd-palette-overlay';
  overlay.id = 'cmdPalette';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Command palette');

  overlay.innerHTML = `
    <div class="cmd-palette">
      <div class="cmd-palette-input-wrap">
        <span class="cmd-palette-search-icon">🔍</span>
        <input type="text" id="cmdPaletteInput" placeholder="Type a command or search..." autocomplete="off" spellcheck="false">
      </div>
      <div class="cmd-palette-sections" id="cmdPaletteResults"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  _cmdPaletteOverlay = overlay;

  const input = document.getElementById('cmdPaletteInput');
  if (input) {
    // Delay focus to allow animation
    requestAnimationFrame(() => input.focus());
    input.addEventListener('input', () => renderCmdPaletteResults(input.value));
    input.addEventListener('keydown', handleCmdPaletteKeydown);
  }

  // Click outside to close
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeCmdPalette();
  });

  // Escape to close handled by global keydown handler
  renderCmdPaletteResults('');
}

function closeCmdPalette() {
  if (_cmdPaletteOverlay) {
    _cmdPaletteOverlay.remove();
    _cmdPaletteOverlay = null;
  }
  _cmdPaletteSelectedIndex = -1;
  _cmdPaletteItems = [];
}

function handleCmdPaletteKeydown(e) {
  const results = document.getElementById('cmdPaletteResults');
  if (!results) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const items = results.querySelectorAll('.cmd-palette-item');
    items.forEach(i => i.classList.remove('selected'));
    _cmdPaletteSelectedIndex = Math.min(_cmdPaletteSelectedIndex + 1, items.length - 1);
    const selected = items[_cmdPaletteSelectedIndex];
    if (selected) {
      selected.classList.add('selected');
      selected.scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const items = results.querySelectorAll('.cmd-palette-item');
    items.forEach(i => i.classList.remove('selected'));
    _cmdPaletteSelectedIndex = Math.max(_cmdPaletteSelectedIndex - 1, 0);
    const selected = items[_cmdPaletteSelectedIndex];
    if (selected) {
      selected.classList.add('selected');
      selected.scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const items = results.querySelectorAll('.cmd-palette-item');
    const selected = items[_cmdPaletteSelectedIndex];
    if (selected) {
      selected.click();
    } else if (items.length > 0) {
      items[0].click();
    }
  } else if (e.key === 'Tab') {
    e.preventDefault();
    // Tab selects first item and closes
    const items = results.querySelectorAll('.cmd-palette-item');
    if (items.length > 0) {
      items[0].click();
    }
  }
}

function renderCmdPaletteResults(query) {
  const results = document.getElementById('cmdPaletteResults');
  if (!results) return;

  const q = query.toLowerCase().trim();
  const user = window._currentUser || {};
  const isBossUser = typeof isBoss === 'function' ? isBoss(user.role) : user.role === 'boss';
  const pid = window._currentPid;

  // Build available commands
  const commands = [];
  const isInWorkspace = pid && $('workspaceView') && !$('workspaceView').classList.contains('hidden');
  const isInHub = $('hubView') && !$('hubView').classList.contains('hidden');

  // Navigation commands
  if (isInWorkspace) {
    commands.push({ id: 'nav-hub', label: 'Back to Hub', hint: 'Go to dashboard', icon: '🏠', action: () => { closeCmdPalette(); if (typeof exitHub === 'function') exitHub(); } });
    commands.push({ id: 'nav-labor', label: 'Go to Labor', hint: 'Attendance, payroll, workers', icon: '👷', action: () => { closeCmdPalette(); if (typeof switchTab === 'function') switchTab('labor'); } });
    commands.push({ id: 'nav-materials', label: 'Go to Materials', hint: 'POs, inventory, ledger', icon: '📦', action: () => { closeCmdPalette(); if (typeof switchTab === 'function') switchTab('materials'); } });
    commands.push({ id: 'nav-billing', label: 'Go to Billing', hint: 'Invoices, collections, contracts', icon: '💰', action: () => { closeCmdPalette(); if (typeof switchTab === 'function') switchTab('billing'); } });
    commands.push({ id: 'nav-sitelog', label: 'Go to Site Log', hint: 'Daily site reports', icon: '📒', action: () => { closeCmdPalette(); if (typeof switchTab === 'function') switchTab('sitelog'); } });
    commands.push({ id: 'nav-changeorders', label: 'Go to Change Orders', hint: 'COs and budget adjustments', icon: '📋', action: () => { closeCmdPalette(); if (typeof switchTab === 'function') switchTab('changeorders'); } });
    commands.push({ id: 'nav-suppliers', label: 'Go to Suppliers', hint: 'Supplier directory', icon: '🏪', action: () => { closeCmdPalette(); if (typeof switchTab === 'function') switchTab('suppliers'); } });
    commands.push({ id: 'nav-reports', label: 'Go to Reports', hint: 'Project reports', icon: '📊', action: () => { closeCmdPalette(); if (typeof switchTab === 'function') switchTab('reports'); } });
  }

  if (isInHub || !isInWorkspace) {
    commands.push({ id: 'nav-admin', label: 'Open Team Admin', hint: 'Manage users, requests, audit log', icon: '👥', action: () => { closeCmdPalette(); if (typeof openTeamAdmin === 'function') openTeamAdmin(); } });
  }

  // Quick actions
  if (pid) {
    commands.push({ id: 'action-export', label: 'Export Project Data', hint: 'Download project as JSON', icon: '⬇️', action: () => { closeCmdPalette(); if (typeof exportAllData === 'function') exportAllData(); } });
  }

  if (isBossUser && isInHub) {
    commands.push({ id: 'action-new-project', label: 'Create New Project', hint: 'Start a new construction project', icon: '🏗️', action: () => { closeCmdPalette(); const search = document.getElementById('projectSearch'); if (search) search.focus(); } });
    commands.push({ id: 'action-backup', label: 'Download Database Backup', hint: 'Full system backup as JSON', icon: '💾', action: () => { closeCmdPalette(); if (typeof exportDatabaseBackup === 'function') exportDatabaseBackup(); } });
  }

  // Recent projects from the DOM
  const projectCards = document.querySelectorAll('.proj-card[data-pid]');
  const recentProjects = [];
  projectCards.forEach(card => {
    const pid = card.getAttribute('data-pid');
    const name = card.getAttribute('data-name') || pid;
    recentProjects.push({
      id: `proj-${pid}`,
      label: name,
      hint: 'Open project workspace',
      icon: '📁',
      action: () => { closeCmdPalette(); if (typeof openProjectFromHub === 'function') openProjectFromHub(pid); }
    });
  });

  // Filter by query
  const filteredCommands = commands.filter(c => {
    const text = `${c.label} ${c.hint}`.toLowerCase();
    return !q || text.includes(q);
  });

  const filteredProjects = recentProjects.filter(c => {
    const text = `${c.label} ${c.hint}`.toLowerCase();
    return q && text.includes(q);
  });

  // Build HTML
  let html = '';
  _cmdPaletteItems = [];

  if (!filteredCommands.length && !filteredProjects.length) {
    html = '<div class="cmd-palette-empty">No matching commands found.</div>';
  } else {
    if (filteredCommands.length) {
      html += '<div class="cmd-palette-section-label">Commands</div>';
      filteredCommands.forEach(c => {
        _cmdPaletteItems.push(c);
        html += `<button class="cmd-palette-item" data-cmd-id="${c.id}" onclick="executeCmdPaletteItem('${c.id}')">
          <span class="cmd-palette-item-icon">${c.icon}</span>
          <span class="cmd-palette-item-text">${escapeHtml(c.label)}</span>
          <span class="cmd-palette-item-hint">${escapeHtml(c.hint)}</span>
        </button>`;
      });
    }
    if (filteredProjects.length) {
      html += '<div class="cmd-palette-section-label">Projects</div>';
      filteredProjects.forEach(c => {
        _cmdPaletteItems.push(c);
        html += `<button class="cmd-palette-item" data-cmd-id="${c.id}" onclick="executeCmdPaletteItem('${c.id}')">
          <span class="cmd-palette-item-icon">${c.icon}</span>
          <span class="cmd-palette-item-text">${escapeHtml(c.label)}</span>
          <span class="cmd-palette-item-hint">${escapeHtml(c.hint)}</span>
        </button>`;
      });
    }
  }

  results.innerHTML = html;
  _cmdPaletteSelectedIndex = -1;
}

function executeCmdPaletteItem(id) {
  const item = _cmdPaletteItems.find(i => i.id === id);
  if (item && item.action) {
    item.action();
  }
}

// ════════════════════════════════════════════════════════════
//  PREFERENCE WIRING
//  Hooks into existing functions to save/restore state.
// ════════════════════════════════════════════════════════════

function restoreUserPreferences() {
  // Restore last hub tab
  const lastHubTab = loadPreference(PREF_KEYS.lastHubTab, 'active');
  if (lastHubTab && typeof showHubTab === 'function') {
    // Only restore if we're on the hub view (not in a workspace)
    const hubView = $('hubView');
    if (hubView && !hubView.classList.contains('hidden')) {
      showHubTab(lastHubTab);
    }
  }

  // Restore last workspace tab if in a workspace
  const pid = window._currentPid;
  if (pid) {
    const lastTab = loadPreference(PREF_KEYS.lastTab, 'dashboard');
    if (lastTab && typeof switchTab === 'function') {
      // Check if the tab button exists
      const tabBtn = $(`tab_${lastTab}`);
      if (tabBtn && tabBtn.style.display !== 'none') {
        switchTab(lastTab);
      }
    }
  }
}

// Hook into enterProject - wrap original to save preference
const _origEnterProject = window.enterProject;
window.enterProject = async function(pid) {
  const result = await _origEnterProject(pid);
  if (result) {
    try { savePreference(PREF_KEYS.lastProjectId, pid); } catch(e) {}
  }
  return result;
};

// Hook into switchTab - wrap original to save preference
const _origSwitchTab = window.switchTab;
window.switchTab = function(tab) {
  _origSwitchTab(tab);
  if (window._currentPid) {
    try { savePreference(PREF_KEYS.lastTab, tab); } catch(e) {}
  }
};

// Hook into showHubTab - wrap original to save preference
const _origShowHubTab = window.showHubTab;
window.showHubTab = function(tab) {
  _origShowHubTab(tab);
  try { savePreference(PREF_KEYS.lastHubTab, tab); } catch(e) {}
};

// Hook into exitHub to save that we're back on hub
const _origExitHub = window.exitHub;
window.exitHub = function() {
  _origExitHub();
  try { removePreference(PREF_KEYS.lastTab); } catch(e) {}
};

// ════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS — Ctrl+K, enhanced Escape
//  Adds to existing shortcut handler. Must not duplicate.
// ════════════════════════════════════════════════════════════

// Add Ctrl+K and enhanced Escape via a secondary handler
document.addEventListener('keydown', function(e) {
  // Ctrl+K / Cmd+K — Open command palette
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    // Don't trigger if typing in input/textarea/select
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
    e.preventDefault();
    e.stopPropagation();
    openCmdPalette();
    return;
  }

  // Escape — Close command palette if open
  if (e.key === 'Escape' && _cmdPaletteOverlay) {
    e.preventDefault();
    closeCmdPalette();
    return;
  }
}, true); // Use capture phase to handle before main.js handler

// ════════════════════════════════════════════════════════════
//  INIT — Call after auth resolves
// ════════════════════════════════════════════════════════════

function initUXEnhancements() {
  // Restore user preferences after a short delay to let data load
  setTimeout(restoreUserPreferences, 300);
}

// ════════════════════════════════════════════════════════════
//  AUTO-REFRESH — DECISION: REMOVED
//  Firebase realtime `on('value', ...)` listeners already
//  provide automatic live updates across all modules.
//  No explicit refresh logic is needed.
//  The old refreshCurrentView() would have created duplicate
//  listeners if ever called, and was never triggered.
//  Removed in Final Completion Pass 2026-07.
// ════════════════════════════════════════════════════════════

// Export globals
window.openCmdPalette = openCmdPalette;
window.closeCmdPalette = closeCmdPalette;
window.initUXEnhancements = initUXEnhancements;
