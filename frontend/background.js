function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    })
    .then(() => {
      console.log("[Background] Content script injection successful");
      resolve();
    })
    .catch((err) => {
      console.error("[Background] Content script injection failed:", err);
      reject(err);
    });
  });
}

async function checkMonitoringAndExecute(sendResponse) {
  try {
    // Vérifier l'état de monitoring
    const { isMonitoring } = await chrome.storage.local.get("isMonitoring") || {};
    console.log("[Background] Current monitoring state:", isMonitoring);

    if (!isMonitoring) {
      console.warn("[Background] Monitoring is disabled");
      if (sendResponse) sendResponse({ status: "error", message: "Monitoring is disabled." });
      return;
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!activeTab?.url ||
        activeTab.url.startsWith("chrome://") ||
        activeTab.url.startsWith("chrome-extension://")) {
      console.warn("[Background] Cannot execute on restricted URL");
      if (sendResponse) sendResponse({ status: "error", message: "Restricted URL." });
      return;
    }

    console.log("[Background] Sending request to Python server for URL:", activeTab.url);

    // Injecter le content script dans l'onglet actif
    await injectContentScript(activeTab.id);
    chrome.runtime.sendMessage({ action: "showProgressBar" });

    // Effectuer la requête au serveur Python
    const response = await fetch("http://127.0.0.1:5000/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: activeTab.url }),
      mode: "cors",
    });

    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const data = await response.json();
    console.log("[Background] Server response received:", data);
    
    chrome.runtime.sendMessage({ action: "hideProgressBar" });

    // Vérifier le format des segments retournés
    if (!Array.isArray(data.suspicious_segments)) {
      throw new Error("Invalid segments format received");
    }

    // Attendre un court délai pour garantir que le content script est prêt
    await new Promise(resolve => setTimeout(resolve, 100));

    console.log("[Background] Sending message to content script in tab:", activeTab.id);

    await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
          activeTab.id,
          {
            action: "highlightSuspiciousSegments",
            segments: (data.suspicious_segments || []).map(segment => ({
                    ...segment,
                    overall_prediction: data.overall_prediction,
                    overall_confidence: data.overall_confidence,
                    reliable_articles: segment.reliable_articles,
                    explanation: segment.explanation
            })),
  
          },
          (response) => {
              if (chrome.runtime.lastError) {
                  reject(chrome.runtime.lastError);
              } else {
                  resolve(response);
              }
          }
      );
    });

    // Stocker l'URL analysée et la date de l'analyse
    await storeAnalyzedPage(activeTab.url, data);

    // Réponse réussie
    if (sendResponse) {
      sendResponse({
        status: "success",
        message: "Request processed successfully",
        data: data,
      });
    }
  } catch (error) {
    console.error("[Background] Error in processing:", error);
    if (sendResponse) {
      sendResponse({ status: "error", message: error.message });
    }
  }
}

// Stocker les informations d'analyse pour une URL
async function storeAnalyzedPage(url, data) {
  const analyzedPages = await chrome.storage.local.get("analyzedPages") || { analyzedPages: {} };
  
  // Stocker les données d'analyse avec l'horodatage
  analyzedPages.analyzedPages[url] = {
    timestamp: Date.now(),
    data: data
  };
  
  await chrome.storage.local.set({ analyzedPages: analyzedPages.analyzedPages });
  console.log("[Background] Stored analysis data for URL:", url);
}

// Fonction pour désactiver la surveillance sans supprimer les surlignages
async function disableMonitoringOnly() {
  console.log("[Background] Action: disableMonitoring (keeping highlights)");
  await chrome.storage.local.set({ isMonitoring: false });
  console.log("[Background] Monitoring disabled but highlights preserved.");
}

// Fonction pour désactiver la surveillance et mettre à jour les onglets
async function disableMonitoringAndNotifyTabs() {
  console.log("[Background] Action: disableMonitoring and remove highlights");
  await chrome.storage.local.set({ isMonitoring: false });
  console.log("[Background] Monitoring disabled.");

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "removeHighlights" });
    } catch (error) {
      console.log(`[Background] Tab ${tab.id} might not have the content script:`, error);
    }
  }
}

// Gestionnaire de messages avec gestion asynchrone
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[Background] Message received:", request);

  const actions = {
    enableMonitoring: async () => {
      console.log("[Background] Action: enableMonitoring");
      await chrome.storage.local.set({ isMonitoring: true });
      console.log("[Background] Monitoring enabled.");
      checkMonitoringAndExecute(); // Lancer immédiatement après activation
      sendResponse({ message: "Monitoring enabled." });
    },

    disableMonitoring: async () => {
      // Utiliser la fonction qui supprime les surlignages
      await disableMonitoringAndNotifyTabs();
      sendResponse({ message: "Monitoring disabled and highlights removed." });
    },
    
    disableMonitoringOnly: async () => {
      // Nouvelle action qui désactive seulement le monitoring sans supprimer les surlignages
      await disableMonitoringOnly();
      sendResponse({ message: "Monitoring disabled but highlights preserved." });
    },

    checkMonitoringAndExecute: async () => {
      await checkMonitoringAndExecute(sendResponse);
    },

    contentScriptLoaded: async () => {
        const { isMonitoring } = await chrome.storage.local.get("isMonitoring") || {};
        if (!isMonitoring) {
            console.warn("[Background] Content script loaded ignored because monitoring is disabled");
            sendResponse({ status: "error", message: "Monitoring is disabled." });
            return;
        }

        console.log("[Background] Content script loaded notification received");
        sendResponse({ status: "acknowledged" });
    },

    default: () => {
      console.log("[Background] Unknown action:", request.action);
      sendResponse({ message: "Unknown action." });
    },
  };

  const action = actions[request.action] || actions.default;
  action();
  return true; // Indique que la réponse sera envoyée de manière asynchrone
});

// Écouteur d'événement pour le changement d'onglet actif
chrome.tabs.onActivated.addListener(activeInfo => {
  console.log("[Background] Tab activated:", activeInfo.tabId);
  // Ne pas supprimer les surlignages lors du changement d'onglet
  disableMonitoringOnly(); // Utiliser la version qui conserve les surlignages
});

// Écouteur d'événement pour la mise à jour des onglets
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log("[Background] Tab updated:", tabId);
    checkMonitoringAndExecute();
  }
});

console.log("[Background] Background script initialized");