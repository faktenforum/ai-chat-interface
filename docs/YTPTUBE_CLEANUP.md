# YTPTube: Archive and Downloads Cleanup

Where YTPTube stores data in this project and how to clean it for a fresh test run.

## Where data lives (this setup)

From `docker-compose.ytptube.yml` and YTPTube config (dev/ytptube, FAQ.md):

| What | Volume (compose) | In container | Notes |
|------|------------------|--------------|--------|
| **Config (DB, archive)** | `ytptube_config` | `/config` | Default `YTP_CONFIG_PATH=/config` in image. |
| **Downloads (files)** | `ytptube_downloads` | `/downloads` | Default `YTP_DOWNLOAD_PATH=/downloads` in image. |

Inside **config** (`/config`):

- **`ytptube.db`** – SQLite database (history, queue, done).
- **`archive.log`** – yt-dlp download archive (one line per downloaded video ID; prevents re-download).

Inside **downloads** (`/downloads`):

- All downloaded files (e.g. `downloads/<id>.mp3`, `downloads/<id>.mp4` depending on folder/preset).

## Option 1: Clean via API (history + optional files)

- **Endpoint:** `DELETE /api/history` (see dev/ytptube/API.md).
- **Body examples:**
  - Delete all **finished** items from history (and files only if `YTP_REMOVE_FILES=true`):
    ```json
    { "type": "done", "status": "finished", "remove_file": true }
    ```
  - Delete **all done** items (any status):
    ```json
    { "type": "done", "status": "!finished", "remove_file": false }
    ```
    then again with `"status": "finished"` if you want finished ones too.
  - Or delete by specific IDs: `{ "type": "done", "ids": ["id1", "id2"], "remove_file": true }`.

**Important:** File deletion only happens if **`YTP_REMOVE_FILES=true`** is set (default in YTPTube is `false`). Our `docker-compose.ytptube.yml` does not set it; add it under `environment:` if you want API deletes to remove files.

**Archive:** Deleting history via this endpoint **does not** clear `archive.log`. IDs remain in the archive, so yt-dlp will still consider those videos “already downloaded.” For a full reset (e.g. to re-download the same URL), use Option 2 or clear the archive file.

## Option 2: Full reset (config + downloads) – recommended for clean tests

Stop the container, clear the volumes, then start again.

1. **Stop YTPTube:**
   ```bash
   docker compose -f docker-compose.ytptube.yml down
   ```

2. **Clear config (DB + archive) and downloads:**
   - With **named volumes** (as in our compose), use a temporary container to delete contents. Replace `<project>` with your compose project name (often the repo directory name); Docker prefixes volume names with it (e.g. `ai-chat-interface_ytptube_config`).
   ```bash
   # List volumes to get exact names
   docker volume ls | grep ytptube

   # Remove DB and archive (config volume)
   docker run --rm -v <project>_ytptube_config:/config alpine sh -c 'rm -f /config/ytptube.db /config/archive.log'

   # Remove all downloaded files (downloads volume)
   docker run --rm -v <project>_ytptube_downloads:/downloads alpine sh -c 'rm -rf /downloads/*'
   ```

3. **Start YTPTube again:**
   ```bash
   docker compose -f docker-compose.ytptube.yml up -d
   ```

After this, history is empty, the archive is empty, and downloads are gone – new jobs will not be affected by old data.

## Option 3: Only clear the download archive (keep history, keep files)

If you only want yt-dlp to allow re-downloading the same URLs again:

1. Stop YTPTube.
2. Delete only the archive file:
   ```bash
   docker run --rm -v <project>_ytptube_config:/config alpine sh -c 'rm -f /config/archive.log'
   ```
3. Start YTPTube.

History and existing files stay; only the “already downloaded” list is cleared.

## Summary

- **Archive** = `archive.log` in the **config** volume (`/config`); **History** = `ytptube.db` in the same volume; **Downloads** = files in the **downloads** volume (`/downloads`).
- **API** (`DELETE /api/history`) clears history (and optionally files if `YTP_REMOVE_FILES=true`); it does **not** clear `archive.log`.
- **Full reset for tests:** stop container, remove `ytptube.db` and `archive.log` from config volume and contents of downloads volume, then start container (Option 2).
