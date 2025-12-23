/**
 * Story Downloader POC - With UI Capture Support
 * Downloads stories as raw files or with Instagram UI overlay
 */

(function() {
  'use strict';

  if (window.__storyDownloaderPOC) return;
  window.__storyDownloaderPOC = true;

  // Storage for captured story data
  window.__capturedStories = {};

  // Download format preference
  window.__downloadFormat = 'both'; // 'raw', 'ui', 'both'
  window.__videoUIFormat = 'screenshot'; // 'screenshot', 'recording'

  console.log('[Story POC] Initializing...');

  // ============================================================
  // TECHNIQUE 1: Load html2canvas for UI capture
  // ============================================================

  var html2canvasLoaded = false;

  function loadHtml2Canvas() {
    return new Promise(function(resolve) {
      if (window.html2canvas) {
        html2canvasLoaded = true;
        resolve();
        return;
      }

      // Request html2canvas from bridge script
      window.postMessage({ type: 'STORY_POC_LOAD_HTML2CANVAS' }, '*');

      // Check periodically if it's loaded
      var checkCount = 0;
      var checkInterval = setInterval(function() {
        if (window.html2canvas || checkCount > 50) {
          clearInterval(checkInterval);
          html2canvasLoaded = !!window.html2canvas;
          resolve();
        }
        checkCount++;
      }, 100);
    });
  }

  // ============================================================
  // TECHNIQUE 2: Intercept fetch for story data
  // ============================================================

  var originalFetch = window.fetch;
  window.fetch = async function(url, options) {
    var response = await originalFetch.apply(this, arguments);

    try {
      var urlStr = typeof url === 'string' ? url : url.toString();

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
  // TECHNIQUE 3: Intercept XHR for story data
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
  // TECHNIQUE 4: Extract story URLs from API responses
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

    if (data.items && Array.isArray(data.items)) {
      var user = data.user || null;
      for (var m = 0; m < data.items.length; m++) {
        processStoryItem(data.items[m], user);
      }
    }

    var isStoryItem = data.video_versions || data.image_versions2;
    if (isStoryItem && (data.id || data.pk)) {
      processStoryItem(data, data.user);
    }

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

    // Get profile picture URL
    var profilePicUrl = null;
    if (item.user && item.user.profile_pic_url) {
      profilePicUrl = item.user.profile_pic_url;
    } else if (user && user.profile_pic_url) {
      profilePicUrl = user.profile_pic_url;
    }

    var storyData = {
      id: String(storyId),
      username: username,
      profilePicUrl: profilePicUrl,
      takenAt: item.taken_at,
      expiringAt: item.expiring_at,
      mediaType: item.media_type || 1,
      videoDuration: item.video_duration || 0,
      videoUrl: null,
      imageUrl: null,
      thumbnailUrl: null
    };

    if (item.video_versions && item.video_versions.length > 0) {
      storyData.videoUrl = item.video_versions[0].url;
      storyData.mediaType = 2;
    }

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
  // TECHNIQUE 5: UI Capture Functions
  // ============================================================

  function findStoryContainer() {
    // Try different selectors for the story viewer
    var selectors = [
      'section[role="dialog"] > div > div > div',
      'div[role="dialog"] section',
      'section > div > div > div > div > div'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && el.querySelector('video, img')) {
        return el;
      }
    }

    // Fallback: find the main story area
    var videos = document.querySelectorAll('video');
    for (var j = 0; j < videos.length; j++) {
      var parent = videos[j].closest('section') || videos[j].parentElement.parentElement.parentElement;
      if (parent) return parent;
    }

    return null;
  }

  function captureStoryWithUI() {
    return new Promise(function(resolve, reject) {
      if (!window.html2canvas) {
        reject(new Error('html2canvas not loaded'));
        return;
      }

      var container = findStoryContainer();
      if (!container) {
        reject(new Error('Story container not found'));
        return;
      }

      window.html2canvas(container, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#000000',
        scale: 2,
        logging: false,
        onclone: function(clonedDoc) {
          // Ensure videos show their poster/current frame
          var videos = clonedDoc.querySelectorAll('video');
          videos.forEach(function(v) {
            v.style.display = 'block';
          });
        }
      }).then(function(canvas) {
        canvas.toBlob(function(blob) {
          resolve(blob);
        }, 'image/png', 1.0);
      }).catch(reject);
    });
  }

  function recordStoryWithUI(story) {
    return new Promise(function(resolve, reject) {
      if (!story.videoUrl) {
        reject(new Error('No video URL'));
        return;
      }

      console.log('[Story POC] Starting recording for:', story.username);

      // Load profile picture first
      var profilePicImage = null;
      var profilePicLoaded = new Promise(function(picResolve) {
        if (story.profilePicUrl) {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function() {
            profilePicImage = img;
            console.log('[Story POC] Profile pic loaded');
            picResolve();
          };
          img.onerror = function() {
            console.log('[Story POC] Profile pic failed to load');
            picResolve();
          };
          img.src = story.profilePicUrl;
        } else {
          picResolve();
        }
      });

      // Create UI elements from story data
      var uiElements = {
        username: story.username,
        timestamp: formatTimestamp(story.takenAt),
        profilePicImage: null
      };

      // Create video element and load raw video
      var video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;

      // Create canvas for compositing
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      canvas.width = 1080;
      canvas.height = 1920;

      var recorder = null;
      var chunks = [];

      video.onloadedmetadata = function() {
        console.log('[Story POC] Video loaded:', video.videoWidth, 'x', video.videoHeight);

        // Wait for profile pic to load before starting recording
        profilePicLoaded.then(function() {
          uiElements.profilePicImage = profilePicImage;

          // Set up MediaRecorder with H.264 for MP4 compatibility
          var stream = canvas.captureStream(30);

          // Try MP4 first (H.264), then fall back to WebM
          var mimeType = 'video/mp4;codecs=avc1';
          var outputType = 'video/mp4';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm;codecs=h264';
            outputType = 'video/webm';
          }
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm;codecs=vp9';
            outputType = 'video/webm';
          }
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm;codecs=vp8';
            outputType = 'video/webm';
          }
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
            outputType = 'video/webm';
          }

          console.log('[Story POC] Using codec:', mimeType);

          recorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            videoBitsPerSecond: 8000000
          });

          recorder.ondataavailable = function(e) {
            if (e.data.size > 0) chunks.push(e.data);
          };

          recorder.onstop = function() {
            var blob = new Blob(chunks, { type: outputType });
            console.log('[Story POC] Recording complete, size:', blob.size, 'type:', outputType);
            video.pause();
            video.src = '';
            resolve({ blob: blob, isMP4: outputType === 'video/mp4' });
          };

          // Start recording and playing
          recorder.start(100);
          video.play();

          var duration = story.videoDuration || video.duration || 15;
          var startTime = Date.now();
          var maxDuration = duration * 1000;

          function drawFrame() {
            var elapsed = Date.now() - startTime;
            var progress = Math.min(elapsed / maxDuration, 1);

            if (video.ended || elapsed >= maxDuration) {
              if (recorder && recorder.state === 'recording') {
                recorder.stop();
              }
              return;
            }

            // Clear and draw black background
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw video frame
            if (video.readyState >= 2) {
              var videoAspect = video.videoWidth / video.videoHeight;
              var canvasAspect = canvas.width / canvas.height;
              var drawWidth, drawHeight, drawX, drawY;

              if (videoAspect > canvasAspect) {
                drawWidth = canvas.width;
                drawHeight = canvas.width / videoAspect;
                drawX = 0;
                drawY = (canvas.height - drawHeight) / 2;
              } else {
                drawHeight = canvas.height;
                drawWidth = canvas.height * videoAspect;
                drawX = (canvas.width - drawWidth) / 2;
                drawY = 0;
              }

              try {
                ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
              } catch (e) {
                console.error('[Story POC] Draw error:', e);
              }
            }

            // Draw UI overlay with progress
            drawUIOverlay(ctx, canvas.width, canvas.height, uiElements, progress);

            requestAnimationFrame(drawFrame);
          }

          drawFrame();

          // Safety timeout
          setTimeout(function() {
            if (recorder && recorder.state === 'recording') {
              recorder.stop();
            }
          }, maxDuration + 3000);
        });
      };

      video.onerror = function(e) {
        console.error('[Story POC] Video load error:', e);
        reject(new Error('Failed to load video'));
      };

      // Load the video
      console.log('[Story POC] Loading video for recording...');
      video.src = story.videoUrl;
      video.load();
    });
  }

  function formatTimestamp(takenAt) {
    if (!takenAt) return '';
    var now = Math.floor(Date.now() / 1000);
    var diff = now - takenAt;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    return Math.floor(diff / 86400) + 'd';
  }

  function captureUIElements(container) {
    var ui = {
      username: '',
      timestamp: '',
      profilePic: null
    };

    if (!container) return ui;

    // Try to find username
    var usernameEl = container.querySelector('a[href*="/"] span') ||
                     container.querySelector('header span');
    if (usernameEl) {
      ui.username = usernameEl.textContent || '';
    }

    // Try to find timestamp
    var timeEl = container.querySelector('time') ||
                 container.querySelector('header span:last-child');
    if (timeEl) {
      ui.timestamp = timeEl.textContent || '';
    }

    // Try to find profile picture
    var profileImg = container.querySelector('header img');
    if (profileImg && profileImg.src) {
      ui.profilePic = profileImg.src;
    }

    return ui;
  }

  function drawUIOverlay(ctx, width, height, ui, progress) {
    if (progress === undefined) progress = 0.5;

    // Scale factor for UI elements (1080x1920 canvas)
    var scale = width / 1080;
    var avatarSize = 80 * scale;
    var avatarX = 40 * scale;
    var avatarY = 70 * scale;
    var textX = avatarX + avatarSize + 24 * scale;
    var headerY = 50 * scale;

    // Semi-transparent gradient at top (larger)
    var gradient = ctx.createLinearGradient(0, 0, 0, 350 * scale);
    gradient.addColorStop(0, 'rgba(0,0,0,0.7)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, 350 * scale);

    // Progress bar at top (thicker)
    var barY = 24 * scale;
    var barHeight = 6 * scale;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.roundRect(24 * scale, barY, width - 48 * scale, barHeight, barHeight / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.roundRect(24 * scale, barY, (width - 48 * scale) * progress, barHeight, barHeight / 2);
    ctx.fill();

    // Profile picture (circular)
    var avatarCenterX = avatarX + avatarSize / 2;
    var avatarCenterY = avatarY + avatarSize / 2;

    // Draw gradient ring around avatar (Instagram story style)
    var ringGradient = ctx.createLinearGradient(
      avatarCenterX - avatarSize / 2, avatarCenterY - avatarSize / 2,
      avatarCenterX + avatarSize / 2, avatarCenterY + avatarSize / 2
    );
    ringGradient.addColorStop(0, '#F58529');
    ringGradient.addColorStop(0.5, '#DD2A7B');
    ringGradient.addColorStop(1, '#8134AF');
    ctx.strokeStyle = ringGradient;
    ctx.lineWidth = 4 * scale;
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2 + 4 * scale, 0, Math.PI * 2);
    ctx.stroke();

    // Draw profile picture or placeholder
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();

    if (ui.profilePicImage) {
      // Draw the actual profile picture
      ctx.drawImage(ui.profilePicImage, avatarX, avatarY, avatarSize, avatarSize);
    } else {
      // Placeholder circle
      ctx.fillStyle = '#333333';
      ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
      // Person icon placeholder
      ctx.fillStyle = '#666666';
      ctx.beginPath();
      ctx.arc(avatarCenterX, avatarCenterY - 8 * scale, 16 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(avatarCenterX, avatarCenterY + 40 * scale, 28 * scale, Math.PI, 0);
      ctx.fill();
    }
    ctx.restore();

    // Username text (larger, bold)
    if (ui.username) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + Math.round(42 * scale) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(ui.username, textX, avatarY + 35 * scale);
    }

    // Timestamp (larger)
    if (ui.timestamp) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = Math.round(32 * scale) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(ui.timestamp, textX, avatarY + 75 * scale);
    }

    // Close button (X) on top right
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = Math.round(48 * scale) + 'px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('×', width - 60 * scale, 80 * scale);

    // More button (...)
    ctx.font = 'bold ' + Math.round(40 * scale) + 'px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('···', width - 120 * scale, 76 * scale);

    // Bottom gradient (larger)
    var bottomGradient = ctx.createLinearGradient(0, height - 250 * scale, 0, height);
    bottomGradient.addColorStop(0, 'rgba(0,0,0,0)');
    bottomGradient.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = bottomGradient;
    ctx.fillRect(0, height - 250 * scale, width, 250 * scale);

    // Reply bar (larger)
    var replyBarY = height - 100 * scale;
    var replyBarHeight = 60 * scale;
    var replyBarWidth = width - 200 * scale;

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.roundRect(30 * scale, replyBarY, replyBarWidth, replyBarHeight, replyBarHeight / 2);
    ctx.fill();

    // Reply bar border
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.roundRect(30 * scale, replyBarY, replyBarWidth, replyBarHeight, replyBarHeight / 2);
    ctx.stroke();

    // Reply bar text
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = Math.round(32 * scale) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('Send message', 60 * scale, replyBarY + 40 * scale);

    // Heart icon on right (larger)
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = Math.round(48 * scale) + 'px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('♡', width - 140 * scale, replyBarY + 42 * scale);

    // Send/share icon on right (larger)
    ctx.font = Math.round(44 * scale) + 'px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('➤', width - 70 * scale, replyBarY + 42 * scale);
  }

  // ============================================================
  // TECHNIQUE 6: Download button with badge
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
  // TECHNIQUE 7: Download modal with format options
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
      'background:rgba(0,0,0,0.95);z-index:9999999;display:flex;flex-direction:column;' +
      'align-items:center;padding:20px;box-sizing:border-box;overflow-y:auto;';

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'width:100%;max-width:900px;display:flex;justify-content:space-between;' +
      'align-items:center;margin-bottom:15px;color:white;flex-wrap:wrap;gap:10px;';

    var title = document.createElement('div');
    title.innerHTML = '<span style="font-size:18px;font-weight:bold;">Story Downloader POC</span>' +
      '<span style="font-size:14px;opacity:0.7;margin-left:10px;">' + stories.length + ' stories</span>';

    var headerButtons = document.createElement('div');
    headerButtons.style.cssText = 'display:flex;gap:10px;';

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

    headerButtons.appendChild(downloadBtn);
    headerButtons.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(headerButtons);

    // Format options
    var formatSection = document.createElement('div');
    formatSection.style.cssText = 'width:100%;max-width:900px;margin-bottom:15px;padding:15px;' +
      'background:#1a1a1a;border-radius:8px;color:white;';

    formatSection.innerHTML = '<div style="margin-bottom:10px;font-weight:bold;">Download Format</div>' +
      '<div style="display:flex;gap:20px;flex-wrap:wrap;">' +
        '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;">' +
          '<input type="radio" name="poc-format" value="raw" ' + (window.__downloadFormat === 'raw' ? 'checked' : '') + '> Raw Only' +
        '</label>' +
        '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;">' +
          '<input type="radio" name="poc-format" value="ui" ' + (window.__downloadFormat === 'ui' ? 'checked' : '') + '> With UI Only' +
        '</label>' +
        '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;">' +
          '<input type="radio" name="poc-format" value="both" ' + (window.__downloadFormat === 'both' ? 'checked' : '') + '> Both Versions' +
        '</label>' +
      '</div>' +
      '<div id="poc-video-options" style="margin-top:15px;padding-top:15px;border-top:1px solid #333;' +
        (window.__downloadFormat === 'raw' ? 'display:none;' : '') + '">' +
        '<div style="margin-bottom:10px;font-weight:bold;">Video UI Format</div>' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap;">' +
          '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;">' +
            '<input type="radio" name="poc-video-format" value="screenshot" ' + (window.__videoUIFormat === 'screenshot' ? 'checked' : '') + '> Screenshot (JPG)' +
          '</label>' +
          '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;">' +
            '<input type="radio" name="poc-video-format" value="recording" ' + (window.__videoUIFormat === 'recording' ? 'checked' : '') + '> Screen Recording (WebM)' +
          '</label>' +
        '</div>' +
      '</div>';

    // Grid
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
    modal.appendChild(formatSection);
    modal.appendChild(grid);
    document.body.appendChild(modal);

    // Event listeners for format options
    var formatRadios = modal.querySelectorAll('input[name="poc-format"]');
    formatRadios.forEach(function(radio) {
      radio.addEventListener('change', function() {
        window.__downloadFormat = this.value;
        var videoOptions = document.getElementById('poc-video-options');
        if (videoOptions) {
          videoOptions.style.display = this.value === 'raw' ? 'none' : 'block';
        }
      });
    });

    var videoFormatRadios = modal.querySelectorAll('input[name="poc-video-format"]');
    videoFormatRadios.forEach(function(radio) {
      radio.addEventListener('change', function() {
        window.__videoUIFormat = this.value;
      });
    });

    closeBtn.onclick = function() { modal.remove(); };
    downloadBtn.onclick = function() { downloadAllStories(stories); };

    document.addEventListener('keydown', function handleEscape(e) {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    });

    // Load html2canvas if needed
    if (window.__downloadFormat !== 'raw') {
      loadHtml2Canvas();
    }
  }

  // ============================================================
  // TECHNIQUE 8: Download functions
  // ============================================================

  function generateFilename(story, suffix, ext) {
    var date = new Date(story.takenAt * 1000);
    var dateStr = date.getFullYear() +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0');
    var timeStr = String(date.getHours()).padStart(2, '0') +
      String(date.getMinutes()).padStart(2, '0') +
      String(date.getSeconds()).padStart(2, '0');
    var shortcode = story.id.split('_')[0];
    return story.username + '_story_' + dateStr + '_' + timeStr + '_' + shortcode + '_' + suffix + '.' + ext;
  }

  function downloadBlob(blob, filename) {
    var blobUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }

  function downloadStory(story, index) {
    var format = window.__downloadFormat;
    var videoUIFormat = window.__videoUIFormat;
    var promises = [];

    // Download raw version
    if (format === 'raw' || format === 'both') {
      var rawUrl = story.videoUrl || story.imageUrl;
      var rawExt = story.mediaType === 2 ? 'mp4' : 'jpg';
      var rawFilename = generateFilename(story, 'raw', rawExt);

      console.log('[Story POC] Downloading raw:', rawFilename);

      promises.push(new Promise(function(resolve) {
        window.postMessage({
          type: 'STORY_POC_DOWNLOAD',
          url: rawUrl,
          filename: rawFilename
        }, '*');
        setTimeout(resolve, 100);
      }));
    }

    // Download UI version
    if (format === 'ui' || format === 'both') {
      if (story.mediaType === 2 && videoUIFormat === 'recording') {
        // Video recording - load raw video and composite UI on top
        console.log('[Story POC] Recording with UI...');

        promises.push(
          recordStoryWithUI(story).then(function(result) {
            var blob = result.blob;
            var ext = result.isMP4 ? 'mp4' : 'webm';
            var recordFilename = generateFilename(story, 'ui', ext);
            console.log('[Story POC] Recording done:', recordFilename, 'size:', blob.size);
            if (blob.size > 1000) {
              downloadBlob(blob, recordFilename);
            } else {
              console.error('[Story POC] Recording too small, skipping');
            }
          }).catch(function(err) {
            console.error('[Story POC] Recording failed:', err);
          })
        );
      } else {
        // Screenshot (for images or video frame)
        var uiFilename = generateFilename(story, 'ui', 'png');
        console.log('[Story POC] Capturing with UI:', uiFilename);

        promises.push(
          loadHtml2Canvas().then(function() {
            return captureStoryWithUI();
          }).then(function(blob) {
            downloadBlob(blob, uiFilename);
          }).catch(function(err) {
            console.error('[Story POC] UI capture failed:', err);
          })
        );
      }
    }

    return Promise.all(promises);
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
        setTimeout(downloadNext, 500);
      });
    }

    downloadNext();
  }

  // ============================================================
  // TECHNIQUE 9: Watch for story page navigation
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
