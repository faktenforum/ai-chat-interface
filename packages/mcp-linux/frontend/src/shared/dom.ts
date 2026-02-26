export function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function setBanner(
  bannerEl: HTMLElement | null,
  type: 'info' | 'error' | 'success' | '' ,
  message: string,
): void {
  if (!bannerEl) return;
  if (!message) {
    bannerEl.className = 'status-banner';
    bannerEl.textContent = '';
    return;
  }
  bannerEl.className = 'status-banner visible ' + type;
  bannerEl.textContent = message;
}

export function escapeHtml(str: unknown): string {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

