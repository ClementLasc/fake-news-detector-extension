console.log("[Content] Content script injected into:", window.location.href);

// Injecter le CSS dans la page
const link = document.createElement("link");
link.rel = "stylesheet";
link.type = "text/css";
link.href = chrome.runtime.getURL("styles.css");
document.head.appendChild(link);
console.log("[Content Script] CSS link injected");

// Namespace pour éviter les conflits de noms
const appNamespace = "my-extension-";

// Variable pour stocker les surlignages actifs
let activeHighlights = [];

// Fonction pour vérifier si le monitoring est activé
async function isMonitoringEnabled() {
  const result = await chrome.storage.local.get("isMonitoring");
  return result.isMonitoring || false;
}

// Fonction pour notifier le background
async function notifyBackgroundOfInjection() {
  const monitoringEnabled = await isMonitoringEnabled();

  if (!monitoringEnabled) {
    console.warn(
      "[Content Script] Monitoring is disabled, skipping notification to background"
    );
    return;
  }

  chrome.runtime.sendMessage(
    { action: "contentScriptLoaded", url: window.location.href },
    (response) => {
      console.log("[Content] Background acknowledged injection:", response);
    }
  );
}

// Attendre que le DOM soit complètement chargé
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", notifyBackgroundOfInjection);
} else {
  notifyBackgroundOfInjection();
}

// Fonction pour échapper les caractères spéciaux dans le texte pour le regex
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Générer un ID unique pour chaque surlignage
function generateHighlightId() {
  return 'highlight-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

// Stocker les informations sur le segment dans le localStorage
function storeSegmentData(segmentId, segmentData) {
  const storedData = JSON.parse(localStorage.getItem('highlightedSegments') || '{}');
  storedData[segmentId] = segmentData;
  localStorage.setItem('highlightedSegments', JSON.stringify(storedData));
}

// Récupérer les informations sur le segment depuis le localStorage
function getStoredSegmentData(segmentId) {
  const storedData = JSON.parse(localStorage.getItem('highlightedSegments') || '{}');
  return storedData[segmentId];
}

// Fonction optimisée pour trouver et surligner le texte
function highlightText(segment) {
  console.log("[Content Script] Attempting to highlight segment:", segment);

  const escapedText = escapeRegExp(segment.text);
  const regex = new RegExp(`(${escapedText})`, "gi");

  // Function to replace text with highlighted span
  const replaceTextInNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE && regex.test(node.nodeValue)) {
      const fragment = document.createDocumentFragment();
      const parts = node.nodeValue.split(regex);

      parts.forEach((part, index) => {
        if (index % 2 !== 0) { // Odd parts match the regex
          const span = document.createElement("span");
          const highlightId = generateHighlightId();
          span.className = `${appNamespace}highlight`;
          span.dataset.highlightId = highlightId;
          span.textContent = part;

          // Stocker les données du segment
          storeSegmentData(highlightId, segment);
          
          // Ajouter à la liste des surlignages actifs
          activeHighlights.push(highlightId);

          // Add event listeners for displaying segment information
          addHighlightListeners(span, segment);

          fragment.appendChild(span);
          console.log(
            `[Content Script] Created highlight span for text: ${part}`
          );
        } else {
          fragment.appendChild(document.createTextNode(part));
        }
      });

      try {
        node.parentNode.replaceChild(fragment, node);
        console.log(`[Content Script] Successfully replaced node`);
      } catch (error) {
        console.error(`[Content Script] Error replacing node:`, error);
      }
    } else {
      // Recursively traverse child nodes
      for (let i = 0; i < node.childNodes.length; i++) {
        replaceTextInNode(node.childNodes[i]);
      }
    }
  };

  replaceTextInNode(document.body);
}

// Fonction pour ajouter les gestionnaires d'événements pour le surlignage
function addHighlightListeners(span, segment) {
  span.addEventListener("click", (e) => {
    console.log("[Content Script] Click on highlighted text:", segment.text);
    toggleSourceLink(e, segment);
  });
  
  // Nous ne supprimons plus le surlignage au mouseout
  span.addEventListener("mouseover", (e) => {
    addHighlightEffect(e.target);
  });

  span.addEventListener("mouseout", (e) => {
    removeHighlightEffect(e.target);
  });
}

function fadeIn(element) {
  element.style.opacity = 0;
  element.style.display = "block";
  
  let opacity = 0;
  const timer = setInterval(() => {
    if (opacity >= 1) {
      clearInterval(timer);
    }
    element.style.opacity = opacity;
    element.style.filter = 'alpha(opacity=' + opacity * 100 + ")";
    opacity += 0.1;
  }, 20);
}

// Fonction pour afficher/masquer la popup de source
function toggleSourceLink(event, segment) {
  const highlightId = event.target.dataset.highlightId;
  const existingPopup = document.querySelector(`.popup-${highlightId}`);
  
  if (existingPopup) {
    existingPopup.remove();
    return;
  }
  
  showSourceLink(event, segment, highlightId);
}

function showSourceLink(event, segment, highlightId) {
  const popup = document.createElement('div');
  popup.className = 'source-popup popup-' + highlightId;
  popup.dataset.forHighlight = highlightId;
  popup.style.position = 'absolute';

  // Positionnement intelligent
  const boundingRect = event.target.getBoundingClientRect();
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight
  };

  let topPosition = window.pageYOffset + boundingRect.bottom + 10;
  let leftPosition = window.pageXOffset + boundingRect.left;

  // Ajustement si la popup dépasse en bas
  if (topPosition + 200 > window.pageYOffset + viewport.height) {
    topPosition = window.pageYOffset + boundingRect.top - 210;
  }
  // Ajustement si la popup dépasse à droite
  if (leftPosition + 300 > window.pageXOffset + viewport.width) {
    leftPosition = window.pageXOffset + viewport.width - 310;
  }

  popup.style.top = `${topPosition}px`;
  popup.style.left = `${leftPosition}px`;
  popup.style.zIndex = 1000;

  // Conteneur d'information avec statut visuel
  const infoContainer = document.createElement('div');
  const prediction = segment.overall_prediction || 'Unknown';
  const confidence = segment.overall_confidence || 'Unknown';
  const predictionClass = prediction.toLowerCase().includes('fake') ? 'fake' : 'reliable';
  
  // Récupérer l'explication du segment (si disponible)
  const explanation = segment.explanation || "No detailed explanation available for this segment.";
  
  infoContainer.className = 'popup-info';
  infoContainer.innerHTML = `
    <div class="prediction-header ${predictionClass}">
      <span class="prediction-icon">${predictionClass === 'fake' ? '⚠️' : '✓'}</span>
      <span class="prediction-text">${prediction}</span>
    </div>
    
    <div class="explanation-container">
      <h3>Why is this suspicious?</h3>
      <p class="explanation-text">${explanation}</p>
    </div>
    
    <div class="confidence-info">
      <div class="confidence-label">
        <span>Confidence:</span>
        <span class="confidence-value">${confidence}</span>
      </div>
      <div class="confidence-bar">
        <div class="confidence-progress ${predictionClass}" 
             style="width: ${confidence.replace('%', '')}%"></div>
      </div>
    </div>
  `;

  // Bouton source
  const sourceLink = document.createElement('a');
  sourceLink.href = getSourceForSegment(segment);
  sourceLink.target = '_blank';
  sourceLink.textContent = 'View reliable source';
  sourceLink.className = 'source-link';

  // Bouton fermeture
  const closeButton = document.createElement('button');
  closeButton.className = 'close-button';
  closeButton.innerHTML = '×';
  closeButton.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.remove();
  });

  // Construction de la popup
  popup.appendChild(closeButton);
  popup.appendChild(infoContainer);
  popup.appendChild(sourceLink);
  document.body.appendChild(popup);

  popup.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Styles améliorés
  const style = document.createElement('style');
  style.textContent = `
    .source-popup {
      background: white;
      border: none;
      padding: 0;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.1);
      width: 320px;
      max-width: 90vw;
      overflow: hidden;
      font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: popup-slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes popup-slide-up {
      0% { opacity: 0; transform: translateY(10px); }
      100% { opacity: 1; transform: translateY(0); }
    }

    .prediction-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px;
      border-radius: 0;
    }

    .prediction-header.fake {
      background-color: #FEF2F2;
      color: #DC2626;
    }

    .prediction-header.reliable {
      background-color: #ECFDF5;
      color: #059669;
    }

    .prediction-icon {
      font-size: 18px;
    }

    .prediction-text {
      font-weight: 600;
      font-size: 16px;
    }

    .explanation-container {
      padding: 16px;
      background-color: #F9FAFB;
    }

    .explanation-container h3 {
      font-size: 14px;
      font-weight: 600;
      color: #4B5563;
      margin-bottom: 8px;
    }

    .explanation-text {
      font-size: 14px;
      line-height: 1.6;
      color: #4B5563;
    }

    .confidence-info {
      padding: 16px;
      border-top: 1px solid #F3F4F6;
    }

    .confidence-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 14px;
      color: #6B7280;
    }

    .confidence-value {
      font-weight: 600;
      color: #374151;
    }

    .confidence-bar {
      background: #E5E7EB;
      height: 6px;
      border-radius: 3px;
      overflow: hidden;
    }

    .confidence-progress {
      height: 100%;
      transition: width 0.6s ease;
    }

    .confidence-progress.fake {
      background-color: #EF4444;
    }

    .confidence-progress.reliable {
      background-color: #10B981;
    }

    .close-button {
      position: absolute;
      top: 12px;
      right: 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 20px;
      color: #9CA3AF;
      padding: 4px;
      z-index: 2;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: background-color 0.2s;
    }

    .close-button:hover {
      background-color: rgba(0,0,0,0.05);
      color: #4B5563;
    }

    .source-link {
      display: block;
      margin: 0;
      padding: 14px 16px;
      background-color: #2563EB;
      color: white;
      text-decoration: none;
      text-align: center;
      font-weight: 500;
      font-size: 14px;
      transition: background-color 0.2s;
    }

    .source-link:hover {
      background-color: #1D4ED8;
    }
  `;
  document.head.appendChild(style);
}

// Fonction pour supprimer la popup d'un surlignage spécifique
function removePopupForHighlight(highlightId) {
  const popup = document.querySelector(`.popup-${highlightId}`);
  if (popup) {
    popup.remove();
  }
}

// Fonction pour supprimer toutes les popups
function removeAllPopups() {
  const popups = document.querySelectorAll('.source-popup');
  popups.forEach(popup => popup.remove());
}

function getSourceForSegment(segment) {
  // Vérifier si des articles fiables sont disponibles pour ce segment
  if (segment.reliable_articles && segment.reliable_articles.length > 0) {
    // Accéder directement à l'URL car reliable_articles est un tableau de strings
    return segment.reliable_articles[0]; 
  } else {
    return 'https://www.google.com/search?q=' + encodeURIComponent(segment.text);
  }
}

// Fonctions pour ajouter et retirer l'effet de surbrillance
function addHighlightEffect(target) {
  target.style.transition = "all 0.1s ease-in-out";
  target.style.transform = "scale(1.1)";
  target.style.zIndex = "1000";
  target.style.boxShadow = "0 0 8px rgba(0,0,0, 0.8)";
  target.style.backgroundColor = "#ffeb3b";
  target.style.borderRadius = "4px";
}

function removeHighlightEffect(target) {
  target.style.transition = "all 0.1s ease-in-out";
  target.style.transform = "scale(1)";
  target.style.zIndex = "auto";
  target.style.boxShadow = "none";
  target.style.backgroundColor = "yellow";  // Maintient la couleur jaune
  target.style.borderRadius = "2px";        // Maintient l'apparence du surlignage
}

// Fonction pour supprimer tous les surlignages
function removeHighlights() {
  const highlights = document.querySelectorAll(`.${appNamespace}highlight`);
  highlights.forEach((highlight) => {
    const parent = highlight.parentNode;
    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight);
    }
    parent.removeChild(highlight);
  });
  console.log("[Content Script] Removed all highlights");

  // Supprimer les données stockées
  localStorage.removeItem('highlightedSegments');
  activeHighlights = [];
  
  removeAllPopups();
}

// Fonction pour restaurer les surlignages au chargement de la page
function restoreHighlights() {
  const storedData = JSON.parse(localStorage.getItem('highlightedSegments') || '{}');
  
  for (const highlightId in storedData) {
    const segment = storedData[highlightId];
    highlightText(segment);
  }
}

// Appeler la restauration des surlignages au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
  restoreHighlights();
});

// Écouteur de messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[Content Script] Message received:", request);

  if (request.action === "highlightSuspiciousSegments") {
    console.log(
      "[Content Script] Processing highlightSuspiciousSegments action"
    );

    if (request.segments && request.segments.length > 0) {
      console.log("[Content Script] Segments received:", request.segments);
      try {
        // Traiter chaque segment individuellement
        request.segments.forEach(segment => {
          highlightText(segment);
        });

        console.log("[Content Script] All segments processed successfully");
        sendResponse({ status: "success" });
      } catch (error) {
        console.error("[Content Script] Error processing segments:", error);
        sendResponse({ status: "error", message: error.message });
      }
    } else {
      console.log("[Content Script] No segments to highlight.");
      sendResponse({ status: "success", message: "No segments to highlight" });
    }
  } else if (request.action === "removeHighlights") {
    removeHighlights();
    sendResponse({ status: "success" });
  } else {
    console.log("[Content Script] Unknown action received:", request.action);
  }

  return true; // Keep the message channel open for sendResponse
});

// Ajout du style par défaut
const defaultStyle = document.createElement("style");
defaultStyle.textContent = `
  .${appNamespace}highlight {
    background-color: yellow !important;
    padding: 2px !important;
    border-radius: 2px !important;
    cursor: pointer !important;
  }
`;
document.head.appendChild(defaultStyle);
console.log("[Content Script] Default styles injected");

console.log("[Content Script] Content script fully loaded and initialized");