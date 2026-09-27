import { Quality } from '../../config.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('quality');

/**
 * Turns real RTCPeerConnection statistics into a small set of human states.
 * Nothing here invents numbers: when the browser has not reported enough data
 * yet the state is "checking", never a guess.
 */
const RANK = {
  [Quality.CHECKING]: 0,
  [Quality.UNKNOWN]: 0,
  [Quality.POOR]: 1,
  [Quality.UNSTABLE]: 2,
  [Quality.GOOD]: 3,
  [Quality.EXCELLENT]: 4,
  [Quality.RECONNECTING]: 0,
};

export function classify({ rtt, lossRatio, jitter, available }) {
  if (!available) return { quality: Quality.CHECKING, rtt: null, lossRatio: null, jitter: null };
  const hasRtt = typeof rtt === 'number' && Number.isFinite(rtt);
  const hasLoss = typeof lossRatio === 'number' && Number.isFinite(lossRatio);
  if (!hasRtt && !hasLoss) return { quality: Quality.CHECKING, rtt: null, lossRatio: null, jitter: null };

  const r = hasRtt ? rtt : null;
  const l = hasLoss ? lossRatio : null;

  if ((l !== null && l >= 0.15) || (r !== null && r >= 0.6)) return { quality: Quality.POOR, rtt: r, lossRatio: l, jitter: jitter ?? null };
  if ((l !== null && l >= 0.06) || (r !== null && r >= 0.28)) {
    return { quality: Quality.UNSTABLE, rtt: r, lossRatio: l, jitter: jitter ?? null };
  }
  if ((l !== null && l >= 0.02) || (r !== null && r >= 0.12)) return { quality: Quality.GOOD, rtt: r, lossRatio: l, jitter: jitter ?? null };
  return { quality: Quality.EXCELLENT, rtt: r, lossRatio: l, jitter: jitter ?? null };
}

/**
 * Short history + hysteresis so a single noisy sample cannot flip the UI
 * between Good and Poor. Downgrades need two consecutive bad samples,
 * upgrades need three good ones.
 */
export class QualityTracker {
  #samples = [];

  #current = Quality.CHECKING;

  #consecutiveGood = 0;

  #consecutiveBad = 0;

  constructor({ historySize = 6 } = {}) {
    this.historySize = historySize;
  }

  get current() {
    return this.#current;
  }

  push(sample) {
    const next = sample.quality ?? Quality.CHECKING;
    this.#samples.push(sample);
    if (this.#samples.length > this.historySize) this.#samples.shift();

    if (next === Quality.CHECKING) {
      this.#consecutiveGood = 0;
      this.#consecutiveBad = 0;
      this.#current = Quality.CHECKING;
      return this.#current;
    }

    const worse = RANK[next] < RANK[this.#current];
    const better = RANK[next] > RANK[this.#current];

    if (worse) {
      this.#consecutiveBad += 1;
      this.#consecutiveGood = 0;
      if (this.#consecutiveBad >= 2 || this.#current === Quality.CHECKING) {
        this.#current = next;
        log.debug('quality downgraded', { quality: next });
      }
      return this.#current;
    }

    if (better) {
      this.#consecutiveGood += 1;
      this.#consecutiveBad = 0;
      if (this.#consecutiveGood >= 3) this.#current = next;
      return this.#current;
    }

    this.#consecutiveGood = 0;
    this.#consecutiveBad = 0;
    return this.#current;
  }

  history() {
    return [...this.#samples];
  }

  reset() {
    this.#samples = [];
    this.#current = Quality.CHECKING;
    this.#consecutiveGood = 0;
    this.#consecutiveBad = 0;
  }
}

/** Extracts the useful numbers from one getStats() report. */
export function readStats(report) {
  let rtt = null;
  let available = false;
  let inboundPackets = 0;
  let inboundLost = 0;
  let jitter = null;
  let bytesReceived = 0;
  let bytesSent = 0;
  let packetsSent = 0;

  report.forEach((stat) => {
    switch (stat.type) {
      case 'candidate-pair': {
        if (stat.state !== 'succeeded' && stat.nominated !== true) break;
        if (typeof stat.currentRoundTripTime === 'number') {
          rtt = stat.currentRoundTripTime;
          available = true;
        }
        break;
      }
      case 'local-candidate':
      case 'remote-candidate': {
        if (stat.state === 'succeeded' && stat.currentRoundTripTime === undefined) available = available || false;
        break;
      }
      case 'inbound-rtp': {
        if (stat.kind === 'video' || stat.kind === 'audio') {
          const received = stat.packetsReceived ?? 0;
          const lost = stat.packetsLost ?? 0;
          inboundPackets += received;
          inboundLost += lost;
          if (typeof stat.jitter === 'number' && (jitter === null || stat.jitter > jitter)) jitter = stat.jitter;
          if (typeof stat.bytesReceived === 'number') bytesReceived += stat.bytesReceived;
        }
        break;
      }
      case 'outbound-rtp': {
        if (typeof stat.bytesSent === 'number') bytesSent += stat.bytesSent;
        if (typeof stat.packetsSent === 'number') packetsSent += stat.packetsSent;
        break;
      }
      case 'transport':
      default:
        break;
    }
  });

  const totalInbound = inboundPackets + inboundLost;
  const lossRatio = totalInbound > 0 ? inboundLost / totalInbound : null;
  if (totalInbound > 20) available = true;

  return { rtt, lossRatio, jitter, available, bytesReceived, bytesSent, packetsSent, packetsReceived: inboundPackets };
}

export default QualityTracker;
