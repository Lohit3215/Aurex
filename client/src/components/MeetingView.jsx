import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCopyToClipboard, useMeeting, useMeetingStatus } from '../context/MeetingContext.jsx';
import { meetingUrl } from '../utils/meetingUrl.js';
import { shortName } from '../utils/initials.js';
import { Quality } from '../config.js';
import { VideoGrid } from './VideoGrid.jsx';
import { ParticipantTile } from './ParticipantTile.jsx';
import { PresentationStage } from './PresentationStage.jsx';
import ControlBar from './meeting/ControlBar.jsx';
import SidePanel from './meeting/SidePanel.jsx';
import { Button, Callout, cx } from './ui/index.jsx';
import { AlertIcon, CheckIcon, CloseIcon, CopyIcon } from './icons.jsx';

/** Hidden <audio> element for a presenter's tab/system audio track. */
const ScreenAudio = ({ peerId, stream, sinkId }) => {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream ?? null;
    if (stream) {
      const attempt = element.play();
      if (attempt?.catch) attempt.catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !sinkId || sinkId === 'default') return;
    if (typeof element.setSinkId === 'function') {
      element.setSinkId(sinkId).catch(() => {});
    }
  }, [sinkId]);

  return <audio ref={ref} autoPlay data-peer-id={peerId} aria-label="Audio from the shared screen" />;
};

const EndScreen = ({ title, message, onHome, onRejoin, showRejoin = true }) => (
  <div className="end-screen">
    <div className="end-screen__card">
      <h1 className="end-screen__title">{title}</h1>
      <p className="end-screen__text">{message}</p>
      <div className="end-screen__actions">
        <Button variant="ghost" onClick={onHome}>
          Back to home
        </Button>
        {showRejoin ? (
          <Button variant="primary" onClick={onRejoin}>
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  </div>
);

const ShareMeetingCard = ({ roomId, onDismiss }) => {
  const url = meetingUrl(roomId);
  const { copy, copied } = useCopyToClipboard();
  return (
    <div className="share-card" role="status">
      <div className="share-card__body">
        <p className="share-card__title">Your meeting is ready</p>
        <p className="share-card__id">
          Meeting ID <strong>{roomId}</strong>
        </p>
        <p className="share-card__url">{url}</p>
      </div>
      <div className="share-card__actions">
        <Button size="sm" variant="ghost" onClick={() => void copy(url)}>
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} aria-label="Dismiss the meeting link card">
          <CloseIcon size={16} />
        </Button>
      </div>
    </div>
  );
};

export const MeetingView = ({ onLeave, showShareCard = false }) => {
  const { state, session, setPinnedParticipant, togglePanel } = useMeeting();
  const navigate = useNavigate();
  const status = useMeetingStatus();
  const [dismissedShare, setDismissedShare] = useState(false);

  const self = state.self;

  const participants = useMemo(
    () =>
      Object.values(state.participants)
        .filter((participant) => participant.participantId !== self?.participantId)
        .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.participantId.localeCompare(b.participantId))
        .map((participant) => ({
          ...participant,
          stream: state.remoteStreams?.[participant.participantId] ?? null,
        })),
    [state.participants, state.remoteStreams, self],
  );

  const localParticipant = self
    ? { ...self, audioEnabled: state.media.audioEnabled, videoEnabled: state.media.videoEnabled }
    : null;

  const presenter = state.presenterParticipantId ? state.participants[state.presenterParticipantId] ?? null : null;
  const presenterStream = state.presenterParticipantId
    ? state.remoteStreams?.[state.presenterParticipantId] ?? null
    : null;

  const pinnedId = state.pinnedParticipantId;
  const pinnedParticipant = pinnedId ? state.participants[pinnedId] ?? null : null;
  const pinnedStream = pinnedId ? state.remoteStreams?.[pinnedId] ?? null : null;

  // While presenting, the presenter is excluded from the filmstrip so the same
  // screen is never rendered twice at a large size.
  const stripParticipants = participants.filter(
    (participant) => participant.participantId !== state.presenterParticipantId,
  );

  useEffect(() => {
    // Release the camera/microphone the moment the tab goes away.
    const onPageHide = () => session.releaseHardware();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [session]);

  if (state.phase === 'ended') {
    return (
      <EndScreen
        title="This meeting has ended"
        message="The host ended the meeting for everyone. Your camera and microphone have been turned off."
        onHome={() => navigate('/')}
        showRejoin={false}
      />
    );
  }
  if (state.phase === 'removed') {
    return (
      <EndScreen
        title="You were removed from the meeting"
        message={state.error?.message ?? 'The host removed you from this meeting.'}
        onHome={() => navigate('/')}
        showRejoin={false}
      />
    );
  }
  if (state.phase === 'denied') {
    return (
      <EndScreen
        title="Not admitted"
        message={state.error?.message ?? 'The host did not admit you to this meeting.'}
        onHome={() => navigate('/')}
        showRejoin={false}
      />
    );
  }
  if (state.phase === 'error') {
    return (
      <EndScreen
        title="Could not join the meeting"
        message={state.error?.message ?? 'Something went wrong while joining.'}
        onHome={() => navigate('/')}
        onRejoin={() => window.location.reload()}
      />
    );
  }

  const gridParticipants = pinnedParticipant
    ? participants.filter((participant) => participant.participantId !== pinnedId)
    : participants;

  return (
    <div className={cx('meeting', state.panel.open && 'meeting--panel-open')}>
      <header className="meeting__bar">
        <div className="meeting__identity">
          <span className="meeting__brand">AUREX MEET</span>
          <span className="meeting__id" title="Meeting ID">
            {state.roomId}
          </span>
        </div>
        <div className="meeting__status">
          <span className={cx('status-pill', `status-pill--${status.tone}`)}>
            <span className="status-pill__dot" aria-hidden="true" />
            {status.label}
          </span>
          {state.signalingStatus === 'reconnecting' || state.signalingStatus === 'offline' ? (
            <span className="meeting__status-detail">{status.detail}</span>
          ) : null}
        </div>
        <div className="meeting__actions">
          <Button size="sm" variant="ghost" onClick={() => togglePanel('participants')}>
            {Object.keys(state.participants).length + 1} in meeting
          </Button>
        </div>
      </header>

      {showShareCard && !dismissedShare && state.roomId ? (
        <ShareMeetingCard roomId={state.roomId} onDismiss={() => setDismissedShare(true)} />
      ) : null}

      {state.notice ? (
        <div className="meeting__notice" role="status">
          <Callout
            tone={state.notice.tone === 'error' ? 'error' : state.notice.tone === 'warning' ? 'warning' : 'info'}
            onDismiss={null}
          >
            {state.notice.message}
          </Callout>
        </div>
      ) : null}

      {state.signalingStatus === 'offline' ? (
        <div className="meeting__banner" role="status">
          <AlertIcon size={16} /> You are offline. AUREX MEET reconnects on its own when your network returns.
        </div>
      ) : null}

      <main className="meeting__stage-area">
        {presenter ? (
          <PresentationStage
            presenter={presenter}
            presenterStream={presenterStream}
            participants={stripParticipants}
            localParticipant={localParticipant}
            localStream={state.localStream}
            pinned={pinnedId === presenter.participantId}
            onPin={setPinnedParticipant}
            onReturnToGrid={() => setPinnedParticipant(state.presenterParticipantId)}
          />
        ) : null}

        {pinnedParticipant && !presenter ? (
          <div className="meeting__pinned">
            <ParticipantTile
              participant={pinnedParticipant}
              stream={pinnedStream}
              quality={state.connection[pinnedId]?.quality ?? Quality.UNKNOWN}
              pinned
              onPin={setPinnedParticipant}
            />
            <p className="meeting__pinned-hint">
              Pinned {shortName(pinnedParticipant.displayName, 24)} ·{' '}
              <button type="button" className="linkish" onClick={() => setPinnedParticipant(pinnedId)}>
                Back to grid
              </button>
            </p>
          </div>
        ) : null}

        <VideoGrid
          count={gridParticipants.length + (localParticipant ? 1 : 0)}
          minTileWidth={150}
          className={cx((presenter || pinnedParticipant) && 'video-grid--strip')}
        >
          {localParticipant ? (
            <ParticipantTile participant={localParticipant} stream={state.localStream} isLocal quality={Quality.UNKNOWN} />
          ) : null}
          {gridParticipants.map((participant) => (
            <ParticipantTile
              key={participant.participantId}
              participant={participant}
              stream={participant.stream}
              quality={state.connection[participant.participantId]?.quality ?? Quality.UNKNOWN}
              onPin={setPinnedParticipant}
            />
          ))}
        </VideoGrid>

        {participants.length === 0 && !presenter ? (
          <p className="meeting__empty">You are the only one here. Share the meeting link to invite somebody.</p>
        ) : null}

        {Object.entries(state.screenAudioStreams ?? {}).map(([peerId, stream]) => (
          <ScreenAudio key={peerId} peerId={peerId} stream={stream} sinkId={state.media.outputDeviceId} />
        ))}
      </main>

      <SidePanel />
      <ControlBar onLeave={onLeave} />
    </div>
  );
};

export { EndScreen, ShareMeetingCard, ScreenAudio };
export default MeetingView;
