/**
 * All local media acquisition lives here so the rest of the app never touches
 * getUserMedia/getDisplayMedia directly. Every failure is translated into a
 * user-facing code (see utils/errors.js) - raw DOMExceptions never escape.
 */
import { createLogger } from '../../utils/logger.js';
import { describeMediaError, ErrorCode } from '../../utils/errors.js';

const log = createLogger('media');

export const supports = {
  getUserMedia: () =>
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === 'function',
  getDisplayMedia: () =>
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function',
  enumerateDevices: () =>
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.enumerateDevices === 'function',
  rtcPeerConnection: () => typeof RTCPeerConnection === 'function',
  setSinkId: () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype,
  replaceTrack: () => typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.prototype.replaceTrack === 'function',
};

export const mediaSupport = () => ({
  getUserMedia: supports.getUserMedia(),
  getDisplayMedia: supports.getDisplayMedia(),
  enumerateDevices: supports.enumerateDevices(),
  peerConnection: supports.rtcPeerConnection(),
  setSinkId: supports.setSinkId(),
  replaceTrack: supports.replaceTrack(),
});

const deviceConstraint = (deviceId, extra = {}) => {
  if (deviceId) return { deviceId: { exact: deviceId }, ...extra };
  return extra;
};

/**
 * Requests microphone + camera, degrading gracefully so a missing camera never
 * stops somebody from joining a meeting with audio.
 *
 * @returns {Promise<{stream: MediaStream, audioTrack: MediaStreamTrack|null,
 *                    videoTrack: MediaStreamTrack|null, degraded: boolean}>}
 */
export async function requestUserMedia({ audioDeviceId, videoDeviceId, audio = true, video = true } = {}) {
  if (!supports.getUserMedia()) {
    const error = new Error('getUserMedia unavailable');
    error.name = 'TypeError';
    throw Object.assign(error, { userFacing: describeMediaError(error, { wantAudio: audio, wantVideo: video }) });
  }

  const attempts = [];
  if (audio && video) {
    attempts.push({
      label: 'audio+video',
      constraints: {
        audio: deviceConstraint(audioDeviceId, { echoCancellation: true, noiseSuppression: true }),
        video: deviceConstraint(videoDeviceId, { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }),
      },
    });
  }
  if (audio) {
    attempts.push({
      label: 'audio-only',
      constraints: { audio: deviceConstraint(audioDeviceId, { echoCancellation: true, noiseSuppression: true }), video: false },
    });
  }
  if (video) {
    attempts.push({
      label: 'video-only',
      constraints: { audio: false, video: deviceConstraint(videoDeviceId, { width: { ideal: 1280 } }) },
    });
  }
  if (!attempts.length) {
    const error = new Error('no media requested');
    error.name = 'NotFoundError';
    throw Object.assign(error, { userFacing: describeMediaError(error, { wantAudio, wantVideo }) });
  }

  let lastError = null;
  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential degradation on purpose
      const stream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
      const result = {
        stream,
        audioTrack: stream.getAudioTracks()[0] ?? null,
        videoTrack: stream.getVideoTracks()[0] ?? null,
        degraded: i > 0,
      };
      log.info('media acquired', { label: attempt.label, degraded: result.degraded });
      return result;
    } catch (error) {
      lastError = error;
      log.warn('media attempt failed', { label: attempt.label, name: error?.name });
      // A permission denial will not improve by asking for less, so stop early.
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') break;
    }
  }

  const described = describeMediaError(lastError, { wantAudio: audio, wantVideo: video });
  log.warn('media failed', { name: lastError?.name, code: described.code });
  throw Object.assign(new Error(described.message), { name: lastError?.name ?? 'MediaError', userFacing: described });
}

/** Opens a single device (used for mid-meeting camera / microphone switching). */
export async function requestSingleTrack(kind, deviceId) {
  if (!supports.getUserMedia()) {
    const error = new Error('unsupported');
    error.name = 'TypeError';
    throw Object.assign(error, { userFacing: describeMediaError(error, { wantAudio: kind === 'audio', wantVideo: kind === 'video' }) });
  }
  const constraints =
    kind === 'audio'
      ? { audio: deviceConstraint(deviceId, { echoCancellation: true, noiseSuppression: true }), video: false }
      : { audio: false, video: deviceConstraint(deviceId, { width: { ideal: 1280 } }) };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    // Retry without pinning the device: it may have been unplugged meanwhile.
    if (deviceId && (error?.name === 'OverconstrainedError' || error?.name === 'NotFoundError')) {
      try {
        return await navigator.mediaDevices.getUserMedia(
          kind === 'audio' ? { audio: true, video: false } : { audio: false, video: true },
        );
      } catch (fallbackError) {
        throw Object.assign(new Error('device failed'), { name: fallbackError?.name, userFacing: describeMediaError(fallbackError) });
      }
    }
    throw Object.assign(new Error('device failed'), { name: error?.name, userFacing: describeMediaError(error) });
  }
}

/**
 * Screen capture. Display audio is requested where the browser offers it
 * (Chrome/Edge share tab audio) but is never required.
 */
export async function requestDisplayMedia({ withAudio = true } = {}) {
  if (!supports.getDisplayMedia()) {
    return { error: { code: ErrorCode.SCREEN_SHARE_FAILED, message: 'Screen sharing is not supported by this browser.' } };
  }
  const video = { frameRate: { ideal: 15, max: 30 } };
  if (withAudio) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: true });
      return { stream };
    } catch (error) {
      if (error?.name === 'NotAllowedError') {
        return { cancelled: true, error: { code: ErrorCode.SCREEN_SHARE_FAILED, message: 'Screen sharing was cancelled.' } };
      }
      log.debug('display audio unavailable, retrying without', { name: error?.name });
    }
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
    return { stream };
  } catch (error) {
    if (error?.name === 'NotAllowedError') {
      return { cancelled: true, error: { code: ErrorCode.SCREEN_SHARE_FAILED, message: 'Screen sharing was cancelled.' } };
    }
    const described = describeMediaError(error, { wantAudio: false, wantVideo: true });
    return { error: { code: ErrorCode.SCREEN_SHARE_FAILED, message: 'Screen sharing could not start.', hint: described.hint } };
  }
}

export function stopStream(stream) {
  if (!stream || typeof stream.getTracks !== 'function') return;
  for (const track of stream.getTracks()) {
    try {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      track.stop();
    } catch {
      /* track already ended */
    }
  }
}

export function stopTrack(track) {
  if (!track) return;
  try {
    track.onended = null;
    track.stop();
  } catch {
    /* track already ended */
  }
}

/**
 * Device labels are only readable after permission has been granted, which is
 * why this is called after getUserMedia. Nothing leaves the browser.
 */
export async function listDevices() {
  if (!supports.enumerateDevices()) return { audioinput: [], videoinput: [], audiooutput: [] };
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const group = (kind) =>
      devices
        .filter((device) => device.kind === kind)
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `${kind === 'audioinput' ? 'Microphone' : kind === 'videoinput' ? 'Camera' : 'Speaker'} ${index + 1}`,
          groupId: device.groupId,
        }));
    return { audioinput: group('audioinput'), videoinput: group('videoinput'), audiooutput: group('audiooutput') };
  } catch (error) {
    log.warn('enumerateDevices failed', { error: error?.message });
    return { audioinput: [], videoinput: [], audiooutput: [] };
  }
}

/** Applies an output device when supported; resolves false when not available. */
export async function setSinkId(element, deviceId) {
  if (!element || !deviceId) return false;
  if (!supports.setSinkId()) return false;
  try {
    await element.setSinkId(deviceId);
    return true;
  } catch (error) {
    log.debug('setSinkId failed', { error: error?.message });
    return false;
  }
}

export const getDisplayMediaUnsupportedReason = () =>
  supports.getDisplayMedia()
    ? null
    : 'This browser does not support screen sharing. Chrome, Edge and Firefox do.';
