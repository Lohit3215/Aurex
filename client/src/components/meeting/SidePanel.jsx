import { useEffect } from 'react';
import { useMeeting } from '../../context/MeetingContext.jsx';
import ChatPanel from './ChatPanel.jsx';
import ParticipantsPanel from './ParticipantsPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import HostPanel from './HostPanel.jsx';
import { cx } from '../ui/index.jsx';
import { ChatIcon, ShieldIcon, UsersIcon, SettingsIcon } from '../icons.jsx';

const TABS = [
  { id: 'participants', label: 'Participants', icon: <UsersIcon size={16} /> },
  { id: 'chat', label: 'Chat', icon: <ChatIcon size={16} /> },
  { id: 'host', label: 'Host', icon: <ShieldIcon size={16} />, hostOnly: true },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={16} /> },
];

/**
 * One reusable side panel with switchable tabs. It becomes a bottom sheet on
 * small screens so it can never cover the meeting controls.
 */
export const SidePanel = () => {
  const { state, setPanel, sendChat, clearChat, host, togglePanel } = useMeeting();
  const panel = state.panel;

  const isHost = state.self?.participantId === state.hostParticipantId;
  const tabs = TABS.filter((tab) => !tab.hostOnly || isHost);
  const participants = Object.values(state.participants).sort(
    (a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.participantId.localeCompare(b.participantId),
  );

  useEffect(() => {
    if (!panel.open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setPanel(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [panel.open, setPanel]);

  if (!panel.open || !panel.tab) return null;

  return (
    <aside
      className={cx('side-panel', `side-panel--${panel.tab}`)}
      role="complementary"
      aria-label="Meeting sidebar"
    >
      <nav className="side-panel__tabs" aria-label="Sidebar sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cx('side-panel__tab', panel.tab === tab.id && 'is-active')}
            aria-current={panel.tab === tab.id ? 'true' : undefined}
            onClick={() => togglePanel(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.id === 'chat' && state.unread > 0 ? (
              <span className="side-panel__badge" aria-label={`${state.unread} unread`}>
                {state.unread}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="side-panel__body">
        {panel.tab === 'chat' ? (
          <ChatPanel
            messages={state.chat}
            selfParticipantId={state.self?.participantId}
            onSend={sendChat}
            onClear={clearChat}
            unread={state.unread}
            onClose={() => setPanel(false)}
          />
        ) : null}
        {panel.tab === 'participants' ? (
          <ParticipantsPanel
            participants={participants}
            self={state.self}
            isHost={state.hostParticipantId}
            onClose={() => setPanel(false)}
            onMute={host.requestMute}
            onRemove={host.removeParticipant}
            onTransfer={host.transferHost}
          />
        ) : null}
        {panel.tab === 'host' && isHost ? (
          <HostPanel
            participants={participants.filter((participant) => participant.participantId !== state.self?.participantId)}
            waiting={state.waiting}
            locked={state.locked}
            waitingRoomEnabled={state.waitingRoomEnabled}
            onClose={() => setPanel(false)}
            onMute={host.requestMute}
            onRemove={host.removeParticipant}
            onAdmit={host.admitParticipant}
            onDeny={host.denyParticipant}
            onToggleLock={(value) => host.setLocked(value)}
            onToggleWaitingRoom={(value) => host.setWaitingRoomEnabled(value)}
            onTransferHost={host.transferHost}
            onEndMeeting={host.endMeeting}
          />
        ) : null}
        {panel.tab === 'settings' ? (
          <SettingsPanel onClose={() => setPanel(false)} />
        ) : null}
      </div>
    </aside>
  );
};

export default SidePanel;
