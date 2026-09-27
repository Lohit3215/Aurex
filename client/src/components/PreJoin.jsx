import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCopyToClipboard, useMeeting } from '../context/MeetingContext.jsx';
import { meetingUrl } from '../utils/meetingUrl.js';
import { recallDisplayName } from '../services/session/identity.js';
import { VideoSurface, Avatar } from './VideoSurface.jsx';
import { Button, Callout, Field, Spinner, TextInput, cx } from './ui/index.jsx';
import { CheckIcon, CopyIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from './icons.jsx';

const validateName = (value) => {
  const trimmed = value.trim();
  if (trimmed.length < 2) return 'Please enter at least 2 characters.';
  if (trimmed.length > 48) return 'Please keep your name under 48 characters.';
  return null;
};

/**
 * Shared pre-join screen: display name + real device preview. Used by the join
 * page, the create page and any shared meeting link.
 */
export const PreJoin = ({
  roomId,
  mode = 'join',
  onSubmit,
  submitting = false,
  error,
  heading,
  subheading,
  extra,
}) => {
  const { state, prepareMedia, setMicrophone, setCamera, refreshDevices } = useMeeting();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(() => state.self?.displayName || recallDisplayName());
  const [nameError, setNameError] = useState(null);
  const [mediaRequested, setMediaRequested] = useState(false);
  const [devices, setDevices] = useState(state.media.devices ?? { audioinput: [], videoinput: [], audiooutput: [] });
  const { copy, copied } = useCopyToClipboard();
  const media = state.media;

  useEffect(() => {
    let cancelled = false;
    prepareMedia().then(() => {
      if (cancelled) return;
      setMediaRequested(true);
      refreshDevices().then((next) => {
        if (!cancelled && next) setDevices(next);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [prepareMedia, refreshDevices]);

  const title = heading ?? (mode === 'create' ? 'Create a meeting' : 'Join a meeting');

  const submit = async (event) => {
    event.preventDefault();
    const problem = validateName(displayName);
    setNameError(problem);
    if (problem) return;
    await onSubmit({ displayName: displayName.trim(), roomId });
  };

  const shareUrl = useMemo(() => (roomId ? meetingUrl(roomId) : ''), [roomId]);

  return (
    <div className="prejoin">
      <form className="prejoin__card" onSubmit={submit}>
        <header className="prejoin__head">
          <h1 className="prejoin__title">{title}</h1>
          {subheading ? <p className="prejoin__subtitle">{subheading}</p> : null}
        </header>

        <div className="prejoin__preview">
          {state.localStream && media.hasVideo ? (
            <VideoSurface stream={state.localStream} muted mirror fit="cover" label="Your camera preview" />
          ) : (
            <div className="prejoin__preview-placeholder">
              {mediaRequested ? (
                <>
                  <Avatar name={displayName || 'You'} size="xl" />
                  <p>{media.hasVideo ? 'Camera is off' : media.hasAudio ? 'No camera detected' : 'No camera or microphone detected'}</p>
                </>
              ) : (
                <>
                  <Spinner label="Requesting devices" />
                  <p>Requesting camera and microphone…</p>
                </>
              )}
            </div>
          )}
          <div className="prejoin__preview-controls">
            <button
              type="button"
              className={cx('preview-toggle', media.hasAudio && media.audioEnabled && 'is-on')}
              onClick={() => void setMicrophone(!(media.hasAudio && media.audioEnabled))}
              aria-pressed={Boolean(media.hasAudio && media.audioEnabled)}
              disabled={!media.hasAudio}
            >
              {media.hasAudio && media.audioEnabled ? <MicIcon size={18} /> : <MicOffIcon size={18} />}
              <span>{media.hasAudio ? (media.audioEnabled ? 'Mic on' : 'Mic off') : 'No mic'}</span>
            </button>
            <button
              type="button"
              className={cx('preview-toggle', media.hasVideo && media.videoEnabled && 'is-on')}
              onClick={() => void setCamera(!(media.hasVideo && media.videoEnabled))}
              aria-pressed={Boolean(media.hasVideo && media.videoEnabled)}
              disabled={!media.hasVideo}
            >
              {media.hasVideo && media.videoEnabled ? <VideoIcon size={18} /> : <VideoOffIcon size={18} />}
              <span>{media.hasVideo ? (media.videoEnabled ? 'Camera on' : 'Camera off') : 'No camera'}</span>
            </button>
          </div>
        </div>

        {media.error ? (
          <Callout tone="warning" title="Device problem">
            {media.error.message}
            {media.error.hint ? <span className="callout__hint">{media.error.hint}</span> : null}
          </Callout>
        ) : null}

        <Field label="Your name" htmlFor="display-name" error={nameError} hint="This is how other people see you. No account needed.">
          <TextInput
            id="display-name"
            value={displayName}
            maxLength={48}
            autoComplete="name"
            placeholder="e.g. Ada Lovelace"
            invalid={Boolean(nameError)}
            onChange={(event) => {
              setDisplayName(event.target.value);
              if (nameError) setNameError(null);
            }}
          />
        </Field>

        {devices.audioinput.length || devices.videoinput.length ? (
          <p className="prejoin__devices">
            {devices.audioinput.length} microphone{devices.audioinput.length === 1 ? '' : 's'} ·{' '}
            {devices.videoinput.length} camera{devices.videoinput.length === 1 ? '' : 's'} detected. You can change
            devices once you are in the meeting.
          </p>
        ) : null}

        {extra}

        {roomId ? (
          <div className="prejoin__share">
            <p className="prejoin__share-label">Meeting link</p>
            <p className="prejoin__share-url">{shareUrl}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void copy(shareUrl)}
              className="prejoin__copy"
            >
              {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        ) : null}

        {error ? (
          <Callout tone="error" title="Could not join">
            {error.message}
          </Callout>
        ) : null}

        <div className="prejoin__actions">
          <Button type="button" variant="ghost" onClick={() => navigate('/')}>
            Back
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Spinner label="Joining" /> : null}
            {mode === 'create' ? 'Create meeting' : 'Join meeting'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export { validateName };
export default PreJoin;
