import { useState } from 'react';
import { shortName } from '../../utils/initials.js';
import { Avatar } from '../VideoSurface.jsx';
import { Button, Callout, IconButton, Modal, Switch } from '../ui/index.jsx';
import { CrownIcon, ShieldIcon, TrashIcon, UsersIcon } from '../icons.jsx';

/**
 * Host-only controls. Every action here is validated on the server: hiding
 * these buttons is a convenience, not the security boundary.
 */
export const HostPanel = ({
  participants,
  waiting,
  locked,
  waitingRoomEnabled,
  onClose,
  onMute,
  onRemove,
  onAdmit,
  onDeny,
  onToggleLock,
  onToggleWaitingRoom,
  onTransferHost,
  onEndMeeting,
}) => {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState(null);

  return (
    <section className="panel panel--host" aria-label="Host controls">
      <header className="panel__head">
        <div>
          <h2 className="panel__title">
            <ShieldIcon size={16} /> Host controls
          </h2>
          <p className="panel__subtitle">Only you can change these settings.</p>
        </div>
        <IconButton icon={<span aria-hidden="true">×</span>} label="Close host controls" size="sm" onClick={onClose} />
      </header>

      <div className="panel__scroll">
        <section className="settings__section" aria-label="Meeting access">
          <h3 className="settings__heading">Meeting access</h3>
          <Switch
            id="host-lock"
            checked={locked}
            onChange={onToggleLock}
            label="Lock the meeting"
            description="Existing participants stay connected; nobody new can join until you unlock it."
          />
          <Switch
            id="host-waiting-room"
            checked={waitingRoomEnabled}
            onChange={onToggleWaitingRoom}
            label="Use the waiting room"
            description="New participants wait for your approval before they can join."
          />
        </section>

        <section className="settings__section" aria-label="Waiting room">
          <h3 className="settings__heading">
            Waiting room <span className="settings__count">{waiting.length}</span>
          </h3>
          {waiting.length === 0 ? (
            <p className="settings__empty">Nobody is waiting.</p>
          ) : (
            <ul className="waiting-list">
              {waiting.map((entry) => (
                <li key={entry.participantId} className="waiting-list__item">
                  <Avatar name={entry.displayName} size="sm" />
                  <span className="waiting-list__name">{shortName(entry.displayName, 24)}</span>
                  <div className="waiting-list__actions">
                    <Button size="sm" variant="primary" onClick={() => onAdmit(entry.participantId)}>
                      Admit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDeny(entry.participantId)}>
                      Deny
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="settings__section" aria-label="Manage participants">
          <h3 className="settings__heading">
            <UsersIcon size={15} /> Manage participants
          </h3>
          {participants.length === 0 ? (
            <p className="settings__empty">You are the only participant.</p>
          ) : (
            <ul className="moderation-list">
              {participants.map((participant) => (
                <li key={participant.participantId} className="moderation-list__item">
                  <Avatar name={participant.displayName} size="sm" />
                  <span className="moderation-list__name">{shortName(participant.displayName, 22)}</span>
                  <div className="moderation-list__actions">
                    <Button size="sm" variant="ghost" onClick={() => onMute(participant.participantId)}>
                      Ask to mute
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onTransferHost(participant.participantId)}>
                      <CrownIcon size={14} /> Make host
                    </Button>
                    <Button size="sm" variant="danger-ghost" onClick={() => setPendingRemoval(participant)}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Callout tone="info" title="About muting others">
            Browsers do not let a website switch off somebody else&rsquo;s microphone. &ldquo;Ask to mute&rdquo; sends a
            request and their own device does the rest.
          </Callout>
        </section>

        <section className="settings__section settings__section--danger" aria-label="End meeting">
          <h3 className="settings__heading">
            <TrashIcon size={15} /> End meeting
          </h3>
          <p className="settings__note">Ends the meeting for everyone and closes the room.</p>
          <Button variant="danger" size="sm" onClick={() => setConfirmEnd(true)}>
            End meeting for everyone
          </Button>
        </section>
      </div>

      <Modal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="End meeting for everyone?"
        description="Every participant will be disconnected and the meeting link will stop working."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmEnd(false);
                onEndMeeting();
              }}
            >
              End meeting
            </Button>
          </>
        }
      >
        <p className="modal__text">This cannot be undone.</p>
      </Modal>

      <Modal
        open={Boolean(pendingRemoval)}
        onClose={() => setPendingRemoval(null)}
        title={`Remove ${pendingRemoval?.displayName ?? ''}?`}
        description="They will be disconnected from the meeting immediately."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingRemoval(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                onRemove(pendingRemoval.participantId);
                setPendingRemoval(null);
              }}
            >
              Remove participant
            </Button>
          </>
        }
      >
        <p className="modal__text">Their camera and microphone will be released on their side.</p>
      </Modal>
    </section>
  );
};

export default HostPanel;
