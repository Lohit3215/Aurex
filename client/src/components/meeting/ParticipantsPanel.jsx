import { shortName } from '../../utils/initials.js';
import { Avatar } from '../VideoSurface.jsx';
import { IconButton, cx } from '../ui/index.jsx';
import {
  CrownIcon,
  HandIcon,
  MicIcon,
  MicOffIcon,
  ScreenIcon,
  VideoIcon,
  VideoOffIcon,
} from '../icons.jsx';

const ParticipantRow = ({ participant, isSelf, isHost, onMute, onRemove, onTransfer, canModerate }) => (
  <li className="participant-row">
    <Avatar name={participant.displayName} size="sm" />
    <div className="participant-row__identity">
      <p className="participant-row__name" title={participant.displayName}>
        {shortName(participant.displayName, 26)}
        {isSelf ? <span className="participant-row__tag">You</span> : null}
        {isHost ? (
          <span className="participant-row__tag participant-row__tag--host" title="Meeting host">
            <CrownIcon size={12} /> Host
          </span>
        ) : null}
      </p>
      <p className="participant-row__status">
        <span className={cx('participant-row__state', participant.audioEnabled === false && 'is-off')}>
          {participant.audioEnabled === false ? <MicOffIcon size={12} /> : <MicIcon size={12} />}
          {participant.audioEnabled === false ? 'Muted' : 'Mic on'}
        </span>
        <span className={cx('participant-row__state', participant.videoEnabled === false && 'is-off')}>
          {participant.videoEnabled === false ? <VideoOffIcon size={12} /> : <VideoIcon size={12} />}
          {participant.videoEnabled === false ? 'Camera off' : 'Camera on'}
        </span>
        {participant.sharingScreen ? (
          <span className="participant-row__state participant-row__state--accent">
            <ScreenIcon size={12} /> Presenting
          </span>
        ) : null}
        {participant.handRaised ? (
          <span className="participant-row__state participant-row__state--accent">
            <HandIcon size={12} /> Hand raised
          </span>
        ) : null}
      </p>
    </div>
    {canModerate ? (
      <div className="participant-row__actions">
        {participant.audioEnabled !== false ? (
          <IconButton
            size="xs"
            icon={<MicOffIcon size={15} />}
            label={`Ask ${participant.displayName} to mute`}
            onClick={() => onMute(participant.participantId)}
          />
        ) : null}
        {!isHost ? (
          <IconButton
            size="xs"
            icon={<CrownIcon size={15} />}
            label={`Make ${participant.displayName} the host`}
            onClick={() => onTransfer(participant.participantId)}
          />
        ) : null}
        {!isHost && !isSelf ? (
          <IconButton
            size="xs"
            tone="danger"
            icon={<span aria-hidden="true">✕</span>}
            label={`Remove ${participant.displayName} from the meeting`}
            onClick={() => onRemove(participant.participantId)}
          />
        ) : null}
      </div>
    ) : null}
  </li>
);

/**
 * Live participant roster. The count is the number of people actually
 * connected right now - it is never presented as a maximum.
 */
export const ParticipantsPanel = ({ participants, self, isHost, onClose, onMute, onRemove, onTransfer }) => {
  const roster = [self, ...participants].filter(Boolean);
  return (
    <section className="panel panel--participants" aria-label="Participants">
      <header className="panel__head">
        <div>
          <h2 className="panel__title">Participants</h2>
          <p className="panel__subtitle">
            {roster.length} in this meeting
          </p>
        </div>
        <IconButton icon={<span aria-hidden="true">×</span>} label="Close participants" size="sm" onClick={onClose} />
      </header>
      <ul className="participant-list">
        {roster.map((participant) => (
          <ParticipantRow
            key={participant.participantId}
            participant={participant}
            isSelf={participant.participantId === self?.participantId}
            isHost={participant.isHost || participant.participantId === isHost}
            canModerate={Boolean(isHost)}
            onMute={onMute}
            onRemove={onRemove}
            onTransfer={onTransfer}
          />
        ))}
      </ul>
    </section>
  );
};

export default ParticipantsPanel;
