function listenToLaborRecords(projectId) {
    // 1. History Tab (Dito ito lalabas)
    firebase.database().ref(`projects/${projectId}/payrollHistory`).on('value', (snap) => {
        const historyContainer = document.getElementById('historyTableBody');
        if (!historyContainer) return;
        historyContainer.innerHTML = '';
        
        snap.forEach(child => {
            const entry = child.val();
            historyContainer.innerHTML += `<tr><td>${entry.date}</td><td>₱${entry.amount.toLocaleString()}</td></tr>`;
        });
    });
}

async function compileTimecardPayouts() {
    if (!currentActiveProjectId) return;
    const totalAmount = 5000; // Ilagay ang dynamic computation mo dito
    await firebase.database().ref(`projects/${currentActiveProjectId}/payrollHistory`).push({
        date: new Date().toLocaleDateString(),
        amount: totalAmount
    });
    alert("Payroll compiled and saved!");
}