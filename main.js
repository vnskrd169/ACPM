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
function loadProjectList() {
    const listContainer = document.getElementById('projectListContainer'); // Siguraduhin na may ganito kang ID sa HTML
    
    if (!listContainer) return; // Iwas error kung wala sa page

    firebase.database().ref('projects').on('value', (snapshot) => {
        listContainer.innerHTML = ''; // Linisin muna ang listahan
        
        snapshot.forEach((child) => {
            const projectId = child.key; // Pangalan ng project
            
            // Gumawa ng button para sa bawat project
            const btn = document.createElement('button');
            btn.className = "w-full p-4 mb-2 bg-slate-800 text-white rounded hover:bg-slate-700";
            btn.innerText = `📁 ${projectId}`;
            btn.onclick = () => enterProjectWorkspace(projectId);
            
            listContainer.appendChild(btn);
        });
    });
}

// Tawagin ang function na ito kapag nag-load ang window
window.onload = () => {
    loadProjectList();
};