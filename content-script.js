/**
 * Story Downloader POC - XHR/Fetch Interception Only
 * Captures story data without breaking Instagram
 */

(function() {
  'use strict';

  if (window.__storyDownloaderPOC) return;
  window.__storyDownloaderPOC = true;

  // Storage for captured story data
  window.__capturedStories = {};

  console.log('[Story POC] Initializing...');

  // ============================================================
  // TECHNIQUE 1: Intercept fetch for story data
  // ============================================================

  var originalFetch = window.fetch;
  window.fetch = async function(url, options) {
    var response = await originalFetch.apply(this, arguments);

    try {
      var urlStr = typeof url === 'string' ? url : url.toString();

      // Intercept story-related API calls
      if (urlStr.indexOf('graphql') !== -1 ||
          urlStr.indexOf('api/v1/feed/reels_media') !== -1 ||
          urlStr.indexOf('api/v1/feed/user') !== -1) {
        var clone = response.clone();
        clone.text().then(function(text) {
          try {
            var data = JSON.parse(text);
            extractStoriesFromResponse(data);
          } catch(e) {}
        }).catch(function() {});
      }
    } catch(e) {}

    return response;
  };

  // ============================================================
  // TECHNIQUE 2: Intercept XHR for story data
  // ============================================================

  var originalXHROpen = XMLHttpRequest.prototype.open;
  var originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._storyPocUrl = url;
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    var xhr = this;
    var url = this._storyPocUrl || '';

    if (url.indexOf('graphql') !== -1 ||
        url.indexOf('api/v1/feed/reels_media') !== -1 ||
        url.indexOf('api/v1/feed/user') !== -1) {

      this.addEventListener('load', function() {
        try {
          if (xhr.responseText) {
            var data = JSON.parse(xhr.responseText);
            extractStoriesFromResponse(data);
          }
        } catch(e) {}
      });
    }

    return originalXHRSend.apply(this, arguments);
  };

  // ============================================================
  // TECHNIQUE 3: Extract story URLs from API responses
  // ============================================================

  function extractStoriesFromResponse(data, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 20 || !data) return;

    if (Array.isArray(data)) {
      for (var i = 0; i < data.length; i++) {
        extractStoriesFromResponse(data[i], depth + 1);
      }
      return;
    }

    if (typeof data !== 'object') return;

    // Handle story tray/feed responses
    if (data.reels_media && Array.isArray(data.reels_media)) {
      for (var j = 0; j < data.reels_media.length; j++) {
        var reel = data.reels_media[j];
        if (reel.items) {
          for (var k = 0; k < reel.items.length; k++) {
            processStoryItem(reel.items[k], reel.user);
          }
        }
      }
    }

    // Handle individual story items
    if (data.items && Array.isArray(data.items)) {
      var user = data.user || null;
      for (var m = 0; m < data.items.length; m++) {
        processStoryItem(data.items[m], user);
      }
    }

    // Direct story item check
    var isStoryItem = data.video_versions || data.image_versions2;
    if (isStoryItem && (data.id || data.pk)) {
      processStoryItem(data, data.user);
    }

    // Recurse into nested objects
    for (var key in data) {
      if (data.hasOwnProperty(key) && typeof data[key] === 'object') {
        extractStoriesFromResponse(data[key], depth + 1);
      }
    }
  }

  function processStoryItem(item, user) {
    if (!item) return;

    var storyId = item.id || item.pk;
    if (!storyId) return;

    var username = (item.user && item.user.username) ||
                   (user && user.username) ||
                   extractUsernameFromURL();

    if (window.__capturedStories[storyId]) return;

    var storyData = {
      id: String(storyId),
      username: username,
      takenAt: item.taken_at,
      expiringAt: item.expiring_at,
      mediaType: item.media_type || 1,
      videoUrl: null,
      imageUrl: null,
      thumbnailUrl: null
    };

    // Extract video URL (highest quality)
    if (item.video_versions && item.video_versions.length > 0) {
      storyData.videoUrl = item.video_versions[0].url;
      storyData.mediaType = 2;
    }

    // Extract image URL (highest quality)
    if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length > 0) {
      storyData.imageUrl = item.image_versions2.candidates[0].url;
      storyData.thumbnailUrl = item.image_versions2.candidates[0].url;
      if (!storyData.mediaType) storyData.mediaType = 1;
    }

    if (storyData.videoUrl || storyData.imageUrl) {
      window.__capturedStories[storyId] = storyData;
      console.log('[Story POC] Captured:', username, storyId, storyData.mediaType === 2 ? 'video' : 'image');
      updateButtonBadge();
    }
  }

  function extractUsernameFromURL() {
    var match = window.location.pathname.match(/\/stories\/([^\/]+)/);
    return match ? match[1] : 'unknown';
  }

  // ============================================================
  // TECHNIQUE 4: Download button with badge
  // ============================================================

  function createDownloadButton() {
    var btn = document.createElement('div');
    btn.id = 'story-poc-download-btn';
    btn.innerHTML = '<span style="font-size:24px;">&#x2B07;</span>';
    btn.title = 'Download All Stories (POC)';
    btn.style.cssText = 'position:fixed;bottom:100px;right:30px;width:48px;height:48px;' +
      'background:linear-gradient(135deg,#833AB4,#FD1D1D,#F77737);border-radius:50%;' +
      'display:flex;align-items:center;justify-content:center;cursor:pointer;' +
      'z-index:999999;box-shadow:0 4px 15px rgba(0,0,0,0.3);transition:transform 0.2s;user-select:none;';

    // Badge for count
    var badge = document.createElement('div');
    badge.id = 'story-poc-badge';
    badge.style.cssText = 'position:absolute;top:-5px;right:-5px;background:#0095f6;' +
      'color:white;border-radius:50%;min-width:20px;height:20px;font-size:12px;' +
      'display:flex;align-items:center;justify-content:center;font-weight:bold;';
    badge.textContent = '0';
    btn.appendChild(badge);

    btn.onmouseenter = function() { btn.style.transform = 'scale(1.1)'; };
    btn.onmouseleave = function() { btn.style.transform = 'scale(1)'; };
    btn.onclick = showDownloadModal;

    return btn;
  }

  function updateButtonBadge() {
    var badge = document.getElementById('story-poc-badge');
    if (badge) {
      var count = Object.keys(window.__capturedStories).length;
      badge.textContent = String(count);
    }
  }

  // ============================================================
  // TECHNIQUE 5: Download modal
  // ============================================================

  function showDownloadModal() {
    var existing = document.getElementById('story-poc-modal');
    if (existing) existing.remove();

    var username = extractUsernameFromURL();
    var allStories = Object.values(window.__capturedStories);
    var stories = allStories.filter(function(s) {
      return s.username === username || username === 'unknown' || allStories.length < 20;
    });

    if (stories.length === 0) {
      alert('No stories captured yet. The extension captures story data as Instagram loads it.\n\nTry:\n1. Refresh the page\n2. Click through some stories\n3. Check again');
      return;
    }

    var modal = document.createElement('div');
    modal.id = 'story-poc-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.9);z-index:9999999;display:flex;flex-direction:column;' +
      'align-items:center;padding:20px;box-sizing:border-box;overflow-y:auto;';

    var header = document.createElement('div');
    header.style.cssText = 'width:100%;max-width:900px;display:flex;justify-content:space-between;' +
      'align-items:center;margin-bottom:20px;color:white;flex-wrap:wrap;gap:10px;';

    var title = document.createElement('div');
    title.innerHTML = '<span style="font-size:18px;font-weight:bold;">Story Downloader POC</span>' +
      '<span style="font-size:14px;opacity:0.7;margin-left:10px;">' + stories.length + ' stories</span>';

    var buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:10px;';

    var downloadBtn = document.createElement('button');
    downloadBtn.id = 'poc-download-all';
    downloadBtn.textContent = 'Download All (' + stories.length + ')';
    downloadBtn.style.cssText = 'padding:10px 20px;background:#0095f6;color:white;border:none;' +
      'border-radius:8px;cursor:pointer;font-size:14px;font-weight:bold;';

    var closeBtn = document.createElement('button');
    closeBtn.id = 'poc-close-modal';
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding:10px 20px;background:#333;color:white;border:none;' +
      'border-radius:8px;cursor:pointer;font-size:14px;';

    buttons.appendChild(downloadBtn);
    buttons.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(buttons);

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));' +
      'gap:10px;width:100%;max-width:900px;';

    stories.forEach(function(story, index) {
      var item = document.createElement('div');
      item.style.cssText = 'position:relative;aspect-ratio:9/16;background:#222;' +
        'border-radius:8px;overflow:hidden;cursor:pointer;';

      var thumb = story.thumbnailUrl || story.imageUrl;
      if (thumb) {
        var img = document.createElement('img');
        img.src = thumb;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        img.onerror = function() { this.style.display = 'none'; };
        item.appendChild(img);
      }

      var typeIcon = document.createElement('div');
      typeIcon.style.cssText = 'position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.6);' +
        'padding:4px 8px;border-radius:4px;color:white;font-size:12px;';
      typeIcon.textContent = story.mediaType === 2 ? 'Video' : 'Image';
      item.appendChild(typeIcon);

      var indexLabel = document.createElement('div');
      indexLabel.style.cssText = 'position:absolute;bottom:8px;left:8px;background:rgba(0,0,0,0.6);' +
        'padding:4px 8px;border-radius:4px;color:white;font-size:12px;';
      indexLabel.textContent = '#' + (index + 1);
      item.appendChild(indexLabel);

      item.onclick = function() { downloadStory(story, index); };
      grid.appendChild(item);
    });

    modal.appendChild(header);
    modal.appendChild(grid);
    document.body.appendChild(modal);

    closeBtn.onclick = function() { modal.remove(); };
    downloadBtn.onclick = function() { downloadAllStories(stories); };

    document.addEventListener('keydown', function handleEscape(e) {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    });
  }

  // ============================================================
  // TECHNIQUE 6: Download functions
  // ============================================================

  function downloadStory(story, index) {
    var url = story.videoUrl || story.imageUrl;
    if (!url) return Promise.resolve();

    var ext = story.mediaType === 2 ? 'mp4' : 'jpg';

    // Format: {username}_story_{YYYYMMDD}_{HHMMSS}_{shortcode}_raw.{ext}
    var date = new Date(story.takenAt * 1000);
    var dateStr = date.getFullYear() +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0');
    var timeStr = String(date.getHours()).padStart(2, '0') +
      String(date.getMinutes()).padStart(2, '0') +
      String(date.getSeconds()).padStart(2, '0');
    var shortcode = story.id.split('_')[0];
    var filename = story.username + '_story_' + dateStr + '_' + timeStr + '_' + shortcode + '_raw.' + ext;

    console.log('[Story POC] Downloading:', filename);

    // Send to bridge script (ISOLATED world) via postMessage
    return new Promise(function(resolve) {
      window.postMessage({
        type: 'STORY_POC_DOWNLOAD',
        url: url,
        filename: filename
      }, '*');

      // Resolve after a short delay (download is async)
      setTimeout(resolve, 100);
    });
  }

  function downloadAllStories(stories) {
    var btn = document.getElementById('poc-download-all');
    var originalText = btn.textContent;
    var index = 0;

    function downloadNext() {
      if (index >= stories.length) {
        btn.textContent = 'Done!';
        setTimeout(function() { btn.textContent = originalText; }, 2000);
        return;
      }

      btn.textContent = 'Downloading ' + (index + 1) + '/' + stories.length + '...';
      downloadStory(stories[index], index).then(function() {
        index++;
        setTimeout(downloadNext, 300);
      });
    }

    downloadNext();
  }

  // ============================================================
  // TECHNIQUE 7: Watch for story page navigation
  // ============================================================

  function checkAndAddButton() {
    var isStoryPage = window.location.pathname.indexOf('/stories/') !== -1;
    var existingBtn = document.getElementById('story-poc-download-btn');

    if (isStoryPage && !existingBtn) {
      document.body.appendChild(createDownloadButton());
      console.log('[Story POC] Download button added');
    } else if (!isStoryPage && existingBtn) {
      existingBtn.remove();
    }

    updateButtonBadge();
  }

  // Initial setup
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndAddButton);
  } else {
    checkAndAddButton();
  }

  // Watch for SPA navigation
  var lastUrl = location.href;
  new MutationObserver(function() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(checkAndAddButton, 500);
    }
  }).observe(document, { subtree: true, childList: true });

  // Periodic check
  setInterval(checkAndAddButton, 2000);

  console.log('[Story POC] Ready! Navigate to a story page to see the download button.');

})();
