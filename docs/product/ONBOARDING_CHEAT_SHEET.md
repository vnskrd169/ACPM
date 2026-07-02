# ACPM Onboarding Cheat Sheet

**Para sa:** Bagong user (Project Manager / Associate PM)
**Sistema:** ACPM — Art and Choi Project Management

---

## 🔑 Paano Mag-Login

1. Buksan ang link sa phone o laptop
2. Ilagay ang **username** (hal. `apm1`)
3. Ilagay ang **password**
4. Pindutin **Sign In**

*Tip:* Pwede mo i-save ang password sa browser para next time, auto-fill na.

---

## 🏠 Ang Hub — Lahat ng Projects

Pag-login, makikita mo ang **Hub**. Dito nakalista ang lahat ng projects.

| Tab | Ibig Sabihin |
|-----|-------------|
| **All Projects** | Lahat ng active at completed |
| **Active Projects** | Projects na ginagawa pa |
| **Completed** | Tapos na |

- **Click** ang project card para pumasok sa workspace
- **Search** bar: Hanapin ang project by name

---

## 🏗️ Ang Workspace — Loob ng Project

Pagpasok sa project, may tabs sa taas:

| Tab | Para Saan |
|-----|-----------|
| **Labor** | Attendance, workers, payroll |
| **Materials** | Purchase Orders, inventory, delivery |
| **Billing** | Contract, billing requests, collections |
| **Change Orders** | Dagdag-bawas sa budget |
| **Site Log** | Daily report ng site activities |
| **Suppliers** | Listahan ng suppliers |
| **Tasks** | Gantt chart / Kanban ng tasks |
| **Equipment** | Listahan ng equipment at hours |
| **Compliance** | Permits, renewals, alerts |
| **Defects** | Punch list — mga issues sa site |

---

## 👷 Labor Module (Attendance & Payroll)

### Mark Attendance (Daily)

1. Pumunta sa **Labor** tab
2. Piliin ang **date** (default: today)
3. Piliin ang **trade** (hal. Mason)
4. Click ang status ng bawat worker:
   - 🟢 **Present** — Normal work
   - 🟡 **Half Day** — 4 hours
   - 🔴 **Absent** — Walang pasok
   - 🔵 **Holiday** — Special non-working
   - ⚪ **Rest Day** — Day off
5. Pindutin **Save Attendance**

### Add Overtime (Kung Meron)

1. Sa attendance row, click ang **OT** field
2. Ilagay ang overtime hours (hal. `2`)
3. Pindutin **Save**

### Compile Payroll (Weekly / Every 2 Weeks)

1. Pumunta sa **Labor** tab
2. Piliin ang **date range** (start at end date)
3. Pindutin **Compile Payroll**
4. Review ang summary
5. Pindutin **Save Payroll**
6. Pwede mong i-export as **CSV** o **RFP**

---

## 📦 Materials Module (Purchase Orders)

### Create a Purchase Order (PO)

1. Pumunta sa **Materials** tab
2. Piliin ang **supplier** (o i-type manually)
3. Piliin ang **date**
4. I-type ang item:
   - **Description** (hal. Cement)
   - **Size** (hal. 40kg bag)
   - **Qty** (hal. 50)
   - **Unit** (hal. bags)
   - **Unit Cost** (hal. 280)
5. Pindutin **+ Add Item** (pwede maraming items)
6. Pindutin **Submit PO**

### Track PO Status

| Status | Ibig Sabihin |
|--------|-------------|
| **Pending** | Hinihintay ang approval |
| **Approved** | Pwede na bilhin |
| **Delivered** | Dumating na sa site |
| **Invoiced** | May invoice na |
| **Paid** | Bayad na |

### Record Delivery

1. Sa PO list, pindutin **📦 Record Delivery**
2. Ilagay ang **date delivered**
3. Ilagay ang **quantity received**
4. Pindutin **Confirm**

*Note: Automatic na mag-update ang inventory pag nag-record ka ng delivery.*

---

## 💰 Billing Module

### Contract Setup (Boss Lang)

1. Pumunta sa **Billing** tab
2. Ilagay ang **Contract Amount**
3. Ilagay ang **Client Name**
4. Ilagay ang **Start Date** at **End Date**
5. Pindutin **Save Contract**

### Request Billing

1. Pumunta sa **Billing** tab
2. Pindutin **+ Add Billing Request**
3. Ilagay ang **amount** at **description**
4. Pindutin **Save**

### Record Collection

1. Pumunta sa **Billing** tab
2. Pindutin **+ Add Collection**
3. Ilagay ang **date**, **amount**, at **description**
4. Pindutin **Save**

---

## 📝 Site Log (Daily Report)

1. Pumunta sa **Site Log** tab
2. Piliin ang **date**
3. I-type ang nangyari sa site:
   - Ilang workers ang pumasok
   - Anong materials ang dumating
   - Anong issues o delays
4. Pindutin **Save Log**

*Tip: Gawin ito araw-araw. Para pag nagtanong ang boss, may record.*

---

## ✅ Tasks Module

1. Pumunta sa **Tasks** tab
2. Pindutin **+ Add Task**
3. Ilagay ang **title**, **assigned to**, **due date**, **priority**
4. Pindutin **Save**

**Status:**
- **To Do** — Hindi pa ginagawa
- **In Progress** — Ginagawa na
- **Review** — Tapos na, hinihintay ang check
- **Done** — Completed

---

## 🔔 Notifications

- Sa **header** (top right), may bell icon 🔔
- Click para makita ang mga notifications
- Pindutin **Mark all read** para linisin

---

## ⚠️ Budget Warnings

Makikita mo ang budget status sa project card at sa bawat module:

| Color | Ibig Sabihin |
|-------|-------------|
| 🟢 **Green** | OK — within budget |
| 🟡 **Yellow** | Warning — 80% used |
| 🔴 **Red** | Critical — 95% used |

*Kung red na, mag-submit ng Change Order para humingi ng dagdag budget.*

---

## 💡 Tips

1. **Auto-save** — Hindi mo kailangan mag-save manually. Pag nag-type ka, nag-save na sa Firebase.
2. **Offline mode** — Kung walang internet, pwede ka pa ring mag-log. I-sync na lang pag may net na.
3. **Ctrl+1 to 8** — Shortcut para lumipat ng tabs sa workspace
4. **Weekly backup** — Ask the admin to export data every Monday
5. **Hindi mo makikita ang lahat** — Makikita mo lang ang projects na assigned sa'yo. Normal 'yan.

---

## 🆘 Kung May Problema

| Problema | Gawin |
|----------|-------|
| "You do not have access" | I-message ang admin. Baka hindi ka pa na-assign sa project. |
| Hindi nag-save | Check internet. Hintayin ang "Synced" badge. |
| Mali ang password | Pindutin ang **Forgot password?** sa login screen. |
| Blank screen | Refresh (F5). Clear cache (Ctrl+Shift+R). |
| Hindi maka-login | I-message ang admin. Baka kailangan i-create ang account. |

---

## 📱 Install as App (Para Mas Mabilis)

1. Buksan ang ACPM sa Chrome browser (phone)
2. Pindutin ang **⋮** menu (top right)
3. Pindutin **Add to Home screen**
4. Ngayon, may icon ka na sa home screen — parang real app!

---

*Kung may tanong, i-message ang admin. Hindi ito perfect, pero mas maganda kaysa sa spreadsheet at notebook. Practice lang, kaya mo 'to.*
