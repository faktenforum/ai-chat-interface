/**
 * Upload page client-side logic.
 *
 * Reads configuration from window.__UPLOAD_CONFIG__ which is injected
 * by the Pug template as an inline script tag.
 */

(function () {
  'use strict';

  var cfg = window.__UPLOAD_CONFIG__;
  if (!cfg) {
    console.error('Upload config not found on window.__UPLOAD_CONFIG__');
    return;
  }

  var TOKEN = cfg.token;
  var MAX_SIZE = cfg.maxSizeMb * 1024 * 1024;
  var ALLOWED_EXT = cfg.allowedExtensions || [];
  var EXPIRES_AT = new Date(cfg.expiresAt);

  // ── DOM elements ─────────────────────────────────────────

  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var filePreview = document.getElementById('filePreview');
  var fileName = document.getElementById('fileName');
  var fileSize = document.getElementById('fileSize');
  var fileRemove = document.getElementById('fileRemove');
  var uploadBtn = document.getElementById('uploadBtn');
  var progressContainer = document.getElementById('progressContainer');
  var progressFill = document.getElementById('progressFill');
  var progressPercent = document.getElementById('progressPercent');
  var progressLabel = document.getElementById('progressLabel');
  var statusEl = document.getElementById('status');
  var expiresTag = document.getElementById('expiresTag');
  var expiredOverlay = document.getElementById('expiredOverlay');

  var selectedFile = null;
  var uploading = false;
  var uploadComplete = false;

  // ── Expiry countdown ─────────────────────────────────────

  function updateExpiry() {
    var now = Date.now();
    var diff = EXPIRES_AT.getTime() - now;
    if (diff <= 0) {
      expiresTag.textContent = 'Expired';
      expiredOverlay.classList.add('visible');
      uploadBtn.disabled = true;
      return;
    }
    var mins = Math.floor(diff / 60000);
    var secs = Math.floor((diff % 60000) / 1000);
    expiresTag.textContent = 'Expires in ' + mins + ':' + String(secs).padStart(2, '0');
  }

  updateExpiry();
  setInterval(updateExpiry, 1000);

  // ── Helpers ──────────────────────────────────────────────

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getExtension(name) {
    var idx = name.lastIndexOf('.');
    return idx >= 0 ? name.substring(idx).toLowerCase() : '';
  }

  function validateFile(file) {
    if (file.size > MAX_SIZE) {
      return 'File exceeds maximum size of ' + formatSize(MAX_SIZE);
    }
    if (ALLOWED_EXT.length > 0) {
      var ext = getExtension(file.name);
      if (ALLOWED_EXT.indexOf(ext) === -1) {
        return 'File type ' + ext + ' is not allowed. Accepted: ' + ALLOWED_EXT.join(', ');
      }
    }
    return null;
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function showStatus(type, title, detail) {
    statusEl.className = 'status visible ' + type;
    statusEl.innerHTML =
      '<div class="status-title">' +
      (type === 'success' ? '&#10003; ' : '&#10007; ') +
      escapeHtml(title) +
      '</div>' +
      (detail ? '<div class="status-detail">' + escapeHtml(detail) + '</div>' : '');
  }

  function selectFile(file) {
    var error = validateFile(file);
    if (error) {
      showStatus('error', 'Invalid file', error);
      return;
    }
    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatSize(file.size);
    filePreview.classList.add('visible');
    uploadBtn.classList.add('visible');
    uploadBtn.disabled = false;
    statusEl.className = 'status';
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    filePreview.classList.remove('visible');
    uploadBtn.classList.remove('visible');
    uploadBtn.disabled = true;
  }

  // ── Drop zone events ─────────────────────────────────────

  dropzone.addEventListener('click', function () {
    if (!uploading) fileInput.click();
  });

  dropzone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', function () {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (uploading) return;
    if (e.dataTransfer.files.length > 0) {
      selectFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length > 0) {
      selectFile(fileInput.files[0]);
    }
  });

  fileRemove.addEventListener('click', function () {
    if (!uploading) clearFile();
  });

  // ── Upload ───────────────────────────────────────────────

  uploadBtn.addEventListener('click', function () {
    if (uploadComplete) {
      window.close();
      return;
    }
    if (!selectedFile || uploading) return;
    uploading = true;

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    progressContainer.classList.add('visible');
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressLabel.textContent = 'Uploading...';
    statusEl.className = 'status';

    var formData = new FormData();
    formData.append('file', selectedFile);

    var xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', function (e) {
      if (e.lengthComputable) {
        var pct = Math.round((e.loaded / e.total) * 100);
        progressFill.style.width = pct + '%';
        progressPercent.textContent = pct + '%';
        progressLabel.textContent =
          'Uploading... ' + formatSize(e.loaded) + ' / ' + formatSize(e.total);
      }
    });

    xhr.addEventListener('load', function () {
      uploading = false;
      progressFill.style.width = '100%';
      progressPercent.textContent = '100%';
      progressLabel.textContent = 'Complete';

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var result = JSON.parse(xhr.responseText);
          showStatus(
            'success',
            'Upload successful',
            result.filename + ' (' + formatSize(result.size) + ') saved to ' + result.path,
          );
          uploadComplete = true;
          uploadBtn.textContent = 'Done';
          uploadBtn.disabled = false;
          dropzone.style.pointerEvents = 'none';
          dropzone.style.opacity = '0.5';
        } catch (e) {
          showStatus('success', 'Upload successful', '');
          uploadComplete = true;
          uploadBtn.textContent = 'Done';
          uploadBtn.disabled = false;
        }
      } else {
        try {
          var errResult = JSON.parse(xhr.responseText);
          showStatus('error', 'Upload failed', errResult.error || 'Unknown error');
        } catch (e) {
          showStatus('error', 'Upload failed', 'HTTP ' + xhr.status);
        }
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Retry';
      }
    });

    xhr.addEventListener('error', function () {
      uploading = false;
      showStatus('error', 'Upload failed', 'Network error. Please check your connection.');
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Retry';
    });

    xhr.addEventListener('abort', function () {
      uploading = false;
      showStatus('error', 'Upload cancelled', '');
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload';
    });

    xhr.open('POST', '/upload/' + TOKEN);
    xhr.send(formData);
  });
})();
