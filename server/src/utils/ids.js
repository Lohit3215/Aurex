import crypto from 'node:crypto';

// Lower-cased alphabet without look-alike characters (no l, 1, 0, o, u, v).
// Keeps meeting IDs readable when a participant reads them out loud.
export const ALPHABET = 'abcdefghjkmnpqrstwxyz23456789';

/** Matches a canonical meeting ID: exactly `length` characters from the alphabet. */
export const roomIdPattern = (length) => new RegExp(`^[${ALPHABET}]{${length}}$`);

export function randomString(length = 16, alphabet = ALPHABET) {
  const size = Math.max(1, Math.floor(length));
  const bytes = crypto.randomBytes(size * 2 + 8);
  let out = '';
  for (let i = 0; out.length < size && i < bytes.length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out.padEnd(size, alphabet[0]);
}

export const createRoomId = (length = 12) => randomString(length);
export const createParticipantId = () => `p_${randomString(20)}`;
export const createResumeToken = () => randomString(48);
export const createMessageId = () => `m_${randomString(18)}`;
export const createConnectionId = () => `c_${randomString(16)}`;
