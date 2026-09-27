import { useCallback, useEffect, useRef, useState } from 'react';
import { QUALITY_LABELS, Quality } from '../config.js';
import { shortName } from '../utils/initials.js';
import { Avatar, VideoSurface } from './VideoSurface.jsx';
import { Badge, IconButton, cx } from './ui/index.jsx';
import {
  CollapseIcon,
  ExpandIcon,
  HandIcon,
  MicIcon,
  MicOffIcon,
  PinIcon,
  SignalIcon,
  VideoOffIcon,
} from './icons.jsx';

const QUALITY_TONE = {
  [Quality.EXCELLENT]: 'ok',
  [Quality.GOOD]: 'ok',
  [Quality.UNSTABLE]: 'warn',
  [Quality.POOR]: 'warn',
  [Quality.RECONNECTING]: 'warn',
  [Quality.CHECKING]: 'muted',
  [Quality.UNKNOWN]: 'muted',
};

/** Uses the Fullscreen API where available; degrades to a no-op elsewhere. */
const useFullscreen = (ref) => {
  const [active, setActive] = useState(false);
  const supported = typeof document !== 'undefined' && Boolean(document.documentElement.requestFullscreen);

  useEffect(() => {
    if (!supported) return undefined;
    const onChange = () => {
      setActive(document.fullscreenElement === ref.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref, supported]);

  const toggle = useCallback(async () => {
    if (!supported) return false;
    try {
      if (document.fullscreenElement === ref.current) {
        await document.exitFullscreen();
        return false;
      }
      await ref.current?.requestFullscreen?.();
      return true;
    } catch {
      // Browsers reject fullscreen without a user gesture or inside an iframe
      // without allow="fullscreen". The meeting keeps working either way.
      return false;
    }
  }, [ref, supported]);

  return { active, toggle, supported };
};

/**
 * One participant in the grid. The same component renders the local preview
 * and every remote participant - there is no hard-coded tile per person.
 */
export const ParticipantTile = ({
  participant,
  stream,
  isLocal = false,
  quality = Quality.UNKNOWN,
  connectionLabel = null,
  pinned = false,
  compact = false,
  onPin,
  children,
}) => {
  const tileRef = useRef(null);
  const { active: fullscreen, toggle: toggleFullscreen, supported: fullscreenSupported } = useFullscreen(tileRef);

  const displayName = participant?.displayName ?? 'Participant';
  const audioEnabled = isLocal ? participant?.audioEnabled !== false : participant?.audioEnabled !== false;
  const videoEnabled = participant?.videoEnabled !== false;
  const hasVideo = Boolean(stream) && videoEnabled;

  const qualityLabel = connectionLabel ?? QUALITY_LABELS[quality] ?? QUALITY_LABELS[Quality.UNKNOWN];

  return (
    <div
      ref={tileRef}
      className={cx(
        'tile',
        isLocal && 'tile--local',
        hasVideo && 'tile--has-video',
        pinned && 'tile--pinned',
        compact && 'tile--compact',
        fullscreen && 'is-fullscreen',
      )}
      data-participant-id={participant?.participantId ?? 'unknown'}
    >
      <div className="tile__stage">
        {hasVideo ? (
          <VideoSurface
            stream={stream}
            muted={isLocal}
            mirror={isLocal}
            fit="cover"
            label={`${displayName} video`}
          />
        ) : (
          <div className="tile__placeholder">
            <Avatar name={displayName} size={compact ? 'md' : 'xl'} />
            <p className="tile__placeholder-name">{shortName(displayName, 28)}</p>
            {!videoEnabled ? <p className="tile__placeholder-hint">Camera is off</p> : null}
          </div>
        )}
      </div>

      <div className="tile__bar">
        <div className="tile__identity">
          {audioEnabled ? (
            <span className="tile__chip" title="Microphone on" aria-label="Microphone on">
              <MicIcon size={14} />
            </span>
          ) : (
            <span className="tile__chip tile__chip--off" title="Microphone muted" aria-label="Microphone muted">
              <MicOffIcon size={14} />
            </span>
          )}
          {!videoEnabled ? (
            <span className="tile__chip tile__chip--off" title="Camera off" aria-label="Camera off">
              <VideoOffIcon size={14} />
            </span>
          ) : null}
          {participant?.handRaised ? (
            <span className="tile__chip tile__chip--hand" title="Hand raised" aria-label="Hand raised">
              <HandIcon size={14} />
            </span>
          ) : null}
          {participant?.sharingScreen ? (
            <Badge tone="accent" className="tile__badge">
              Presenting
            </Badge>
          ) : null}
          <span className="tile__name" title={displayName}>
            {shortName(displayName, 26)}
          </span>
          {isLocal ? <span className="tile__you">You</span> : null}
          {participant?.isHost ? <span className="tile__host">Host</span> : null}
        </div>

        <div className="tile__actions">
          {!isLocal && quality !== Quality.UNKNOWN ? (
            <span
              className={cx('tile__quality', `tile__quality--${QUALITY_TONE[quality] ?? 'muted'}`)}
              title={`Connection: ${qualityLabel}`}
            >
              <SignalIcon quality={quality} size={14} />
              <span className="visually-hidden">Connection: {qualityLabel}</span>
            </span>
          ) : null}
          {onPin ? (
            <IconButton
              size="xs"
              icon={<PinIcon active={pinned} size={15} />}
              label={pinned ? `Unpin ${displayName}` : `Pin ${displayName}`}
              active={pinned}
              onClick={() => onPin(participant.participantId)}
            />
          ) : null}
          {fullscreenSupported ? (
            <IconButton
              size="xs"
              icon={fullscreen ? <CollapseIcon size={15} /> : <ExpandIcon size={15} />}
              label={fullscreen ? `Exit full screen for ${displayName}` : `Full screen ${displayName}`}
              onClick={toggleFullscreen}
            />
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
};

export { useFullscreen, QUALITY_TONE };
export default ParticipantTile;
