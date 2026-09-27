export const SignalingStatus = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  OFFLINE: 'offline',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed',
};

export const MediaState = {
  IDLE: 'idle',
  REQUESTING: 'requesting',
  READY: 'ready',
  PARTIAL: 'partial',
  ERROR: 'error',
  ENDED: 'ended',
};

export const Quality = {
  UNKNOWN: 'unknown',
  CHECKING: 'checking',
  EXCELLENT: 'excellent',
  GOOD: 'good',
  UNSTABLE: 'unstable',
  POOR: 'poor',
  RECONNECTING: 'reconnecting',
};

export const QUALITY_LABELS = {
  [Quality.UNKNOWN]: 'Unknown',
  [Quality.CHECKING]: 'Checking connection',
  [Quality.EXCELLENT]: 'Excellent',
  [Quality.GOOD]: 'Good',
  [Quality.UNSTABLE]: 'Unstable',
  [Quality.POOR]: 'Poor',
  [Quality.RECONNECTING]: 'Reconnecting',
};

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
  CHAT_MESSAGE: 'chat-message',
  CHAT_SYSTEM: 'chat-system',
  PONG: 'pong',
};

export const PHASE = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  PREJOIN: 'prejoin',
  JOINING: 'joining',
  ACTIVE: 'active',
  WAITING: 'waiting',
  ENDED: 'ended',
  REMOVED: 'removed',
  DENIED: 'denied',
  ERROR: 'error',
};

export const PANEL_TAB = {
  NONE: null,
  CHAT: 'chat',
  PARTICIPANTS: 'participants',
  HOST: 'host',
  SETTINGS: 'settings',
};
