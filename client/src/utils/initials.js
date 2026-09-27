/** Deterministic, locally generated avatar helpers. No external avatar API. */

const PALETTE = [
  { bg: '#e8ded1', fg: '#4a3f31' },
  { bg: '#dfe4e6', fg: '#2f3f47' },
  { bg: '#e6e1ec', fg: '#3f3550' },
  { bg: '#eae2d6', fg: '#55402a' },
  { bg: '#dde7e0', fg: '#2c4a3a' },
  { bg: '#ecdfe0', fg: '#55303a' },
  { bg: '#e3e6ef', fg: '#333c5c' },
  { bg: '#eee6dc', fg: '#5a4530' },
];

/** Stable hash so a given name always gets the same colours. */
function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function initialsFor(displayName = '') {
  const parts = String(displayName)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const word = [...parts[0]];
    return (word.length > 1 ? word[0] + word[1] : word[0]).toUpperCase();
  }
  return ([...parts[0]][0] + [...parts[parts.length - 1]][0]).toUpperCase();
}

export function avatarColors(displayName = '') {
  return PALETTE[hash(String(displayName || '?')) % PALETTE.length];
}

export function shortName(displayName = '', max = 22) {
  const name = String(displayName || '').trim();
  if (name.length <= max) return name;
  return `${name.slice(0, Math.max(1, max - 1))}…`;
}
