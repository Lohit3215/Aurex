import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMeeting } from '../context/MeetingContext.jsx';
import { PHASE } from '../config.js';
import PreJoin from '../components/PreJoin.jsx';
import { Callout, Spinner } from '../components/ui/index.jsx';

/**
 * Create a meeting: ask for a display name, then let the signaling server mint
 * a room. As soon as the room exists the participant is its host and the
 * meeting view opens with a shareable link.
 */
export const CreatePage = () => {
  const { state, connect, createMeeting } = useMeeting();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(state.signalingStatus === 'connected');

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (state.signalingStatus === 'connected') setConnected(true);
  }, [state.signalingStatus]);

  useEffect(() => {
    // The room exists as soon as the server confirms it.
    if (busy && state.phase === PHASE.ACTIVE && state.roomId) {
      navigate(`/meeting/${state.roomId}?created=1`, { replace: true });
    }
  }, [busy, state.phase, state.roomId, navigate]);

  useEffect(() => {
    if (busy && state.phase === PHASE.ERROR) {
      setError(state.error);
      setBusy(false);
    }
  }, [busy, state.phase, state.error]);

  const submit = async ({ displayName }) => {
    setError(null);
    if (!connected) {
      setError({ message: 'Still connecting to the meeting server. Give it a second and try again.' });
      return;
    }
    setBusy(true);
    try {
      await createMeeting({ displayName });
    } catch (submitError) {
      setError({ message: submitError?.message ?? 'Could not create the meeting.' });
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <PreJoin
        mode="create"
        onSubmit={submit}
        submitting={busy}
        error={error}
        heading="Create a meeting"
        subheading="Pick the name other participants will see, check your devices, and start."
        extra={
          !connected ? (
            <Callout tone="info" title="Connecting to the meeting server">
              <Spinner label="Connecting" /> One moment…
            </Callout>
          ) : null
        }
      />
    </div>
  );
};

export default CreatePage;
