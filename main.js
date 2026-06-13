// 1. Firebase Setup
const firebaseConfig = {
    apiKey: "AIzaSyAs-YOUR-ACTUAL-API-KEY-HERE",
    authDomain: "acpm-project-management.firebaseapp.com",
    databaseURL: "https://acpm-project-system-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "acpm-project-management",
    storageBucket: "acpm-project-management.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef1234567890"
};


if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }

let currentActiveProjectId = null;

// 2. Navigation: Pag-click ng button sa Dashboard
function enterProjectWorkspace(projectId) {
    currentActiveProjectId = projectId;
    
    // Ipakita ang Workspace (i-hide ang Dashboard)
    document.getElementById('projectHubView').classList.add('hidden');
    document.getElementById('activeWorkspaceView').classList.remove('hidden');
    
    // Dito natin tinatawag ang mga functions mula sa ibang files
    listenToMaterials(); 
    listenToLaborRecords(projectId); 
}

// 3. Project Creation
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
    
    nameInput.value = ''; 
    budgetInput.value = '';
    alert("Project " + name + " created!");
}