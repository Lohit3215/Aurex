import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMeeting } from '../context/MeetingContext.jsx';
import { isValidRoomId, normalizeRoomId } from '../utils/meetingUrl.js';
import { Callout, Field, TextInput } from '../components/ui/index.jsx';

/**
 * Join a meeting: accepts a bare meeting ID or a full meeting link.
 *
 * This page only validates the ID and hands off to `/meeting/:id`, which is
 * the same pre-join screen a shared link lands on. Keeping one pre-join path
 * means the device preview and permission handling can never drift apart.
 */
export const JoinPage = () => {
  const { state, connect } = useMeeting();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [roomInput, setRoomInput] = useState(() => params.get('room') ?? params.get('meeting') ?? '');
  const [roomError, setRoomError] = useState(null);
  const connected = state.signalingStatus === 'connected';

  useEffect(() => {
    connect();
  }, [connect]);

  const roomId = normalizeRoomId(roomInput);
  const looksValid = isValidRoomId(roomInput);

  const submit = (event) => {
    event.preventDefault();
    if (!roomId) {
      setRoomError('That does not look like a meeting ID or link. Paste the whole link, or type the 12-character ID.');
      return;
    }
    setRoomError(null);
    navigate(`/meeting/${roomId}`);
  };

  return (
    <div className="page page--narrow">
      <form className="join-card" onSubmit={submit}>
        <h1 className="join-card__title">Join a meeting</h1>
        <p className="join-card__subtitle">
          Paste a meeting link or type the meeting ID. You will get a chance to check your camera and microphone next.
        </p>

        <Field label="Meeting link or ID" htmlFor="room-input" error={roomError}>
          <TextInput
            id="room-input"
            value={roomInput}
            onChange={(event) => {
              setRoomInput(event.target.value);
              if (roomError) setRoomError(null);
            }}
            placeholder="e.g. http://localhost:5173/meeting/abc234jkmnpq"
            autoComplete="off"
            spellCheck="false"
            invalid={Boolean(roomError)}
          />
        </Field>

        {roomInput && !roomError ? (
          <p className={looksValid ? 'join-card__ok' : 'join-card__muted'}>
            {looksValid
              ? `Meeting ID: ${roomId}`
              : 'Meeting IDs are 12 characters, and links look like /meeting/abc234jkmnpq.'}
          </p>
        ) : null}

        {!connected ? (
          <Callout tone="info" title="Connecting to the meeting server">
            One moment…
          </Callout>
        ) : null}

        <button type="submit" className="btn btn--primary btn--lg" disabled={!connected}>
          Continue
        </button>
      </form>
    </div>
  );
};

export default JoinPage;
