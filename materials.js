// materials.js
function listenToMaterials() {
    if (!currentActiveProjectId) return;
    
    firebase.database().ref(`projects/${currentActiveProjectId}/materials`).on('value', async (snap) => {
        let globalSpent = 0;
        const tbody = document.getElementById('materialsTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        snap.forEach(child => {
            const mat = child.val();
            if (mat.status === 'paid' || mat.status === 'delivered') globalSpent += mat.totalCost;
            
            // I-render ang row sa table...
        });

        await firebase.database().ref(`projects/${currentActiveProjectId}`).update({ totalMaterialSpent: globalSpent });
        if(document.getElementById('matTotalLabel')) document.getElementById('matTotalLabel').innerText = `₱${globalSpent.toLocaleString()}`;
    });
}