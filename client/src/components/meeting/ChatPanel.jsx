import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortName } from '../../utils/initials.js';
import { Avatar } from '../VideoSurface.jsx';
import { IconButton, cx } from '../ui/index.jsx';

const formatTime = (timestamp) => {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

/**
 * In-meeting chat. Content is rendered as plain text only - no HTML, no
 * dangerouslySetInnerHTML anywhere in this component.
 */
export const ChatPanel = ({ messages, selfParticipantId, onSend, onClear, onClose, unread = 0 }) => {
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  const pinnedToBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior });
  }, []);

  // Track whether the reader is at the bottom so history is never yanked away.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const onScroll = () => {
      const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
      pinnedToBottomRef.current = distance < 48;
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (pinnedToBottomRef.current) scrollToBottom('smooth');
  }, [messages, scrollToBottom]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    pinnedToBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom('smooth'));
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section className="panel panel--chat" aria-label="Meeting chat">
      <header className="panel__head">
        <div>
          <h2 className="panel__title">Chat</h2>
          <p className="panel__subtitle">Only people in this meeting can read these messages.</p>
        </div>
        <div className="panel__head-actions">
          {messages.some((message) => message.kind === 'chat') ? (
            <button type="button" className="linkish" onClick={onClear}>
              Clear
            </button>
          ) : null}
          <IconButton icon={<span aria-hidden="true">×</span>} label="Close chat" size="sm" onClick={onClose} />
        </div>
      </header>

      <div className="chat__list" ref={listRef} role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 ? (
          <p className="chat__empty">No messages yet. Say hello.</p>
        ) : (
          messages.map((message) => {
            if (message.kind !== 'chat') {
              return (
                <p key={message.id} className={cx('chat__system', `chat__system--${message.kind}`)}>
                  <span>{message.text}</span>
                  <time dateTime={new Date(message.timestamp).toISOString()}>{formatTime(message.timestamp)}</time>
                </p>
              );
            }
            const mine = message.mine || message.senderParticipantId === selfParticipantId;
            return (
              <article key={message.id} className={cx('chat__message', mine && 'chat__message--mine')}>
                {!mine ? <Avatar name={message.senderDisplayName} size="xs" /> : null}
                <div className="chat__bubble-wrap">
                  <p className="chat__meta">
                    <span className="chat__sender">{mine ? 'You' : shortName(message.senderDisplayName, 24)}</span>
                    <time dateTime={new Date(message.timestamp).toISOString()}>{formatTime(message.timestamp)}</time>
                  </p>
                  <p className="chat__bubble">{message.text}</p>
                </div>
              </article>
            );
          })
        )}
      </div>

      <form
        className="chat__composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="visually-hidden" htmlFor="chat-input">
          Message
        </label>
        <textarea
          id="chat-input"
          className="chat__input"
          rows={2}
          maxLength={2000}
          placeholder="Send a message to everyone"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="btn btn--primary btn--sm" disabled={!draft.trim()}>
          Send
        </button>
        <p className="chat__hint">
          Enter sends · Shift + Enter adds a new line{unread > 0 ? ` · ${unread} unread` : ''}
        </p>
      </form>
    </section>
  );
};

export default ChatPanel;
