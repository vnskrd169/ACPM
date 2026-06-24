# ACPM 30-Day Launch Plan

**Goal:** Propose ACPM to LeBuild company and colleagues by end of month. Get 1-2 pilot users. No spending. No rewrites.

**Current Status:** System works. Needs polish + safety net before people see it.

---

## Week 1: Make It Demo-Safe (Do This Now)

### Day 1 (Monday) — Backup & Rules (30 min)

1. **Export your current data**
   - Firebase Console → Realtime Database → Data tab → ⋮ → Export JSON
   - Save to Google Drive: `ACPM-backup-2024-06-24.json`
   - This is your insurance. Do it before touching rules.

2. **Publish hardened rules**
   - Firebase Console → Realtime Database → Rules
   - Copy contents from `database.rules.json` (updated version in this folder)
   - Click Publish
   - Test: Log in as boss → create a test project → log in as APM → confirm they can only see assigned projects

### Day 2 (Tuesday) — Fix the Scary Delete (15 min)

Open `main.js`. Find `deleteProject()`. Change it to:

```javascript
async function deleteProject(pid) {
  if (!canEditProject(pid)) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  if (!confirm('⚠️ WARNING: This will permanently delete ALL project data.\n\nClick OK to continue.')) return;
  const confirmText = prompt('Type DELETE PROJECT to confirm permanent deletion:');
  if (confirmText !== 'DELETE PROJECT') {
    showToast('Deletion cancelled.', 'warn');
    return;
  }
  await safeDb(() => db.ref(`projects/${pid}`).remove(), 'Failed to delete');
  auditLog('delete', 'project', pid, {});
  showToast('Project and all data deleted', 'warn');
}
```

Do the same for `deleteWorker()`, `deleteTask()`, `deleteEquipment()` — add a typed confirmation or at least a double `confirm()`.

### Day 3 (Wednesday) — Bump the Cache (5 min)

Open `sw.js`. Change:
```javascript
const CACHE_NAME = 'acpm-v6';
```
to:
```javascript
const CACHE_NAME = 'acpm-v7';
```

This forces everyone's browser to load the latest code. If you change anything later, bump to `v8`, `v9`, etc.

### Day 4 (Thursday) — Create Demo Project (45 min)

1. Log in as boss
2. Create a project called: `DEMO: Batangas Warehouse Phase 1`
3. Set labor budget: ₱500,000
4. Set materials budget: ₱300,000
5. Add 3 trades: Mason, Carpenter, Electrician
6. Add 4-5 workers across trades
7. Log attendance for 1 week (mark everyone present Mon-Sat)
8. Go to Materials → create 1 PO (Cement, 50 bags, ₱280/bag) → submit → approve
9. Go to Billing → add contract (Client: SM Development, ₱1,200,000)
10. Go to Tasks → add 3 tasks (Foundation, Walling, Electrical)

**This demo project is your sales tool.** When you show colleagues, they see real data, not empty forms.

### Day 5 (Friday) — Test Everything (30 min)

Log in as each role and test:
- **Boss:** Can see all projects, create, edit, delete, access reports
- **PM:** Can see assigned project(s), edit data, cannot delete project
- **APM:** Can see assigned project(s), edit data, cannot access reports

Use Chrome's Incognito mode to test multiple accounts simultaneously.

---

## Week 2: Make It Presentable

### Day 1-2 — Write the Pitch (1 hour)

Use `COMPANY_PITCH.md` (included in this folder). Customize:
- Company name (LeBuild)
- Current pain points (spreadsheets, lost receipts, delayed payroll)
- Expected savings (time, errors, money)

### Day 3 — Screenshot the Demo (30 min)

Take screenshots of:
1. Login screen (shows it's mobile-ready)
2. Hub dashboard (shows all projects with budget rings)
3. Labor module (shows attendance grid + payroll compilation)
4. Materials module (shows PO with approval workflow)
5. Billing module (shows contract + collection tracking)
6. Tasks module (shows Kanban board)

Save these in a folder. Use them in your presentation.

### Day 4 — Prepare the Pilot (30 min)

Pick **2 colleagues** who are:
- Tech-comfortable (can use a smartphone easily)
- Willing to try new things
- Not your most critical projects (pilot should be low-stakes)

Create their Firebase Auth accounts:
- Email: `pilot1@acpm.local` / `pilot2@acpm.local`
- Password: Give them something simple like `LeBuild2024!`
- In Database: create `/users/{uid}` with role `apm` and assign them to the demo project

### Day 5 — Print the Cheat Sheet (15 min)

Print `ONBOARDING_CHEAT_SHEET.md` (1 page per person). Give it to pilot users.

---

## Week 3: Run the Pilot

### Monday — Pilot Kickoff (15 min per person)

Sit with each pilot user. Show them:
1. How to log in on their phone
2. How to open the demo project
3. How to mark attendance for 1 day
4. How to check their project's budget

Let them play for 10 minutes. Answer questions. Don't hover.

### Tuesday-Thursday — Let Them Use It

Don't interfere. Let them:
- Log attendance for their real project (if they're comfortable)
- Submit a real PO
- Add a real task

Check in daily via chat: *"Kamusta ACPM? May issue?"*

### Friday — Collect Feedback (30 min)

Ask each pilot:
1. Ano ang pinaka-madaling gamitin? (What was easiest?)
2. Ano ang mahirap? (What was hard?)
3. Anong kulang? (What's missing?)
4. Gagamitin mo ba araw-araw? (Would you use it daily?)

Write down their answers. These become your "known issues" list for the proposal.

---

## Week 4: The Proposal

### Monday-Wednesday — Prepare Presentation

Structure (15 minutes max):
1. **Problem** (2 min): *"Ngayon, ang attendance nasa notebook, ang PO nasa Messenger, ang budget nasa Excel. Nawawala, delayed, mali-mali."*
2. **Solution** (3 min): *"ACPM — isang app, nasa phone, real-time, offline pa."*
3. **Demo** (8 min): Show the actual app on your phone/projector. Live demo is powerful.
4. **Pilot Results** (1 min): *"Sinubukan ni [Pilot1] at [Pilot2]. Working daw."*
5. **Ask** (1 min): *"Gusto ko mag-rollout sa buong team. Kailangan ng go-signal."*

### Thursday — Practice (30 min)

Run through the demo 3 times. Make sure:
- The demo project loads fast
- The budget numbers look realistic
- You can navigate between modules smoothly
- The app works on your phone (in case they ask to see it)

### Friday — The Pitch

Bring:
- Your laptop (with the app open)
- Your phone (with the PWA installed — shows it's mobile-ready)
- Printed cheat sheets (1 per person, for future reference)
- The pilot feedback notes (shows you did your homework)

**What to say:**
> *"Hindi ito perfect. May mga kulang pa. Pero ang importante: gumagana, safe ang data, at nasa phone natin. Hindi na tayo maghahanap ng papel o magtatanong sa chat kung anong budget natin. Nandiyan na sa app."*

---

## What NOT to Do This Month

| Don't Do | Why |
|----------|-----|
| Rewrite the code | No time. Current code works. |
| Add new features | Focus on stability, not new modules |
| Migrate to Firestore | Too risky before a demo |
| Add Cloud Functions | Paid plan required. Skip for now. |
| Change the UI design | Waste of time. Dark mode works. |
| Invite more than 2 pilot users | More users = more problems. Keep it small. |

---

## Success Criteria (End of Month)

- [ ] Demo project has realistic data
- [ ] Database rules are hardened and tested
- [ ] 2 pilot users have tried the system
- [ ] You have 5+ screenshots for the presentation
- [ ] Company proposal is delivered
- [ ] You get a "go" or "pilot with more users" decision

---

## If Something Breaks During the Demo

**Don't panic.** Have these ready:

1. **Screenshot folder** on your phone — if the app won't load, show screenshots instead
2. **Offline backup** — if internet dies, show the PWA installed on your phone (it works offline)
3. **Honest answer:** *"Hindi pa perfect. Pero ito ang pinaka-madaling ayusin kaysa mag-start from scratch."*

---

## Next Month (If You Get the "Go")

1. Create real user accounts for all 6 people
2. Migrate 1 active project into the system (manual data entry, sorry)
3. Run training session (1 hour, lunch meeting)
4. Set the Monday backup alarm
5. Collect feedback weekly for 1 month

---

*Kaya mo 'to. The system already works. You just need to make it safe to show and easy to understand. Good luck.*
