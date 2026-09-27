/** Canonical signaling message type names shared with the client. */
export const ClientMessage = {
  CREATE_ROOM: 'create-room',
  JOIN_ROOM: 'join-room',
  LEAVE_ROOM: 'leave-room',
  MEDIA_STATE_CHANGED: 'media-state-changed',
  SCREEN_SHARE_STATE_CHANGED: 'screen-share-state-changed',
  HAND_STATE_CHANGED: 'hand-state-changed',
  CHAT_MESSAGE: 'chat-message',
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'ice-candidate',
  MUTE_REQUEST: 'mute-request',
  REMOVE_PARTICIPANT: 'remove-participant',
  LOCK_ROOM: 'lock-room',
  SET_WAITING_ROOM: 'set-waiting-room',
  ADMIT_PARTICIPANT: 'admit-participant',
  DENY_PARTICIPANT: 'deny-participant',
  END_MEETING: 'end-meeting',
  TRANSFER_HOST: 'transfer-host',
  PING: 'ping',
};

export const ServerMessage = {
  WELCOME: 'welcome',
  ROOM_CREATED: 'room-created',
  ROOM_JOINED: 'room-joined',
  ROOM_STATE: 'room-state',
  ROOM_SETTINGS_CHANGED: 'room-settings-changed',
  ROOM_ERROR: 'room-error',
  PARTICIPANT_JOINED: 'participant-joined',
  PARTICIPANT_LEFT: 'participant-left',
  PARTICIPANT_REMOVED: 'participant-removed',
  WAITING_ROOM_STATE: 'waiting-room-state',
  WAITING_ROOM_UPDATED: 'waiting-room-updated',
  WAITING_ROOM_DENIED: 'waiting-room-denied',
  HOST_CHANGED: 'host-changed',
  MEETING_ENDED: 'meeting-ended',
  MUTE_REQUEST: 'mute-request',
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'ice-candidate',
  MEDIA_STATE_CHANGED: 'media-state-changed',
  SCREEN_SHARE_STATE_CHANGED: 'screen-share-state-changed',
  HAND_STATE_CHANGED: 'hand-state-changed',
  CHAT_MESSAGE: 'chat-message',
  CHAT_SYSTEM: 'chat-system',
  PONG: 'pong',
};

const RELAY_TYPES = new Set([ClientMessage.OFFER, ClientMessage.ANSWER, ClientMessage.ICE_CANDIDATE]);

export const isRelayType = (type) => RELAY_TYPES.has(type);

/** Message types a participant that has not joined a room may still send. */
export const PRE_ROOM_TYPES = new Set([
  ClientMessage.CREATE_ROOM,
  ClientMessage.JOIN_ROOM,
  ClientMessage.PING,
  ClientMessage.LEAVE_ROOM,
]);

export const HOST_ONLY_TYPES = new Set([
  ClientMessage.MUTE_REQUEST,
  ClientMessage.REMOVE_PARTICIPANT,
  ClientMessage.LOCK_ROOM,
  ClientMessage.SET_WAITING_ROOM,
  ClientMessage.ADMIT_PARTICIPANT,
  ClientMessage.DENY_PARTICIPANT,
  ClientMessage.END_MEETING,
  ClientMessage.TRANSFER_HOST,
]);
