/**
 * Bridge script - runs in ISOLATED world
 * Handles communication between MAIN world content script and background script
 */

// Listen for messages from the MAIN world content script
window.addEventListener('message', function(event) {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== 'STORY_POC_DOWNLOAD') return;

  var url = event.data.url;
  var filename = event.data.filename;

  // Send to background script for download
  chrome.runtime.sendMessage({
    action: 'download',
    url: url,
    filename: filename
  }, function(response) {
    // Send response back to MAIN world
    window.postMessage({
      type: 'STORY_POC_DOWNLOAD_RESPONSE',
      success: response && response.success,
      filename: filename
    }, '*');
  });
});

console.log('[Story POC Bridge] Ready');
