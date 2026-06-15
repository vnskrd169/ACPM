# ACPM (Art and Choi Project Management)

[![GitHub license](https://img.shields.io/github/license/username/acpm?style=flat-square)](https://github.com/username/acpm/blob/main/LICENSE)
[![GitHub version](https://img.shields.io/badge/version-1.0.0-blue?style=flat-square)](https://github.com/username/acpm)

ACPM is a mobile-first Progressive Web App (PWA) designed for real-time construction project management. It streamlines site operations by automating labor tracking, material procurement, and budget monitoring.

## 🏗️ System Architecture
The application leverages Firebase for real-time synchronization between the field and the office.



## 🚀 Key Features
* **Project Dashboard**: Real-time KPI monitoring (Labor vs. Material budget).
* **Procurement Hub**: End-to-end Purchase Order (PO) tracking.
* **Labor & Payroll**: Automated timecard logging and RFP generation.
* **Budget Engine**: Dynamic financial adjustments via Change Order workflows.

## 📦 Project Structure
```text
/
├── index.html          # Application Shell
├── style.css           # Global Themes
├── main.js             # Firebase Core & Global Navigation
├── labor.js            # Payroll & Attendance Modules
├── materials.js        # Procurement & Inventory Logic
├── changeorders.js     # CO Budget Engine
└── sw.js               # Service Worker for Offline Capabilities
