/** Client-visible error codes. Mirrors the server's vocabulary exactly. */
export const ErrorCode = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_LOCKED: 'ROOM_LOCKED',
  ROOM_ENDED: 'ROOM_ENDED',
  WAITING_FOR_ADMISSION: 'WAITING_FOR_ADMISSION',
  WAITING_ROOM_DISABLED: 'WAITING_ROOM_DISABLED',
  INVALID_ROOM_ID: 'INVALID_ROOM_ID',
  INVALID_PARTICIPANT: 'INVALID_PARTICIPANT',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  INVALID_DISPLAY_NAME: 'INVALID_DISPLAY_NAME',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  NOT_HOST: 'NOT_HOST',
  PRESENTER_ACTIVE: 'PRESENTER_ACTIVE',
  ALREADY_IN_ROOM: 'ALREADY_IN_ROOM',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  SERVER_ERROR: 'SERVER_ERROR',
  DEVICE_PERMISSION_DENIED: 'DEVICE_PERMISSION_DENIED',
  DEVICE_UNAVAILABLE: 'DEVICE_UNAVAILABLE',
  SCREEN_SHARE_FAILED: 'SCREEN_SHARE_FAILED',
  MEDIA_FAILED: 'MEDIA_FAILED',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
};

const MESSAGES = {
  [ErrorCode.ROOM_NOT_FOUND]: 'That meeting does not exist. Check the meeting link and try again.',
  [ErrorCode.ROOM_LOCKED]: 'This meeting is locked. The host has not let new participants in yet.',
  [ErrorCode.ROOM_ENDED]: 'This meeting has ended.',
  [ErrorCode.WAITING_FOR_ADMISSION]: 'Waiting for the host to let you in.',
  [ErrorCode.WAITING_ROOM_DISABLED]: 'The waiting room is no longer enabled.',
  [ErrorCode.INVALID_ROOM_ID]: 'That meeting link or ID is not valid. Double-check it and try again.',
  [ErrorCode.INVALID_PARTICIPANT]: 'That participant is no longer in this meeting.',
  [ErrorCode.INVALID_MESSAGE]: 'Something went wrong sending that. Please try again.',
  [ErrorCode.INVALID_DISPLAY_NAME]: 'Please enter a display name between 2 and 48 characters.',
  [ErrorCode.NOT_IN_ROOM]: 'You are not connected to this meeting.',
  [ErrorCode.NOT_HOST]: 'Only the meeting host can do that.',
  [ErrorCode.PRESENTER_ACTIVE]: 'Someone is already presenting right now.',
  [ErrorCode.ALREADY_IN_ROOM]: 'You are already in this meeting.',
  [ErrorCode.PAYLOAD_TOO_LARGE]: 'That message is too long to send.',
  [ErrorCode.RATE_LIMITED]: 'Slow down a moment - too many messages sent too quickly.',
  [ErrorCode.CONNECTION_FAILED]: 'Could not reach the meeting server.',
  [ErrorCode.SERVER_ERROR]: 'The meeting server ran into a problem. Please try again.',
  [ErrorCode.DEVICE_PERMISSION_DENIED]: 'Camera or microphone access was blocked. Allow it in your browser settings.',
  [ErrorCode.DEVICE_UNAVAILABLE]: 'No camera or microphone was found on this device.',
  [ErrorCode.SCREEN_SHARE_FAILED]: 'Screen sharing could not start.',
  [ErrorCode.MEDIA_FAILED]: 'Your camera or microphone could not be started.',
  [ErrorCode.NETWORK_OFFLINE]: 'You appear to be offline.',
};

export const messageFor = (code, fallback) => MESSAGES[code] ?? fallback ?? MESSAGES[ErrorCode.SERVER_ERROR];

/**
 * Translates raw browser media errors into something a person can act on.
 * Never returns a stack trace or a raw DOMException message by default.
 */
export function describeMediaError(error, { wantVideo = true, wantAudio = true } = {}) {
  const name = error?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return {
        code: ErrorCode.DEVICE_PERMISSION_DENIED,
        message: MESSAGES[ErrorCode.DEVICE_PERMISSION_DENIED],
        hint: 'Use the camera / microphone icon in your address bar to allow access, then try again.',
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        code: ErrorCode.DEVICE_UNAVAILABLE,
        message: wantVideo && wantAudio
          ? 'No camera or microphone matching your request was found.'
          : wantVideo
            ? 'No camera was found on this device.'
            : 'No microphone was found on this device.',
        hint: 'Connect a device, or pick a different one in Settings once you are in the meeting.',
      };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        code: ErrorCode.DEVICE_UNAVAILABLE,
        message: 'Your camera or microphone is busy in another app.',
        hint: 'Close other apps or tabs using the camera, then try again.',
      };
    case 'TypeError':
      return {
        code: ErrorCode.MEDIA_FAILED,
        message: 'This browser cannot access camera or microphone over this connection.',
        hint: 'A secure context (https or localhost) is required.',
      };
    default:
      return {
        code: ErrorCode.MEDIA_FAILED,
        message: MESSAGES[ErrorCode.MEDIA_FAILED],
        hint: error?.message ? `Details: ${error.message}` : undefined,
      };
  }
}

export class AppError extends Error {
  constructor(code, message, hint) {
    super(message ?? messageFor(code));
    this.name = 'AppError';
    this.code = code;
    this.hint = hint;
  }
}

export const appError = (code, hint) => new AppError(code, messageFor(code), hint);
