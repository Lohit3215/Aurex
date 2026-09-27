import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import MeetingSession from '../services/session/MeetingSession.js';

const MeetingContext = createContext(null);

const EMPTY = {
  phase: 'idle',
  roomId: null,
  self: null,
  participants: {},
  remoteStreams: {},
  screenAudioStreams: {},
  hostParticipantId: null,
  locked: false,
  waitingRoomEnabled: false,
  presenterParticipantId: null,
  waiting: [],
  chat: [],
  unread: 0,
  signalingStatus: 'idle',
  reconnectAttempts: 0,
  serverReachable: null,
  localStream: null,
  media: {
    audioEnabled: true,
    videoEnabled: true,
    hasAudio: false,
    hasVideo: false,
    state: 'idle',
    devices: { audioinput: [], videoinput: [], audiooutput: [] },
    outputDeviceId: 'default',
    error: null,
  },
  connection: {},
  screenShare: { supported: false, unsupportedReason: null, sharing: false, presenting: false },
  panel: { open: false, tab: null },
  pinnedParticipantId: null,
  notice: null,
  error: null,
  deviceSupport: {},
  mediaRecovered: false,
};

/**
 * Owns the single MeetingSession for the app and mirrors its authoritative
 * state into React. Components read state and call intents - they never touch
 * signaling or WebRTC directly.
 */
export function MeetingProvider({ children }) {
  const sessionRef = useRef(null);
  if (sessionRef.current === null) sessionRef.current = new MeetingSession();

  const [state, setState] = useState(EMPTY);
  const session = sessionRef.current;

  useEffect(() => {
    const off = session.on('change', (patch) => {
      setState((previous) => ({ ...previous, ...patch }));
    });
    return off;
  }, [session]);

  // Development aid: inspect the live session from the browser console.
  useEffect(() => {
    if (!import.meta.env.DEV && import.meta.env.VITE_DEBUG !== 'true') return undefined;
    window.__AUREX__ = {
      session,
      peers: session.peers,
      signaling: session.signaling,
      getState: () => session.state,
      peersDebug: () => session.peers.debugSnapshot(),
      peerStats: () => session.peers.peerStats(),
    };
    return () => {
      delete window.__AUREX__;
    };
  }, [session]);

  const actions = useMemo(
    () => ({
      connect: () => session.connect(),
      createMeeting: (payload) => session.createMeeting(payload),
      joinMeeting: (payload) => session.joinMeeting(payload),
      prepareMedia: (payload) => session.prepareMedia(payload),
      leave: (payload) => session.leave(payload),
      setMicrophone: (value) => session.setMicrophone(value),
      toggleMicrophone: () => session.toggleMicrophone(),
      setCamera: (value) => session.setCamera(value),
      toggleCamera: () => session.toggleCamera(),
      switchDevice: (kind, deviceId) => session.switchDevice(kind, deviceId),
      setOutputDevice: (deviceId) => session.setOutputDevice(deviceId),
      refreshDevices: () => session.refreshDevices(),
      startScreenShare: () => session.startScreenShare(),
      stopScreenShare: () => session.stopScreenShare(),
      toggleHand: () => session.toggleHand(),
      sendChat: (text) => session.sendChat(text),
      clearChat: () => session.clearChat(),
      setPanel: (open, tab) => session.setPanel(open, tab),
      togglePanel: (tab) => session.togglePanel(tab),
      setPinnedParticipant: (id) => session.setPinnedParticipant(id),
      clearNotice: () => session.clearNotice(),
      host: {
        requestMute: (id) => session.requestMute(id),
        removeParticipant: (id) => session.removeParticipant(id),
        setLocked: (value) => session.setLocked(value),
        setWaitingRoomEnabled: (value) => session.setWaitingRoomEnabled(value),
        admitParticipant: (id) => session.admitParticipant(id),
        denyParticipant: (id) => session.denyParticipant(id),
        transferHost: (id) => session.transferHost(id),
        endMeeting: () => session.endMeeting(),
      },
    }),
    [session],
  );

  const value = useMemo(() => ({ state, session, ...actions }), [state, session, actions]);
  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>;
}

export function useMeeting() {
  const context = useContext(MeetingContext);
  if (!context) throw new Error('useMeeting must be used inside <MeetingProvider>');
  return context;
}

/** Stable, ordered participant list. Never keyed by array index. */
export function useParticipants() {
  const { state } = useMeeting();
  return useMemo(() => {
    const selfId = state.self?.participantId ?? null;
    return Object.values(state.participants)
      .filter((participant) => participant.participantId !== selfId)
      .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.participantId.localeCompare(b.participantId));
  }, [state.participants, state.self]);
}

export function useMeetingStatus() {
  const { state } = useMeeting();
  return useMemo(() => deriveMeetingStatus(state), [state]);
}

/**
 * Single user-facing summary of the meeting's health. Signaling and media are
 * reported separately because they genuinely fail independently.
 */
export function deriveMeetingStatus(state) {
  const signaling = state.signalingStatus;
  if (signaling === 'offline') return { tone: 'danger', label: 'Offline', detail: 'No network connection' };
  if (signaling === 'reconnecting') {
    return {
      tone: 'warn',
      label: 'Reconnecting',
      detail: state.reconnectAttempts ? `Attempt ${state.reconnectAttempts}` : 'Reaching the meeting server',
    };
  }
  if (signaling === 'failed') return { tone: 'danger', label: 'Connection failed', detail: 'Cannot reach the meeting server' };
  if (signaling !== 'connected') return { tone: 'warn', label: 'Connecting', detail: 'Starting the signaling connection' };

  const connections = Object.values(state.connection);
  if (!connections.length) return { tone: 'ok', label: 'Connected', detail: 'Waiting for other participants' };
  if (connections.some((entry) => entry.connection === 'failed')) {
    return { tone: 'danger', label: 'Connection lost', detail: 'One or more peer connections failed' };
  }
  if (connections.some((entry) => entry.connection === 'disconnected' || entry.quality === 'reconnecting')) {
    return { tone: 'warn', label: 'Connection unstable', detail: 'Trying to restore the media path' };
  }
  if (connections.some((entry) => entry.quality === 'poor')) {
    return { tone: 'warn', label: 'Poor connection', detail: 'Some participants have an unstable link' };
  }
  if (connections.some((entry) => entry.connection === 'connecting' || entry.quality === 'checking')) {
    return { tone: 'warn', label: 'Connecting', detail: 'Setting up peer connections' };
  }
  return { tone: 'ok', label: 'Connected', detail: `${connections.length} peer connection${connections.length === 1 ? '' : 's'}` };
}

/** Copies text and reports success for a short while, without a timer leak. */
export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);
  const supported =
    typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(
    async (text) => {
      if (!text) return false;
      let ok = false;
      try {
        if (supported) {
          await navigator.clipboard.writeText(text);
          ok = true;
        } else {
          // Fallback for insecure contexts / older browsers.
          const area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          ok = document.execCommand('copy');
          document.body.removeChild(area);
        }
      } catch {
        ok = false;
      }
      if (ok) {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), resetMs);
      }
      return ok;
    },
    [resetMs, supported],
  );

  return { copy, copied, supported };
}

export { MeetingContext };
