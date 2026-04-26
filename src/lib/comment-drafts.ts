// localStorage-backed draft slot used by comment composers (CommentInput
// and CommentThread's reply box). Keys are derived per anchor / per
// reply-target so unrelated drafts don't collide. Failures (SSR / quota /
// privacy mode) silently fall back to an in-memory map so the composer
// keeps working — see Group E (issue #71 iter 5).

const memoryDrafts = new Map<string, string>();

export function readDraft(key: string): string {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    // fall through
  }
  return memoryDrafts.get(key) ?? "";
}

export function writeDraft(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    return;
  } catch {
    // localStorage failed — fall back to memory map.
  }
  memoryDrafts.set(key, value);
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  memoryDrafts.delete(key);
}
