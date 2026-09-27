import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMeeting } from '../../context/MeetingContext.jsx';
import { Avatar, VideoSurface } from '../VideoSurface.jsx';
import { Button, Callout, cx } from '../ui/index.jsx';
import { MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from '../icons.jsx';
import { shortName } from '../../utils/initials.js';

/**
 * Waiting room. A local preview and local device controls are available, but
 * no peer connections, no participant roster and no meeting chat exist here -
 * the server never sends active-room state to a waiting connection.
 */
export const WaitingRoom = ({ onLeave }) => {
  const { state, setMicrophone, setCamera } = useMeeting();
  const navigate = useNavigate();
  const media = state.media;
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!state.error) return undefined;
    const timer = setTimeout(() => navigate('/'), 4000);
    return () => clearTimeout(timer);
  }, [state.error, navigate]);

  useEffect(() => {
    const timer = setInterval(() => setDots((current) => (current.length >= 3 ? '' : `${current}.`)), 600);
    return () => clearInterval(timer);
  }, []);

  const micOn = Boolean(media.hasAudio && media.audioEnabled);
  const camOn = Boolean(media.hasVideo && media.videoEnabled);

  return (
    <div className="waiting">
      <div className="waiting__card">
        <div className="waiting__preview">
          {state.localStream && media.hasVideo ? (
            <VideoSurface stream={state.localStream} muted mirror fit="cover" label="Your camera preview" />
          ) : (
            <div className="waiting__placeholder">
              <Avatar name={state.self?.displayName || 'You'} size="xl" />
              <p>{camOn ? 'Waiting for your camera' : 'Camera is off'}</p>
            </div>
          )}
          <div className="waiting__controls">
            <button
              type="button"
              className={cx('preview-toggle', micOn && 'is-on')}
              onClick={() => void setMicrophone(!micOn)}
              aria-pressed={micOn}
              disabled={!media.hasAudio}
            >
              {micOn ? <MicIcon size={18} /> : <MicOffIcon size={18} />}
              <span>{media.hasAudio ? (micOn ? 'Mic on' : 'Mic off') : 'No mic'}</span>
            </button>
            <button
              type="button"
              className={cx('preview-toggle', camOn && 'is-on')}
              onClick={() => void setCamera(!camOn)}
              aria-pressed={camOn}
              disabled={!media.hasVideo}
            >
              {camOn ? <VideoIcon size={18} /> : <VideoOffIcon size={18} />}
              <span>{media.hasVideo ? (camOn ? 'Camera on' : 'Camera off') : 'No camera'}</span>
            </button>
          </div>
        </div>

        <div className="waiting__body">
          <p className="waiting__eyebrow">Waiting room</p>
          <h1 className="waiting__title">
            {state.self?.displayName ? `${shortName(state.self.displayName, 28)}, you are` : 'You are'} in the lobby
            {dots}
          </h1>
          <p className="waiting__text">
            The host has to let you into the meeting. You can check your camera and microphone in the meantime - the
            meeting cannot see or hear you yet.
          </p>

          {state.error ? (
            <Callout tone="error" title="Not admitted">
              {state.error.message}
            </Callout>
          ) : null}

          <Button variant="ghost" onClick={onLeave}>
            Leave the waiting room
          </Button>
        </div>
      </div>
    </div>
  );
};

export default WaitingRoom;
