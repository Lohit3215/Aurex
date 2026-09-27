/**
 * Structured, user-safe error codes shared with the client.
 * Messages are written for end users; nothing internal is ever exposed.
 */
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
};

export class SignalingError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SignalingError';
    this.code = code;
    this.details = details;
  }
}

export const fail = (code, message, details) => new SignalingError(code, message, details);

export const Errors = {
  roomNotFound: () =>
    fail(ErrorCode.ROOM_NOT_FOUND, 'That meeting does not exist. Check the meeting link and try again.'),
  roomEnded: () => fail(ErrorCode.ROOM_ENDED, 'This meeting has already ended.'),
  roomLocked: () => fail(ErrorCode.ROOM_LOCKED, 'This meeting is locked. No new participants can join right now.'),
  invalidRoomId: () =>
    fail(ErrorCode.INVALID_ROOM_ID, 'That meeting link or ID is not valid. Double-check it and try again.'),
  invalidParticipant: () => fail(ErrorCode.INVALID_PARTICIPANT, 'That participant is no longer in this meeting.'),
  invalidMessage: () => fail(ErrorCode.INVALID_MESSAGE, 'The message could not be understood.'),
  invalidDisplayName: () => fail(ErrorCode.INVALID_DISPLAY_NAME, 'Please enter a display name between 2 and 48 characters.'),
  notInRoom: () => fail(ErrorCode.NOT_IN_ROOM, 'You are not connected to this meeting.'),
  notHost: () => fail(ErrorCode.NOT_HOST, 'Only the meeting host can perform that action.'),
  presenterActive: (name) =>
    fail(ErrorCode.PRESENTER_ACTIVE, `${name || 'Someone'} is already presenting right now.`),
  alreadyInRoom: () => fail(ErrorCode.ALREADY_IN_ROOM, 'This connection already joined the meeting.'),
  payloadTooLarge: () => fail(ErrorCode.PAYLOAD_TOO_LARGE, 'That message is too large to send.'),
  rateLimited: () => fail(ErrorCode.RATE_LIMITED, 'Slow down a moment - too many messages sent too quickly.'),
  serverError: () => fail(ErrorCode.SERVER_ERROR, 'Something went wrong on the meeting server. Please try again.'),
};

export function toClientError(error) {
  if (error instanceof SignalingError) {
    return { code: error.code, message: error.message };
  }
  return { code: ErrorCode.SERVER_ERROR, message: Errors.serverError().message };
}
