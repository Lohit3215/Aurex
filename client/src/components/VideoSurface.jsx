import { useEffect, useRef } from 'react';
import { avatarColors, initialsFor } from '../utils/initials.js';
import { cx } from './ui/index.jsx';

/** Locally generated avatar. No external avatar service is ever contacted. */
export const Avatar = ({ name = '', size = 'md', className, muted = false }) => {
  const colors = avatarColors(name);
  return (
    <span
      className={cx('avatar', `avatar--${size}`, className)}
      style={{ background: muted ? '#e6e2da' : colors.bg, color: muted ? '#8b8579' : colors.fg }}
      aria-hidden="true"
    >
      {initialsFor(name)}
    </span>
  );
};

/**
 * Attaches a MediaStream to a <video> element and keeps it attached.
 *
 * The element is reused across renders and the stream identity is tracked in a
 * ref, so a re-render never resets playback of a live stream.
 */
export const VideoSurface = ({
  stream,
  muted = false,
  playing = true,
  mirror = false,
  className,
  label,
  fit = 'cover',
  onReady,
}) => {
  const videoRef = useRef(null);
  const attachedRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (attachedRef.current === stream) return;
    attachedRef.current = stream;
    video.srcObject = stream ?? null;
    if (stream) {
      const attempt = video.play();
      if (attempt?.catch) attempt.catch(() => onReady?.({ playing: false }));
    }
  }, [stream, onReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    if (playing) {
      const attempt = video.play();
      if (attempt?.catch) attempt.catch(() => {});
    } else {
      video.pause();
    }
  }, [playing, stream]);

  return (
    <video
      ref={videoRef}
      className={cx('video-surface', `video-surface--${fit}`, mirror && 'is-mirrored', className)}
      autoPlay
      playsInline
      muted={muted}
      aria-label={label}
      tabIndex={-1}
    />
  );
};

export default VideoSurface;
