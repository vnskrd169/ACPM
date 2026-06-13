// main.js
const firebaseConfig = {
    apiKey: "AIzaSyA7xFArtly4jCZZEt34TTmfNfK94RoWMaA",
    authDomain: "acpm-project-system.firebaseapp.com",
    databaseURL: "https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "acpm-project-system",
    storageBucket: "acpm-project-system.firebasestorage.app",
    messagingSenderId: "330800177544",
    appId: "1:330800177544:web:8f29dcd81ca39976849a3d"
};

if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }

let currentActiveProjectId = null;

async function createNewProjectSite() {
    const nameInput = document.getElementById('newProjectName');
    const budgetInput = document.getElementById('newProjectBudget');
    const name = nameInput.value.trim();
    const budget = parseFloat(budgetInput.value) || 0;

    if (!name || budget <= 0) {
        alert("Fill the Name and assigned budget");
        return;
    }
    
    await firebase.database().ref(`projects/${name}`).set({
        allottedLaborBudget: budget,
        totalLaborSpent: 0,
        totalMaterialSpent: 0,
        timestamp: Date.now()
    });
    alert("Project " + name + " initialized!");
    nameInput.value = ''; 
    budgetInput.value = '';
}

function enterProjectWorkspace(projectId) {
    currentActiveProjectId = projectId;
    document.getElementById('projectHubView').classList.add('hidden');
    document.getElementById('activeWorkspaceView').classList.remove('hidden');
    
    // Simulan ang listeners
    listenToMaterials();
    listenToLaborRecords(projectId);
}