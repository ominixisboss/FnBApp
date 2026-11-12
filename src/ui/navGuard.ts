// Lets a page block in-app navigation (e.g. a deck with unsaved changes).
let guard: (() => boolean) | null = null;

export function setNavGuard(fn: (() => boolean) | null) {
  guard = fn;
}

/** Returns true if navigation may proceed. */
export function canLeave(): boolean {
  return guard ? guard() : true;
}

export function downloadText(filename: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFile(file: File): Promise<string> {
  return file.text();
}

export const safeFileName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'deck';
