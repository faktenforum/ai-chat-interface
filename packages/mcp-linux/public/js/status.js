(function() {


//#region src/shared/http.ts
	function getAuthToken() {
		return new URLSearchParams(window.location.search || "").get("token") || "";
	}
	function formatBytes(bytes) {
		if (bytes == null || Number.isNaN(bytes)) return "";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	function postJson(url, body) {
		const auth = getAuthToken();
		const payload = auth ? {
			...body,
			auth_token: auth
		} : body;
		return fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
	}

//#endregion
//#region src/shared/dom.ts
	function $(id) {
		return document.getElementById(id);
	}
	function setBanner(bannerEl, type, message) {
		if (!bannerEl) return;
		if (!message) {
			bannerEl.className = "status-banner";
			bannerEl.textContent = "";
			return;
		}
		bannerEl.className = "status-banner visible " + type;
		bannerEl.textContent = message;
	}
	function escapeHtml(str) {
		const div = document.createElement("div");
		div.textContent = String(str);
		return div.innerHTML;
	}

//#endregion
//#region src/status/status-page.ts
	const userCardBody = document.querySelector("#userCard .card-body");
	const workspacesCardBody = document.querySelector("#workspacesCard .card-body");
	const uploadsCardBody = document.querySelector("#uploadsCard .card-body");
	const downloadsCardBody = document.querySelector("#downloadsCard .card-body");
	const terminalsCardBody = document.querySelector("#terminalsCard .card-body");
	const statusBanner = $("#statusBanner");
	function hideAllGrids() {
		document.querySelectorAll(".grid").forEach((g) => {
			g.style.display = "none";
		});
	}
	function banner(type, message) {
		setBanner(statusBanner, type, message);
	}
	function renderUser(user) {
		if (!userCardBody) return;
		if (!user) {
			userCardBody.innerHTML = "<p class=\"muted\">No account information available.</p>";
			return;
		}
		let html = "<div class=\"list\"><div class=\"list-item\"><div class=\"list-item-header\"><div class=\"list-item-title\">" + escapeHtml(user.email || "") + "</div></div><div class=\"list-item-meta\">" + (user.username ? "<span class=\"badge\">User: " + escapeHtml(user.username) + "</span>" : "") + (user.diskUsage ? "<span class=\"badge\">Disk: " + escapeHtml(user.diskUsage) + "</span>" : "") + (user.home ? "<span class=\"badge\">Home: " + escapeHtml(user.home) + "</span>" : "") + "</div>";
		const runtimes = user.runtimes || {};
		const runtimeKeys = Object.keys(runtimes);
		if (runtimeKeys.length > 0) {
			html += "<div class=\"list-item-meta\"><span class=\"badge\">Installed runtimes</span></div>";
			html += "<div class=\"list-item-meta\">";
			for (const key of runtimeKeys) html += "<span>" + escapeHtml(key) + ": " + escapeHtml(String(runtimes[key] || "unknown")) + "</span>";
			html += "</div>";
		}
		html += "</div></div>";
		userCardBody.innerHTML = html;
	}
	function renderWorkspaces(workspaces) {
		if (!workspacesCardBody) return;
		if (!workspaces || workspaces.length === 0) {
			workspacesCardBody.innerHTML = "<p class=\"muted\">No workspaces found yet.</p>";
			return;
		}
		const search = window.location.search || "";
		workspacesCardBody.innerHTML = "<div class=\"list\">" + workspaces.map((name) => {
			return "<div class=\"list-item\"><div class=\"list-item-header\"><div class=\"list-item-title\"><a class=\"workspace-link\" href=\"/status/workspace/" + encodeURIComponent(name) + search + "\">" + escapeHtml(name) + "</a></div><div><button class=\"pill-button\" data-action=\"open-vscode\" data-workspace=\"" + escapeHtml(name) + "\" disabled>Open VS Code (coming soon)</button></div></div><div class=\"list-item-meta\">" + (name === "default" ? "<span class=\"badge\">Default workspace</span>" : "<span class=\"badge\">Custom workspace</span>") + "</div><div class=\"list-item-meta\">" + (name === "default" ? "" : "<button class=\"pill-button\" data-action=\"delete-workspace\" data-workspace=\"" + escapeHtml(name) + "\">Delete</button>") + "</div></div>";
		}).join("") + "</div>";
	}
	function renderUploadSessions(sessions) {
		if (!uploadsCardBody) return;
		if (!sessions || sessions.length === 0) {
			uploadsCardBody.innerHTML = "<p class=\"muted\">No upload sessions.</p>";
			return;
		}
		uploadsCardBody.innerHTML = "<div class=\"list\">" + sessions.map((s) => {
			const canClose = s.status === "active";
			return "<div class=\"list-item\"><div class=\"list-item-header\"><div class=\"list-item-title\">" + escapeHtml(s.workspace) + "</div><span class=\"badge " + (s.status === "completed" ? "badge-success" : s.status === "expired" || s.status === "closed" ? "badge-error" : "") + "\">" + escapeHtml(s.status) + "</span></div><div class=\"list-item-meta\"><span>Token: " + escapeHtml(String(s.token).slice(0, 8)) + "…</span><span>Expires: " + escapeHtml(s.expires_at) + "</span>" + (s.uploaded_file ? "<span>File: " + escapeHtml(s.uploaded_file.name) + " (" + formatBytes(s.uploaded_file.size) + ")</span>" : "") + "</div><div class=\"list-item-meta\">" + (canClose ? "<button class=\"pill-button\" data-action=\"close-upload\" data-token=\"" + escapeHtml(s.token) + "\">Close session</button>" : "") + "</div></div>";
		}).join("") + "</div>";
	}
	function renderDownloadSessions(sessions) {
		if (!downloadsCardBody) return;
		if (!sessions || sessions.length === 0) {
			downloadsCardBody.innerHTML = "<p class=\"muted\">No download links.</p>";
			return;
		}
		downloadsCardBody.innerHTML = "<div class=\"list\">" + sessions.map((s) => {
			const canClose = s.status === "active";
			return "<div class=\"list-item\"><div class=\"list-item-header\"><div class=\"list-item-title\">" + escapeHtml(s.filename) + "</div><span class=\"badge " + (s.status === "downloaded" ? "badge-success" : s.status === "expired" || s.status === "closed" ? "badge-error" : "") + "\">" + escapeHtml(s.status) + "</span></div><div class=\"list-item-meta\"><span>Workspace: " + escapeHtml(s.workspace) + "</span><span>Size: " + formatBytes(s.file_size) + "</span><span>Path: " + escapeHtml(s.file_path) + "</span></div><div class=\"list-item-meta\">" + (canClose ? "<button class=\"pill-button\" data-action=\"close-download\" data-token=\"" + escapeHtml(s.token) + "\">Revoke link</button>" : "") + "</div></div>";
		}).join("") + "</div>";
	}
	function renderTerminals(terminals) {
		if (!terminalsCardBody) return;
		if (!terminals || terminals.length === 0) {
			terminalsCardBody.innerHTML = "<p class=\"muted\">No active terminals.</p>";
			return;
		}
		terminalsCardBody.innerHTML = "<div class=\"list\">" + terminals.map((t) => {
			const id = t.terminal_id || t.id || "";
			const workspace = t.workspace || "";
			const cwd = t.cwd || "";
			return "<div class=\"list-item\"><div class=\"list-item-header\"><div class=\"list-item-title\">Terminal " + escapeHtml(id) + "</div></div><div class=\"list-item-meta\">" + (workspace ? "<span>Workspace: " + escapeHtml(workspace) + "</span>" : "") + (cwd ? "<span>CWD: " + escapeHtml(cwd) + "</span>" : "") + "</div><div class=\"list-item-meta\"><button class=\"pill-button\" data-action=\"kill-terminal\" data-terminal-id=\"" + escapeHtml(id) + "\">Kill</button></div></div>";
		}).join("") + "</div>";
	}
	function overviewUrl() {
		const auth = getAuthToken();
		return auth ? "/status/api/overview?token=" + encodeURIComponent(auth) : "/status/api/overview";
	}
	function refreshOverview() {
		if (!getAuthToken()) {
			hideAllGrids();
			banner("error", "Open the personal status link from the agent in LibreChat (it contains your access token).");
			return;
		}
		banner("info", "Refreshing status...");
		fetch(overviewUrl()).then((res) => {
			if (!res.ok) {
				if (res.status === 401 || res.status === 403) hideAllGrids();
				throw new Error("Failed to load status: HTTP " + res.status);
			}
			return res.json();
		}).then((data) => {
			renderUser(data.user);
			renderWorkspaces(data.workspaces);
			renderUploadSessions(data.upload_sessions);
			renderDownloadSessions(data.download_sessions);
			renderTerminals(data.terminals);
			banner("", "");
		}).catch((err) => {
			let msg = err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "Failed to load status";
			if (String(msg).includes("401") || String(msg).includes("403")) msg = "Your access token is invalid or has expired. Ask the agent in LibreChat for a fresh status link.";
			else if (!getAuthToken()) msg = "Open the personal status link from the agent in LibreChat (it contains your access token).";
			banner("error", String(msg));
		});
	}
	function closeUploadSession(token) {
		banner("info", "Closing upload session...");
		postJson("/status/api/close-upload-session", { token }).then((res) => {
			if (!res.ok) return res.json().catch(() => ({})).then((payload) => {
				const msg = payload && payload.error || "Failed to close upload session";
				throw new Error(msg);
			});
			return res.json();
		}).then(() => {
			banner("success", "Upload session closed.");
			refreshOverview();
		}).catch((err) => {
			banner("error", (err && typeof err === "object" && "message" in err ? String(err.message) : void 0) || "Failed to close upload session");
		});
	}
	function closeDownloadLink(token) {
		banner("info", "Revoking download link...");
		postJson("/status/api/close-download-link", { token }).then((res) => {
			if (!res.ok) return res.json().catch(() => ({})).then((payload) => {
				const msg = payload && payload.error || "Failed to revoke download link";
				throw new Error(msg);
			});
			return res.json();
		}).then(() => {
			banner("success", "Download link revoked.");
			refreshOverview();
		}).catch((err) => {
			banner("error", (err && typeof err === "object" && "message" in err ? String(err.message) : void 0) || "Failed to revoke download link");
		});
	}
	function killTerminal(terminalId) {
		banner("info", "Killing terminal " + terminalId + "...");
		postJson("/status/api/kill-terminal", { terminal_id: terminalId }).then((res) => {
			if (!res.ok) return res.json().catch(() => ({})).then((payload) => {
				const msg = payload && payload.error || "Failed to kill terminal";
				throw new Error(msg);
			});
			return res.json();
		}).then(() => {
			banner("success", "Terminal killed.");
			refreshOverview();
		}).catch((err) => {
			banner("error", (err && typeof err === "object" && "message" in err ? String(err.message) : void 0) || "Failed to kill terminal");
		});
	}
	function deleteWorkspace(name) {
		if (!window.confirm("Delete workspace \"" + name + "\"? This cannot be undone.")) return;
		banner("info", "Deleting workspace " + name + "...");
		postJson("/status/api/delete-workspace", { name }).then((res) => {
			if (!res.ok) return res.json().catch(() => ({})).then((payload) => {
				const msg = payload && payload.error || "Failed to delete workspace";
				throw new Error(msg);
			});
			return res.json();
		}).then(() => {
			banner("success", "Workspace deleted.");
			refreshOverview();
		}).catch((err) => {
			banner("error", (err && typeof err === "object" && "message" in err ? String(err.message) : void 0) || "Failed to delete workspace");
		});
	}
	function attachActionHandlers() {
		const root = document.body;
		if (!root) return;
		root.addEventListener("click", (e) => {
			const target = e.target;
			if (!target) return;
			const action = target.getAttribute("data-action");
			if (!action) return;
			if (action === "close-upload") {
				const token = target.getAttribute("data-token");
				if (token) closeUploadSession(token);
			} else if (action === "close-download") {
				const downloadToken = target.getAttribute("data-token");
				if (downloadToken) closeDownloadLink(downloadToken);
			} else if (action === "kill-terminal") {
				const terminalId = target.getAttribute("data-terminal-id");
				if (terminalId) killTerminal(terminalId);
			} else if (action === "delete-workspace") {
				const workspace = target.getAttribute("data-workspace");
				if (workspace) deleteWorkspace(workspace);
			}
		});
	}
	attachActionHandlers();
	refreshOverview();

//#endregion
})();