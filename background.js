/**
 * Background Service Worker
 * Handles CSP bypass for script injection
 */

// Remove Content-Security-Policy headers to allow our scripts to run
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1, 2],
  addRules: [
    {
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'Content-Security-Policy', operation: 'remove' },
          { header: 'Content-Security-Policy-Report-Only', operation: 'remove' }
        ]
      },
      condition: {
        urlFilter: '*://www.instagram.com/*',
        resourceTypes: ['main_frame', 'sub_frame']
      }
    },
    {
      id: 2,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'Content-Security-Policy', operation: 'remove' }
        ]
      },
      condition: {
        urlFilter: '*://*.cdninstagram.com/*',
        resourceTypes: ['xmlhttprequest', 'media', 'image']
      }
    }
  ]
}).then(() => {
  console.log('[Story POC] CSP rules installed');
}).catch(err => {
  console.error('[Story POC] Failed to install CSP rules:', err);
});

// Listen for messages from content script (for future expansion)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename,
      saveAs: false
    }, (downloadId) => {
      sendResponse({ success: true, downloadId });
    });
    return true;
  }
});

console.log('[Story POC] Background worker ready');
