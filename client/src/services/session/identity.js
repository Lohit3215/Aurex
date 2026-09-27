const PREFIX = 'aurex.meeting.';

/**
 * Per-tab meeting identity.
 *
 * `sessionStorage` (not localStorage) is deliberate: the display name and the
 * resume token live only for this browser tab, which is exactly the "current
 * session" scope. The resume token is issued by the server - the client can
 * only store and replay it, never mint one.
 */
const safeStorage = () => {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const identityKey = (roomId) => `${PREFIX}identity.${roomId}`;
const nameKey = 'aurex.displayName';

export function saveIdentity(roomId, identity) {
  const storage = safeStorage();
  if (!storage || !roomId) return;
  try {
    storage.setItem(
      identityKey(roomId),
      JSON.stringify({
        participantId: identity.participantId ?? null,
        resumeToken: identity.resumeToken ?? null,
        displayName: identity.displayName ?? '',
        savedAt: Date.now(),
      }),
    );
  } catch {
    /* storage full or blocked - the meeting still works, it just cannot resume */
  }
}

export function readIdentity(roomId) {
  const storage = safeStorage();
  if (!storage || !roomId) return null;
  try {
    const raw = storage.getItem(identityKey(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.resumeToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearIdentity(roomId) {
  const storage = safeStorage();
  if (!storage || !roomId) return;
  try {
    storage.removeItem(identityKey(roomId));
  } catch {
    /* ignore */
  }
}

export function rememberDisplayName(displayName) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(nameKey, String(displayName ?? '').slice(0, 48));
  } catch {
    /* ignore */
  }
}

export function recallDisplayName() {
  const storage = safeStorage();
  if (!storage) return '';
  try {
    return storage.getItem(nameKey) ?? '';
  } catch {
    return '';
  }
}
