import { useEffect, useState } from 'react';
import { useMeeting, useMeetingStatus } from '../../context/MeetingContext.jsx';
import { Button, IconButton, Modal, cx } from '../ui/index.jsx';
import {
  ChatIcon,
  HandIcon,
  LeaveIcon,
  MicIcon,
  MicOffIcon,
  ScreenIcon,
  ScreenOffIcon,
  SettingsIcon,
  VideoIcon,
  VideoOffIcon,
  ShieldIcon,
  UsersIcon,
} from '../icons.jsx';

/** M toggles the microphone, V toggles the camera. Never while typing. */
const useMeetingShortcuts = ({ onToggleMic, onToggleCamera, onLeave, enabled }) => {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (event.key === 'm' || event.key === 'M') {
        event.preventDefault();
        onToggleMic?.();
      } else if (event.key === 'v' || event.key === 'V') {
        event.preventDefault();
        onToggleCamera?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, onToggleMic, onToggleCamera]);
};

export const ControlBar = ({ onLeave }) => {
  const {
    state,
    toggleMicrophone,
    toggleCamera,
    toggleHand,
    startScreenShare,
    stopScreenShare,
    togglePanel,
  } = useMeeting();
  const status = useMeetingStatus();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const { media, panel, screenShare, self, locked, waitingRoomEnabled, hostParticipantId, presenterParticipantId } = state;
  const participantCount = Object.keys(state.participants).length + (self ? 1 : 0);
  const micOn = Boolean(media.hasAudio && media.audioEnabled);
  const camOn = Boolean(media.hasVideo && media.videoEnabled);
  const isHost = self?.participantId === hostParticipantId;
  const activeTab = panel.open ? panel.tab : null;
  const unread = state.unread;

  useMeetingShortcuts({
    onToggleMic: () => void toggleMicrophone(),
    onToggleCamera: () => void toggleCamera(),
    enabled: true,
  });

  useEffect(() => {
    if (!moreOpen) return undefined;
    const close = (event) => {
      if (!event.target.closest?.('.control-split')) setMoreOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreOpen]);

  const panelButton = (tab, icon, label, badge) => (
    <IconButton
      key={tab}
      icon={icon}
      label={label}
      active={activeTab === tab}
      badge={badge}
      onClick={() => togglePanel(tab)}
    />
  );

  return (
    <>
      <div className="control-bar" role="toolbar" aria-label="Meeting controls">
        <div className="control-bar__group">
          <IconButton
            icon={micOn ? <MicIcon /> : <MicOffIcon />}
            label={micOn ? 'Mute microphone (M)' : 'Unmute microphone (M)'}
            active={micOn}
            tone={micOn ? 'default' : 'muted'}
            onClick={() => void toggleMicrophone()}
          />
          <IconButton
            icon={camOn ? <VideoIcon /> : <VideoOffIcon />}
            label={camOn ? 'Turn camera off (V)' : 'Turn camera on (V)'}
            active={camOn}
            tone={camOn ? 'default' : 'muted'}
            onClick={() => void toggleCamera()}
          />
          <IconButton
            icon={screenShare.sharing ? <ScreenOffIcon /> : <ScreenIcon />}
            label={screenShare.sharing ? 'Stop sharing your screen' : 'Share your screen'}
            active={screenShare.sharing}
            tone={screenShare.sharing ? 'accent' : 'default'}
            disabled={!screenShare.supported}
            onClick={() => void (screenShare.sharing ? stopScreenShare() : startScreenShare())}
          />
          <IconButton
            icon={<HandIcon raised={Boolean(self?.handRaised)} />}
            label={self?.handRaised ? 'Lower your hand' : 'Raise your hand'}
            active={Boolean(self?.handRaised)}
            tone={self?.handRaised ? 'accent' : 'default'}
            onClick={toggleHand}
          />
        </div>

        <div className="control-bar__group control-bar__group--center">
          <span className={cx('status-pill', `status-pill--${status.tone}`)} title={status.detail}>
            <span className="status-pill__dot" aria-hidden="true" />
            {status.label}
          </span>
          {locked ? <span className="tag tag--locked">Locked</span> : null}
          {waitingRoomEnabled ? <span className="tag">Waiting room on</span> : null}
          {presenterParticipantId ? <span className="tag tag--accent">Presenting</span> : null}
        </div>

        <div className="control-bar__group">
          {panelButton('participants', <UsersIcon />, 'Participants', String(participantCount))}
          {panelButton('chat', <ChatIcon />, 'Chat', unread > 0 ? String(unread) : null)}
          {isHost ? panelButton('host', <ShieldIcon />, 'Host controls') : null}
          {panelButton('settings', <SettingsIcon />, 'Settings')}
          <Button variant="danger" size="md" className="control-bar__leave" onClick={() => setConfirmLeave(true)}>
            <LeaveIcon size={18} />
            <span className="control-bar__leave-text">Leave</span>
          </Button>
        </div>
      </div>

      <Modal
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Leave this meeting?"
        description="Your camera and microphone will be turned off and you will leave for everyone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
              Stay
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmLeave(false);
                onLeave();
              }}
            >
              Leave meeting
            </Button>
          </>
        }
      >
        <p className="modal__text">You can rejoin at any time with the same link while the meeting is still open.</p>
      </Modal>
    </>
  );
};

export { useMeetingShortcuts };
export default ControlBar;
