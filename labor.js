// labor.js
function listenToLaborRecords(projectId) {
    // 1. Load Roster & Timecard Grid
    firebase.database().ref(`projects/${projectId}/roster`).on('value', (snap) => {
        const container = document.getElementById('timecardGridContainer');
        if (!container) return;
        container.innerHTML = '';
        
        snap.forEach(child => {
            const workerId = child.key;
            const worker = child.val();
            // ... (I-render dito yung timecard card mo)
        });
    });

    // 2. Load History Tab
    firebase.database().ref(`projects/${projectId}/payrollHistory`).on('value', (snap) => {
        const historyContainer = document.getElementById('historyTableBody');
        if (!historyContainer) return;
        historyContainer.innerHTML = '';
        
        snap.forEach(child => {
            const entry = child.val();
            historyContainer.innerHTML += `<tr><td class="p-4">${entry.date}</td><td class="p-4">₱${entry.amount.toLocaleString()}</td></tr>`;
        });
    });
}

async function compileTimecardPayouts() {
    if (!currentActiveProjectId) return;
    // Dito ang logic para sa computation ng total
    const totalAmount = 5000; // Ilagay ang iyong dynamic calculation dito
    
    await firebase.database().ref(`projects/${currentActiveProjectId}/payrollHistory`).push({
        date: new Date().toLocaleDateString(),
        amount: totalAmount
    });
    alert("Payroll compiled and saved!");
}