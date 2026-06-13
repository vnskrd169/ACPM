async function addMaterialOrder() {
    if (!currentActiveProjectId) return;
    const desc = document.getElementById('matDesc').value.trim();
    const qty = parseFloat(document.getElementById('matQty').value) || 0;
    const unitCost = parseFloat(document.getElementById('matCost').value) || 0;
    
    if (!desc || qty <= 0) { alert("Pakisulat ang wastong description at quantity!"); return; }
    
    const newMaterial = { 
        description: desc, 
        qty: qty, 
        totalCost: qty * unitCost, 
        status: 'ordered', 
        timestamp: Date.now() 
    };
    
    await firebase.database().ref(`projects/${currentActiveProjectId}/materials`).push(newMaterial);
    document.getElementById('matDesc').value = ''; 
    document.getElementById('matQty').value = ''; 
    document.getElementById('matCost').value = '';
}

function listenToMaterials() {
    if (!currentActiveProjectId) return;
    
    firebase.database().ref(`projects/${currentActiveProjectId}/materials`).on('value', async (snap) => {
        let globalSpent = 0;
        const tbody = document.getElementById('materialsTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        snap.forEach(child => {
            const key = child.key;
            const mat = child.val();
            if (mat.status === 'paid' || mat.status === 'delivered') globalSpent += mat.totalCost;
            
            // I-render ang table row...
            tbody.innerHTML += `<tr>
                <td>${mat.description}</td>
                <td>${mat.qty}</td>
                <td>₱${mat.totalCost.toLocaleString()}</td>
                <td><button onclick="updateMatStatus('${key}', 'paid')">Mark Paid</button></td>
            </tr>`;
        });

        await firebase.database().ref(`projects/${currentActiveProjectId}`).update({ totalMaterialSpent: globalSpent });
        if(document.getElementById('matTotalLabel')) {
            document.getElementById('matTotalLabel').innerText = `₱${globalSpent.toLocaleString()}`;
        }
    });
}

function updateMatStatus(key, newStatus) { 
    if (currentActiveProjectId) firebase.database().ref(`projects/${currentActiveProjectId}/materials/${key}`).update({ status: newStatus }); 
}