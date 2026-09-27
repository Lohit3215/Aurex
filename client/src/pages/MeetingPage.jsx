import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMeeting } from '../context/MeetingContext.jsx';
import { PHASE } from '../config.js';
import { normalizeRoomId } from '../utils/meetingUrl.js';
import PreJoin from '../components/PreJoin.jsx';
import MeetingView from '../components/MeetingView.jsx';
import WaitingRoom from '../components/meeting/WaitingRoom.jsx';
import { Callout, Spinner } from '../components/ui/index.jsx';

/**
 * The meeting route. It is the only place that decides which of the four
 * states applies: pre-join, connecting, active meeting, or waiting room.
 */
export const MeetingPage = () => {
  const { meetingId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { state, connect, joinMeeting, leave } = useMeeting();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [joinedHere, setJoinedHere] = useState(false);
  const showShareCard = params.get('created') === '1';

  const roomId = normalizeRoomId(meetingId ?? '');

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(
    () => () => {
      // Leaving the route tears the whole session down: media, peer
      // connections, timers and the signaling socket.
      void leave({ notifyServer: true });
    },
    [leave],
  );

  const submit = useCallback(
    async ({ displayName }) => {
      if (!roomId) {
        setSubmitError({ message: 'That meeting link is not valid. Check it and try again.' });
        return;
      }
      // PreJoin has already requested the camera and microphone; a failure
      // there is non-fatal, so the participant can still join and listen.
      setSubmitting(true);
      try {
        await joinMeeting({ roomId, displayName });
        setJoinedHere(true);
      } catch (error) {
        setSubmitError({ message: error?.message ?? 'Could not join the meeting.' });
        setSubmitting(false);
      }
    },
    [roomId, joinMeeting],
  );

  const handleLeave = useCallback(async () => {
    await leave();
    navigate('/');
  }, [leave, navigate]);

  if (!roomId) {
    return (
      <div className="page page--narrow">
        <Callout tone="error" title="Invalid meeting link">
          That link does not contain a valid meeting ID.{' '}
          <button type="button" className="linkish" onClick={() => navigate('/')}>
            Go back home
          </button>
        </Callout>
      </div>
    );
  }

  // Somebody who is already in the room (creator, or a re-entered tab).
  if (state.phase === PHASE.ACTIVE && state.roomId === roomId) {
    return <MeetingView onLeave={handleLeave} showShareCard={showShareCard} />;
  }

  if (state.phase === PHASE.WAITING && state.roomId === roomId) {
    return <WaitingRoom onLeave={handleLeave} />;
  }

  if (state.phase === PHASE.ENDED || state.phase === PHASE.REMOVED || state.phase === PHASE.DENIED) {
    return <MeetingView onLeave={handleLeave} />;
  }

  if (state.phase === PHASE.ERROR && state.roomId === roomId) {
    return <MeetingView onLeave={handleLeave} />;
  }

  // Joining, or the connection is still coming up.
  if (joinedHere || state.phase === PHASE.JOINING) {
    return (
      <div className="page page--narrow">
        <div className="joining">
          <Spinner label="Joining the meeting" />
          <h1>Joining the meeting…</h1>
          <p>Setting up your camera, microphone and connection.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <PreJoin
        roomId={roomId}
        mode="join"
        onSubmit={submit}
        submitting={submitting}
        error={submitError}
        heading="Ready to join?"
        subheading="Check your name and devices, then join the meeting."
      />
    </div>
  );
};

export default MeetingPage;
