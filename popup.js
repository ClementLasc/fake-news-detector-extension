// popup.js
document.addEventListener('DOMContentLoaded', function() {
    const settingsButton = document.querySelector('.settings-button');
    const aboutButton = document.querySelector('.question-mark-button');
    const toggleSwitch = document.querySelector('.toggle-switch');
    const toggleWrapper = document.querySelector('.ellipse-wrapper');
    const statusElement = document.querySelector('.text-wrapper-5');
    const toggleText = document.querySelector('.text-wrapper-4');
    const progressContainer = document.querySelector('.progress-container');
    const progressBar = document.querySelector('.progress-bar');
    let isMonitoring = false;
    let progressInterval;

    settingsButton.addEventListener('click', function() {
        console.log("Settings button clicked");
        // Action à exécuter lorsque le bouton Settings est cliqué
    });

    aboutButton.addEventListener('click', function() {
        console.log("About button clicked");
        // Action à exécuter lorsque le bouton About est cliqué
    });

    // Load initial state
    chrome.storage.local.get("isMonitoring", (result) => {
        isMonitoring = result.isMonitoring || false;
        updateUIState(isMonitoring);
        console.log("Popup opened. Current state from storage:", isMonitoring);
    });

    // Fonction améliorée pour afficher la barre de progression
    function showProgressBar() {
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%'; // Reset progress
        
        let progress = 0;
        // Animation fluide de la barre de progression
        progressInterval = setInterval(() => {
            // Progression non-linéaire pour donner une impression plus naturelle
            // Avance rapidement au début puis ralentit vers la fin
            if (progress < 70) {
                progress += 1.5;
            } else if (progress < 90) {
                progress += 0.5;
            } else if (progress < 95) {
                progress += 0.1;
            }
            
            if (progress > 95) {
                progress = 95; // Ne jamais atteindre 100% avant la fin réelle
            }
            
            progressBar.style.width = progress + '%';
        }, 100);
    }
    
    // Fonction pour compléter et masquer la barre de progression
    function hideProgressBar() {
        clearInterval(progressInterval);
        progressBar.style.width = '100%'; // Compléter la barre
        
        // Attendre que l'animation de complétion soit visible avant de cacher
        setTimeout(() => {
            progressContainer.style.display = 'none';
        }, 500);
    }

    // Toggle switch click handler
    toggleSwitch.addEventListener('click', function() {
        isMonitoring = !isMonitoring;
        
        // Update storage and UI
        chrome.storage.local.set({ isMonitoring }, () => {
            updateUIState(isMonitoring);
            sendToBackground(isMonitoring ? "enableMonitoring" : "disableMonitoring");
            console.log("Monitoring state set to:", isMonitoring);
        });
    });

    // Update UI elements based on state
    function updateUIState(enabled) {
        if (enabled) {
            toggleSwitch.classList.add('active');
            toggleText.textContent = "Disable Monitoring";
        } else {
            toggleSwitch.classList.remove('active');
            toggleText.textContent = "Enable Monitoring";
        }
        statusElement.textContent = `Status: ${enabled ? "Enabled" : "Disabled"}`;
    }

    // Mise à jour de la fonction sendToBackground
    function sendToBackground(action) {
        if (action === 'checkMonitoringAndExecute') {
            showProgressBar(); // Afficher quand l'analyse commence
        }
        chrome.runtime.sendMessage({ action: action }, (response) => {
            console.log(`Response from background.js: ${response.message}`);
            if (action === 'checkMonitoringAndExecute') {
                hideProgressBar(); // Cacher quand l'analyse est terminée
            }
        });
    }

    // Add click handlers for settings and about buttons
    document.querySelector('.settings').addEventListener('click', function() {
        // Handle settings navigation
        console.log('Settings clicked');
    });

    document.querySelector('.question-mark').addEventListener('click', function() {
        // Handle about navigation
        console.log('About clicked');
    });
});