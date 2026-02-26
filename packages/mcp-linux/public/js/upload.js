(function() {


//#region src/shared/http.ts
	function formatBytes(bytes) {
		if (bytes == null || Number.isNaN(bytes)) return "";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

//#endregion
//#region src/shared/dom.ts
	function escapeHtml(str) {
		const div = document.createElement("div");
		div.textContent = String(str);
		return div.innerHTML;
	}

//#endregion
//#region src/upload/upload-page.ts
	function getConfig() {
		const cfg = window.__UPLOAD_CONFIG__;
		if (!cfg) {
			console.error("Upload config not found on window.__UPLOAD_CONFIG__");
			return null;
		}
		return cfg;
	}
	const cfg = getConfig();
	if (!cfg) export {};
	else {
		const TOKEN = cfg.token;
		const MAX_SIZE = cfg.maxSizeMb * 1024 * 1024;
		const ALLOWED_EXT = cfg.allowedExtensions || [];
		const EXPIRES_AT = new Date(cfg.expiresAt);
		const dropzone = document.getElementById("dropzone");
		const fileInput = document.getElementById("fileInput");
		const filePreview = document.getElementById("filePreview");
		const fileName = document.getElementById("fileName");
		const fileSize = document.getElementById("fileSize");
		const fileRemove = document.getElementById("fileRemove");
		const uploadBtn = document.getElementById("uploadBtn");
		const progressContainer = document.getElementById("progressContainer");
		const progressFill = document.getElementById("progressFill");
		const progressPercent = document.getElementById("progressPercent");
		const progressLabel = document.getElementById("progressLabel");
		const statusEl = document.getElementById("status");
		const expiresTag = document.getElementById("expiresTag");
		const expiredOverlay = document.getElementById("expiredOverlay");
		if (!dropzone || !fileInput || !filePreview || !fileName || !fileSize || !fileRemove || !uploadBtn || !progressContainer || !progressFill || !progressPercent || !progressLabel || !statusEl || !expiresTag || !expiredOverlay) {
			console.error("Upload page DOM structure is incomplete, aborting initialization.");
			export {};
		} else {
			let selectedFile = null;
			let uploading = false;
			let uploadComplete = false;
			function updateExpiry() {
				const now = Date.now();
				const diff = EXPIRES_AT.getTime() - now;
				if (diff <= 0) {
					expiresTag.textContent = "Expired";
					expiredOverlay.classList.add("visible");
					uploadBtn.disabled = true;
					return;
				}
				const mins = Math.floor(diff / 6e4);
				const secs = Math.floor(diff % 6e4 / 1e3);
				expiresTag.textContent = `Expires in ${mins}:${String(secs).padStart(2, "0")}`;
			}
			updateExpiry();
			setInterval(updateExpiry, 1e3);
			function getExtension(name) {
				const idx = name.lastIndexOf(".");
				return idx >= 0 ? name.substring(idx).toLowerCase() : "";
			}
			function validateFile(file) {
				if (file.size > MAX_SIZE) return "File exceeds maximum size of " + formatBytes(MAX_SIZE);
				if (ALLOWED_EXT.length > 0) {
					const ext = getExtension(file.name);
					if (ALLOWED_EXT.indexOf(ext) === -1) return "File type " + ext + " is not allowed. Accepted: " + ALLOWED_EXT.join(", ");
				}
				return null;
			}
			function showStatus(type, title, detail) {
				statusEl.className = "status visible " + type;
				statusEl.innerHTML = "<div class=\"status-title\">" + (type === "success" ? "&#10003; " : "&#10007; ") + escapeHtml(title) + "</div>" + (detail ? "<div class=\"status-detail\">" + escapeHtml(detail) + "</div>" : "");
			}
			function selectFile(file) {
				const error = validateFile(file);
				if (error) {
					showStatus("error", "Invalid file", error);
					return;
				}
				selectedFile = file;
				fileName.textContent = file.name;
				fileSize.textContent = formatBytes(file.size);
				filePreview.classList.add("visible");
				uploadBtn.classList.add("visible");
				uploadBtn.disabled = false;
				statusEl.className = "status";
			}
			function clearFile() {
				selectedFile = null;
				fileInput.value = "";
				filePreview.classList.remove("visible");
				uploadBtn.classList.remove("visible");
				uploadBtn.disabled = true;
			}
			dropzone.addEventListener("click", () => {
				if (!uploading) fileInput.click();
			});
			dropzone.addEventListener("dragover", (e) => {
				e.preventDefault();
				dropzone.classList.add("dragover");
			});
			dropzone.addEventListener("dragleave", () => {
				dropzone.classList.remove("dragover");
			});
			dropzone.addEventListener("drop", (e) => {
				e.preventDefault();
				dropzone.classList.remove("dragover");
				if (uploading) return;
				const files = e.dataTransfer?.files;
				if (files && files.length > 0) selectFile(files[0]);
			});
			fileInput.addEventListener("change", () => {
				const files = fileInput.files;
				if (files && files.length > 0) selectFile(files[0]);
			});
			fileRemove.addEventListener("click", () => {
				if (!uploading) clearFile();
			});
			uploadBtn.addEventListener("click", () => {
				if (uploadComplete) {
					window.close();
					return;
				}
				if (!selectedFile || uploading) return;
				uploading = true;
				uploadBtn.disabled = true;
				uploadBtn.textContent = "Uploading...";
				progressContainer.classList.add("visible");
				progressFill.style.width = "0%";
				progressPercent.textContent = "0%";
				progressLabel.textContent = "Uploading...";
				statusEl.className = "status";
				const formData = new FormData();
				formData.append("file", selectedFile);
				const xhr = new XMLHttpRequest();
				xhr.upload.addEventListener("progress", (e) => {
					if (e.lengthComputable) {
						const pct = Math.round(e.loaded / e.total * 100);
						progressFill.style.width = pct + "%";
						progressPercent.textContent = pct + "%";
						progressLabel.textContent = "Uploading... " + formatBytes(e.loaded) + " / " + formatBytes(e.total);
					}
				});
				xhr.addEventListener("load", () => {
					uploading = false;
					progressFill.style.width = "100%";
					progressPercent.textContent = "100%";
					progressLabel.textContent = "Complete";
					if (xhr.status >= 200 && xhr.status < 300) try {
						const result = JSON.parse(xhr.responseText);
						showStatus("success", "Upload successful", `${result.filename} (${formatBytes(result.size)}) saved to ${result.path}`);
						uploadComplete = true;
						uploadBtn.textContent = "Done";
						uploadBtn.disabled = false;
						dropzone.style.pointerEvents = "none";
						dropzone.style.opacity = "0.5";
					} catch {
						showStatus("success", "Upload successful", "");
						uploadComplete = true;
						uploadBtn.textContent = "Done";
						uploadBtn.disabled = false;
					}
					else {
						try {
							showStatus("error", "Upload failed", JSON.parse(xhr.responseText).error || "Unknown error");
						} catch {
							showStatus("error", "Upload failed", "HTTP " + xhr.status);
						}
						uploadBtn.disabled = false;
						uploadBtn.textContent = "Retry";
					}
				});
				xhr.addEventListener("error", () => {
					uploading = false;
					showStatus("error", "Upload failed", "Network error. Please check your connection.");
					uploadBtn.disabled = false;
					uploadBtn.textContent = "Retry";
				});
				xhr.addEventListener("abort", () => {
					uploading = false;
					showStatus("error", "Upload cancelled", "");
					uploadBtn.disabled = false;
					uploadBtn.textContent = "Upload";
				});
				xhr.open("POST", "/upload/" + TOKEN);
				xhr.send(formData);
			});
		}
	}

//#endregion
})();