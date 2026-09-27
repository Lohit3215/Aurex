import { ALPHABET, roomIdPattern } from './ids.js';

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

export const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asString = (value) => (typeof value === 'string' ? value : '');

export const clampString = (value, max) => (value.length > max ? value.slice(0, max) : value);

/**
 * Removes control characters / zero-width characters and collapses runs of
 * blank space. Chat content is rendered as plain text on the client, but we
 * still normalise it so log output and storage stay clean.
 */
export function sanitizeText(input, { maxLength = 2000, allowNewlines = true } = {}) {
  const text = asString(input).replace(ZERO_WIDTH, '').replace(CONTROL_CHARS, '');
  const cleaned = allowNewlines ? text.replace(/\r\n/g, '\n') : text.replace(/[\r\n\t]+/g, ' ');
  return clampString(cleaned.replace(/[ \t]+/g, ' ').trim(), maxLength);
}

export function normalizeDisplayName(input, { min = 2, max = 48 } = {}) {
  const collapsed = asString(input).replace(ZERO_WIDTH, '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (collapsed.length < min || collapsed.length > max) {
    return { ok: false, value: '', reason: 'length' };
  }
  return { ok: true, value: collapsed };
}

/**
 * Accepts either a bare meeting ID or a full meeting URL and returns a
 * canonical lower-case ID, or `null` when the input cannot be one.
 */
export function normalizeRoomId(input, expectedLength) {
  const raw = asString(input).trim();
  if (!raw || raw.length > 2048) return null;

  let candidate = raw;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate) || candidate.startsWith('/')) {
    // Pull the meeting ID out of any path shape: /meeting/:id, /join/:id, /?room=id...
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

  candidate = candidate.trim().toLowerCase().replace(/^-+|-+$/g, '');
  if (!candidate) return null;
  // Tolerate group separators people add when reading an ID out loud.
  candidate = candidate.replace(/[\s_-]+/g, '');
  const stripped = [...candidate].filter((char) => ALPHABET.includes(char)).join('');
  if (!roomIdPattern(expectedLength).test(stripped)) return null;
  return stripped;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isCanonicalRoomId(value, expectedLength) {  return typeof value === 'string' && roomIdPattern(expectedLength).test(value);
}

/** Validates the shape of an SDP blob relayed between two participants. */
export function isSessionDescription(value) {
  if (!isPlainObject(value)) return false;
  if (value.type !== 'offer' && value.type !== 'answer') return false;
  return typeof value.sdp === 'string' && value.sdp.length > 0 && value.sdp.length <= 200_000;
}

/** Validates the shape of a single ICE candidate blob. */
export function isIceCandidate(value) {
  if (!isPlainObject(value)) return false;
  if (typeof value.candidate !== 'string' || value.candidate.length === 0) return false;
  if (value.candidate.length > 4096) return false;
  if (value.sdpMid !== undefined && value.sdpMid !== null && typeof value.sdpMid !== 'string') return false;
  if (value.sdpMLineIndex !== undefined && value.sdpMLineIndex !== null) {
    if (typeof value.sdpMLineIndex !== 'number' || !Number.isInteger(value.sdpMLineIndex) || value.sdpMLineIndex < 0) {
      return false;
    }
  }
  if (value.usernameFragment !== undefined && value.usernameFragment !== null) {
    if (typeof value.usernameFragment !== 'string' || value.usernameFragment.length > 256) return false;
  }
  return true;
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
