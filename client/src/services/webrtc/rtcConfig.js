import { createLogger } from '../../utils/logger.js';

const log = createLogger('rtc:config');

const parseIceServers = () => {
  const raw = import.meta.env?.VITE_ICE_SERVERS;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((entry) => entry && typeof entry === 'object');
    log.warn('VITE_ICE_SERVERS must be a JSON array; ignoring');
  } catch (error) {
    log.warn('VITE_ICE_SERVERS is not valid JSON; ignoring', { error: error?.message });
  }
  return [];
};

const servers = parseIceServers();

/**
 * ICE configuration.
 *
 * The default is deliberately empty: on localhost and a LAN, host candidates
 * alone are enough, so the app runs with zero third-party infrastructure. Set
 * `VITE_ICE_SERVERS` to a JSON array of STUN/TURN entries when you self-host
 * across networks. No paid provider is ever configured automatically.
 */
export const rtcConfig = {
  iceServers: servers,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

export const hasIceServers = servers.length > 0;
export const iceServerSummary = servers.map((entry) => ({
  urls: Array.isArray(entry.urls) ? entry.urls : entry.urls ? [entry.urls] : [],
  hasCredentials: Boolean(entry.username || entry.credential),
}));

export default rtcConfig;
