// labor.js
function listenToLaborRecords(projectId) {
    // Load Roster
    firebase.database().ref(`projects/${projectId}/roster`).on('value', (snap) => {
        // I-render ang timecards dito...
    });

    // Load History Tab (Dito ito lalabas)
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
    // Compute total (dito yung computation logic mo)
    const totalAmount = 5000; // Halimbawa
    await firebase.database().ref(`projects/${currentActiveProjectId}/payrollHistory`).push({
        date: new Date().toLocaleDateString(),
        amount: totalAmount
    });
    alert("Payroll compiled and saved!");
}