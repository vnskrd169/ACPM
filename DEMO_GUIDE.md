# ACPM Demo Guide

**For:** Presenting ACPM to LeBuild colleagues and management
**Duration:** 8-10 minutes live demo
**Device:** Phone + Laptop (or phone only if no projector)

---

## Before the Demo (Checklist)

- [ ] Log in as **boss** on your laptop
- [ ] Open the demo project: `DEMO: Batangas Warehouse Phase 1`
- [ ] Confirm all modules load (Labor, Materials, Billing, Tasks, etc.)
- [ ] Open the app on your phone (show it's a PWA)
- [ ] Turn off notifications on your phone (no distractions)
- [ ] Have backup screenshots ready in a folder
- [ ] Clear browser cache if you changed anything recently (Ctrl+Shift+R)

---

## Demo Script (8 Minutes)

### 1. Open & Login (30 seconds)

**Say:** *"Ito ang ACPM. Hindi kailangan i-install. Pumunta lang sa link, lagay username at password, ready na."*

**Do:**
1. Open the app URL
2. Log in as boss
3. Show the Hub loading with project cards

**Highlight:** Works on any phone. Works offline too.

---

### 2. The Hub — All Projects at a Glance (1 minute)

**Say:** *"Dito makikita lahat ng projects. Active, completed, at yung budget status. Hindi na kailangan magtanong sa accounting kung magkano na nagastos."*

**Do:**
1. Point to the project card with the budget ring
2. Show the "Total Budget" vs "Spent" numbers
3. Click the **All Projects** tab to show multiple projects
4. Click back to **Active Projects**

**Highlight:** Visual budget ring shows health (green = good, red = danger).

---

### 3. Open a Project — The Workspace (30 seconds)

**Say:** *"Pag-click ng project, pumasok ka sa workspace. Lahat ng data ng project nandito."*

**Do:**
1. Click "Open Workspace" on the demo project
2. Show the tab bar: Labor, Materials, Billing, Tasks, etc.

**Highlight:** Everything is in one place. No more jumping between Excel, Messenger, and notebooks.

---

### 4. Labor Module — Attendance & Payroll (2 minutes)

**Say:** *"Ito ang labor. Nakikita mo kung sino ang present, absent, half-day. Tapos pag Friday, i-compile mo lang ang payroll, automatic na ang computation."*

**Do:**
1. Switch to **Labor** tab
2. Show the trade chips (Mason, Carpenter, Electrician)
3. Show the worker list
4. Show the attendance grid (pre-filled demo data)
5. Click **Compile Payroll** to show the payroll summary
6. Mention: *"Pwedeng i-export as CSV o RFP."*

**Highlight:** No more manual computation. No more lost timecards.

---

### 5. Materials — PO & Approval (2 minutes)

**Say:** *"Pag bumili ng materials, gumawa ng Purchase Order dito. May approval process. Hindi na tayo maghahanap sa Messenger kung approved na."*

**Do:**
1. Switch to **Materials** tab
2. Show the PO history (pre-submitted demo PO)
3. Show the budget KPI at top (Budget, Spent, Left)
4. Show the inventory list
5. Show the ledger

**Highlight:** Every PO is tracked. Every delivery is recorded. Inventory is automatic.

---

### 6. Billing — Contract & Collections (1 minute)

**Say:** *"Dito ang contract at billing. Alam mo kung magkano ang na-collect, magkano ang pending, at kailan ang next billing."*

**Do:**
1. Switch to **Billing** tab
2. Show the contract dashboard (pre-filled demo contract)
3. Show the billing requests table
4. Show the collections table

**Highlight:** No more "Hindi pa bayad si client?" confusion.

---

### 7. Tasks — Kanban Board (1 minute)

**Say:** *"Ang tasks, para alam ng bawat isa kung anong gagawin. Hindi na tatanong sa chat kung 'tapos na ba?'"*

**Do:**
1. Switch to **Tasks** tab
2. Show the Kanban columns (To Do, In Progress, Review, Done)
3. Drag a task from To Do to In Progress (if demo data supports it)
4. Show overdue task highlighting (if any)

**Highlight:** Everyone knows what to do. Deadlines are visible.

---

### 8. Reports — Boss View (30 seconds)

**Say:** *"Pag boss ka, may reports tab. Makikita mo ang overview ng lahat."*

**Do:**
1. Switch to **Reports** tab (if available)
2. Show summary charts or export buttons

**Highlight:** Management gets visibility without asking for updates.

---

### 9. Mobile — PWA Install (30 seconds)

**Say:** *"At ang pinaka-importante: nasa phone mo. Hindi mo kailangan buksan ang laptop sa construction site."*

**Do:**
1. Show the app on your phone
2. Open the same project
3. Show it's the same data

**Highlight:** Field-ready. Site manager logs attendance on their phone.

---

## Common Questions & Answers

**Q: "Magkano?"**
A: *"Ngayon, libre. Firebase free plan. Pag lumaki, baka $5-10/month lang. Mas mura kaysa sa isang maling billing."*

**Q: "Safe ba ang data?"**
A: *"Firebase ang nagho-host. Same company na nagho-host ng Google. May login, may role-based access, at nire-record kung sino ang gumawa ng changes."*

**Q: "Mahirap ba gamitin?"**
A: *"Kung marunong kang mag-Facebook, kaya mo 'to. Tingin lang sa demo, 10 minutes lang natutunan."*

**Q: "Ano kung walang internet?"**
A: *"Naka-cache sa phone. Pwedeng mag-log ng attendance offline, tapos i-sync pag may internet na."*

**Q: "Pwedeng mag-add ng pictures?"**
A: *"Hindi pa ngayon. Pero pwedeng i-implement in the future."* (Be honest.)

---

## If the Demo Breaks

| Problem | Fix |
|---------|-----|
| App won't load | Show screenshots on your phone |
| Data is empty | You forgot to create the demo project. Do it now. |
| Slow loading | Say: *"First time load lang. Pag naka-cache, mabilis na."* |
| Permission error | Check if you're logged in as boss |
| Someone asks a feature you don't have | Say: *"Good idea. Ilalagay sa future update."* |

---

## After the Demo

1. Ask: *"May tanong pa ba?"*
2. Give them the cheat sheet (`ONBOARDING_CHEAT_SHEET.md`)
3. Send them the app link
4. Create their account if they want to try
5. Follow up in 3 days: *"Nag-try mo na?"*

---

## Demo Data Checklist (Before Every Demo)

Make sure these have data:
- [ ] Demo project exists with budget
- [ ] 3+ trades exist
- [ ] 4+ workers exist
- [ ] 1 week of attendance is logged
- [ ] 1 PO is submitted and approved
- [ ] 1 contract exists in billing
- [ ] 3+ tasks exist in Kanban
- [ ] Boss account works
- [ ] APM account works (test in incognito)

---

*Remember: You're not selling perfection. You're selling "better than spreadsheets." Keep it simple. Keep it honest. Good luck.*
