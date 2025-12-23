/**
 * Bridge script - runs in ISOLATED world
 * Handles communication between MAIN world content script and background script
 */

// Listen for messages from the MAIN world content script
window.addEventListener('message', function(event) {
  if (event.source !== window) return;
  if (!event.data || !event.data.type) return;

  // Handle download requests
  if (event.data.type === 'STORY_POC_DOWNLOAD') {
    var url = event.data.url;
    var filename = event.data.filename;

    chrome.runtime.sendMessage({
      action: 'download',
      url: url,
      filename: filename
    }, function(response) {
      window.postMessage({
        type: 'STORY_POC_DOWNLOAD_RESPONSE',
        success: response && response.success,
        filename: filename
      }, '*');
    });
  }

  // Handle html2canvas load request
  if (event.data.type === 'STORY_POC_LOAD_HTML2CANVAS') {
    loadHtml2CanvasIntoPage();
  }
});

// Inject html2canvas into the MAIN world
function loadHtml2CanvasIntoPage() {
  // Check if already loaded
  if (document.getElementById('story-poc-html2canvas')) {
    return;
  }

  var script = document.createElement('script');
  script.id = 'story-poc-html2canvas';
  script.src = chrome.runtime.getURL('html2canvas.min.js');
  script.onload = function() {
    console.log('[Story POC Bridge] html2canvas loaded');
    window.postMessage({ type: 'STORY_POC_HTML2CANVAS_LOADED' }, '*');
  };
  script.onerror = function() {
    console.error('[Story POC Bridge] Failed to load html2canvas');
  };
  (document.head || document.documentElement).appendChild(script);
}

console.log('[Story POC Bridge] Ready');
