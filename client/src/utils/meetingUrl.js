const ROOM_ID_LENGTH = 12;
const ALPHABET = 'abcdefghjkmnpqrstwxyz23456789';

export { ROOM_ID_LENGTH };

const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Accepts a bare meeting ID or any meeting link and returns a canonical ID.
 * Kept in sync with the server-side normaliser so a link pasted into the join
 * box behaves the same before and after it is submitted.
 */
export function normalizeRoomId(input, expectedLength = ROOM_ID_LENGTH) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw || raw.length > 2048) return null;

  let candidate = raw;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate) || candidate.startsWith('/')) {
    const fromQuery = /[?&](?:room|meeting|meetingId|roomId)=([^&#]+)/i.exec(candidate);
    if (fromQuery) {
      candidate = safeDecode(fromQuery[1]);
    } else {
      const pathname = candidate.split(/[?#]/)[0];
      const segments = pathname
        .split('/')
        .map(safeDecode)
        .filter(Boolean)
        .filter((segment) => !segment.includes(':'));
      const anchor = segments.findIndex((segment) => /^(meeting|join)$/i.test(segment));
      candidate = anchor >= 0 ? (segments[anchor + 1] ?? '') : (segments[segments.length - 1] ?? '');
    }
  }

  candidate = candidate.toLowerCase().replace(/^-+|-+$/g, '').replace(/[\s_-]+/g, '');
  const stripped = [...candidate].filter((char) => ALPHABET.includes(char)).join('');
  return new RegExp(`^[${ALPHABET}]{${expectedLength}}$`).test(stripped) ? stripped : null;
}

export const isValidRoomId = (input) => normalizeRoomId(input) !== null;

export const publicOrigin = () => {
  const configured = import.meta.env?.VITE_PUBLIC_ORIGIN;
  if (typeof configured === 'string' && configured.trim()) return configured.trim().replace(/\/+$/, '');
  if (typeof window === 'undefined') return '';
  return window.location.origin;
};

export const meetingPath = (roomId) => `/meeting/${roomId}`;

export const meetingUrl = (roomId) => `${publicOrigin()}${meetingPath(roomId)}`;

export const looksLikeMeetingLink = (value) =>
  typeof value === 'string' && /^(https?:\/\/|\/)/i.test(value.trim());
