import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from './ui/index.jsx';

const GAP = 12;
const MIN_TILE_WIDTH = 168;

/**
 * Chooses the grid shape that gives every tile the most area for the current
 * participant count and container size. Nothing is hard-coded per count: the
 * same code handles 1, 4, 9 or 40 participants, on phone or desktop.
 */
export function bestGrid(count, width, height, { gap = GAP, minTileWidth = MIN_TILE_WIDTH } = {}) {
  const total = Math.max(0, count);
  if (total === 0) return { cols: 1, rows: 1, tileWidth: width, tileHeight: height };
  if (!width || !height) return { cols: Math.min(total, 2), rows: Math.ceil(total / Math.min(total, 2)) };

  let best = null;
  for (let cols = 1; cols <= total; cols += 1) {
    const rows = Math.ceil(total / cols);
    const tileWidth = (width - gap * (cols - 1)) / cols;
    if (tileWidth < minTileWidth && cols > 1) continue;
    const tileHeight = (height - gap * (rows - 1)) / rows;
    if (tileHeight < 90) continue;
    const area = tileWidth * tileHeight;
    if (!best || area > best.area) best = { cols, rows, area, tileWidth, tileHeight };
  }
  if (!best) {
    const cols = Math.max(1, Math.floor((width + gap) / (minTileWidth + gap)));
    const rows = Math.ceil(total / cols);
    return { cols, rows, tileWidth: width / cols, tileHeight: height / rows };
  }
  return best;
}

/** Tracks an element's size, using ResizeObserver when the browser has it. */
export const useElementSize = (ref) => {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((previous) =>
        Math.abs(previous.width - rect.width) < 4 && Math.abs(previous.height - rect.height) < 4
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
};

/**
 * Adaptive participant grid. Renders whatever list it is given, so joins and
 * leaves are handled purely by React reconciliation.
 */
export const VideoGrid = ({ count, minTileWidth, className, style, children, ariaLabel = 'Participants' }) => {
  const ref = useRef(null);
  const { width, height } = useElementSize(ref);
  const grid = bestGrid(count, width, height, { minTileWidth });

  return (
    <div
      ref={ref}
      className={cx('video-grid', className)}
      style={{
        ...style,
        gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
        gridTemplateRows: grid.rows > 1 ? `repeat(${grid.rows}, minmax(0, 1fr))` : 'minmax(0, 1fr)',
      }}
      role="group"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
};

/** Closes on Escape while any of the provided refs has focus. */
export const useEscapeKey = (handler, active = true) => {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') ref.current?.(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
};

export default VideoGrid;
