import { useEffect, useState } from 'react';
import { useMeeting } from '../../context/MeetingContext.jsx';
import { Callout, Field, IconButton, Select, Spinner, Switch, cx } from '../ui/index.jsx';
import {
  ChevronIcon,
  HandIcon,
  ScreenIcon,
  ScreenOffIcon,
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
} from '../icons.jsx';

const DeviceSelect = ({ id, label, devices, value, onChange, fallbackLabel, disabled }) => (
  <Field label={label} htmlFor={id}>
    <div className="select-wrap">
      <Select id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {devices.length === 0 ? <option value="">{fallbackLabel}</option> : null}
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </Select>
      <ChevronIcon size={16} className="select-wrap__chevron" />
    </div>
  </Field>
);

/**
 * Device + preference settings. Everything here acts on real local hardware;
 * there are no cosmetic toggles.
 */
export const SettingsPanel = ({ onClose }) => {
  const {
    state,
    setMicrophone,
    setCamera,
    switchDevice,
    setOutputDevice,
    refreshDevices,
    toggleHand,
    startScreenShare,
    stopScreenShare,
  } = useMeeting();
  const { media, screenShare, self } = state;
  const [busy, setBusy] = useState(null);
  const [devices, setDevices] = useState(media.devices ?? { audioinput: [], videoinput: [], audiooutput: [] });

  useEffect(() => {
    let cancelled = false;
    refreshDevices().then((next) => {
      if (!cancelled && next) setDevices(next);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshDevices]);

  const onSwitch = async (kind, deviceId) => {
    if (!deviceId) return;
    setBusy(kind);
    await switchDevice(kind, deviceId);
    setBusy(null);
  };

  return (
    <section className="panel panel--settings" aria-label="Meeting settings">
      <header className="panel__head">
        <div>
          <h2 className="panel__title">Settings</h2>
          <p className="panel__subtitle">Devices and in-meeting preferences</p>
        </div>
        <IconButton icon={<span aria-hidden="true">×</span>} label="Close settings" size="sm" onClick={onClose} />
      </header>

      <div className="panel__scroll">
        <section className="settings__section" aria-label="Microphone">
          <h3 className="settings__heading">Microphone</h3>
          <div className="settings__row">
            <button
              type="button"
              className={cx('settings__toggle', media.audioEnabled && media.hasAudio && 'is-on')}
              onClick={() => setMicrophone(!(media.audioEnabled && media.hasAudio))}
              aria-pressed={Boolean(media.audioEnabled && media.hasAudio)}
            >
              {media.audioEnabled && media.hasAudio ? <MicIcon size={18} /> : <MicOffIcon size={18} />}
              {media.hasAudio ? (media.audioEnabled ? 'Mute' : 'Unmute') : 'No microphone'}
            </button>
            <DeviceSelect
              id="mic-select"
              label="Microphone"
              devices={devices.audioinput}
              value={media.audioDeviceId}
              onChange={(value) => onSwitch('audio', value)}
              fallbackLabel="Default microphone"
              disabled={busy === 'audio'}
            />
          </div>
          {!media.hasAudio ? (
            <Callout tone="warning" title="No microphone available">
              Your browser could not open a microphone. You can still join and listen.
            </Callout>
          ) : null}
        </section>

        <section className="settings__section" aria-label="Camera">
          <h3 className="settings__heading">Camera</h3>
          <div className="settings__row">
            <button
              type="button"
              className={cx('settings__toggle', media.videoEnabled && media.hasVideo && 'is-on')}
              onClick={() => setCamera(!(media.videoEnabled && media.hasVideo))}
              aria-pressed={Boolean(media.videoEnabled && media.hasVideo)}
            >
              {media.videoEnabled && media.hasVideo ? <VideoIcon size={18} /> : <VideoOffIcon size={18} />}
              {media.hasVideo ? (media.videoEnabled ? 'Stop video' : 'Start video') : 'No camera'}
            </button>
            <DeviceSelect
              id="camera-select"
              label="Camera"
              devices={devices.videoinput}
              value={media.videoDeviceId}
              onChange={(value) => onSwitch('video', value)}
              fallbackLabel="Default camera"
              disabled={busy === 'video'}
            />
          </div>
          {!media.hasVideo ? (
            <Callout tone="warning" title="No camera available">
              You can join with audio only, or let somebody else share their screen.
            </Callout>
          ) : null}
        </section>

        <section className="settings__section" aria-label="Speaker">
          <h3 className="settings__heading">Speaker</h3>
          {state.deviceSupport.setSinkId ? (
            <DeviceSelect
              id="speaker-select"
              label="Audio output"
              devices={devices.audiooutput}
              value={media.outputDeviceId}
              onChange={setOutputDevice}
              fallbackLabel="System default"
            />
          ) : (
            <Callout tone="info" title="Output selection unavailable">
              This browser does not support choosing a speaker. Audio plays through your default output.
            </Callout>
          )}
        </section>

        <section className="settings__section" aria-label="In meeting">
          <h3 className="settings__heading">In this meeting</h3>
          <Switch
            id="raise-hand"
            checked={Boolean(self?.handRaised)}
            onChange={toggleHand}
            label="Raise hand"
            description="Shows a raised-hand badge for everyone in the meeting."
          />
          <div className="settings__row settings__row--tight">
            <button
              type="button"
              className={cx('settings__toggle', screenShare.sharing && 'is-on')}
              onClick={() => (screenShare.sharing ? stopScreenShare() : startScreenShare())}
              aria-pressed={Boolean(screenShare.sharing)}
              disabled={!screenShare.supported}
            >
              {screenShare.sharing ? <ScreenOffIcon size={18} /> : <ScreenIcon size={18} />}
              {screenShare.sharing ? 'Stop sharing' : 'Share screen'}
            </button>
          </div>
          {!screenShare.supported ? (
            <Callout tone="info" title="Screen sharing unavailable">
              {screenShare.unsupportedReason ?? 'This browser cannot capture the screen.'}
            </Callout>
          ) : null}
        </section>

        {media.error ? (
          <Callout tone="error" title="Device problem">
            {media.error.message}
            {media.error.hint ? <span className="callout__hint">{media.error.hint}</span> : null}
          </Callout>
        ) : null}

        {busy ? (
          <p className="settings__status">
            <Spinner label="Switching device" /> Switching device…
          </p>
        ) : null}
      </div>
    </section>
  );
};

export default SettingsPanel;
