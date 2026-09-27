import { useRef } from 'react';
import { ParticipantTile, useFullscreen } from './ParticipantTile.jsx';
import { Avatar, VideoSurface } from './VideoSurface.jsx';
import { Badge, IconButton, Spinner, cx } from './ui/index.jsx';
import { CloseIcon, CollapseIcon, ExpandIcon, MicOffIcon, PinIcon } from './icons.jsx';
import { shortName } from '../utils/initials.js';

/**
 * Presentation layout: the presenter's screen is the primary content while
 * everybody else stays visible in a filmstrip. The presenter is excluded from
 * the filmstrip so the same screen is never shown twice at a large size.
 */
export const PresentationStage = ({
  presenter,
  presenterStream,
  participants,
  localParticipant,
  localStream,
  pinned,
  onPin,
  onReturnToGrid,
}) => {
  const stageRef = useRef(null);
  const { active: fullscreen, toggle: toggleFullscreen, supported: fullscreenSupported } = useFullscreen(stageRef);

  const presenterName = presenter?.displayName ?? 'Presenter';
  const showLocalPip =
    localParticipant &&
    localParticipant.participantId === presenter?.participantId &&
    localParticipant.videoEnabled !== false &&
    Boolean(localStream);

  return (
    <div className={cx('stage', fullscreen && 'is-fullscreen')} ref={stageRef}>
      <div className="stage__main">
        <div className="stage__screen">
          {presenterStream ? (
            <VideoSurface stream={presenterStream} muted={false} fit="contain" label={`${presenterName} shared screen`} />
          ) : (
            <div className="stage__waiting">
              <Spinner />
              <p>Waiting for {shortName(presenterName, 24)}'s screen…</p>
            </div>
          )}
        </div>

        {showLocalPip ? (
          <div className="stage__pip">
            <ParticipantTile
              participant={localParticipant}
              stream={localStream}
              isLocal
              compact
              quality="unknown"
            />
          </div>
        ) : null}

        <div className="stage__toolbar">
          <Badge tone="accent">{shortName(presenterName, 28)} is presenting</Badge>
          <div className="stage__toolbar-actions">
            <IconButton
              size="sm"
              icon={<PinIcon active={pinned} size={16} />}
              label={pinned ? 'Unpin the presentation' : 'Pin the presentation'}
              active={pinned}
              onClick={() => onPin?.(presenter?.participantId)}
            />
            {fullscreenSupported ? (
              <IconButton
                size="sm"
                icon={fullscreen ? <CollapseIcon size={16} /> : <ExpandIcon size={16} />}
                label={fullscreen ? 'Exit presentation full screen' : 'Presentation full screen'}
                onClick={toggleFullscreen}
              />
            ) : null}
            <IconButton size="sm" icon={<CloseIcon size={16} />} label="Return to the participant grid" onClick={onReturnToGrid} />
          </div>
        </div>
      </div>

      <aside className="stage__strip" aria-label="Other participants">
        {participants.length === 0 ? (
          <p className="stage__strip-empty">You are the only one here.</p>
        ) : (
          <ul className="stage__strip-list">
            {participants.map((participant) => (
              <li key={participant.participantId} className="stage__strip-item">
                {participant.videoEnabled && participant.stream ? (
                  <VideoSurface
                    stream={participant.stream}
                    muted={false}
                    fit="cover"
                    label={`${participant.displayName} video`}
                  />
                ) : (
                  <div className="stage__strip-avatar">
                    <Avatar name={participant.displayName} size="sm" />
                  </div>
                )}
                <span className="stage__strip-meta">
                  <span className="stage__strip-name">{shortName(participant.displayName, 16)}</span>
                  {participant.audioEnabled === false ? <MicOffIcon size={12} /> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
};

export default PresentationStage;
