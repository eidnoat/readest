// Wheel-to-page-flip gesture detection.
//
// In paginated mode a horizontal/vertical wheel event flips the page. Touch
// surfaces like the Magic Mouse emit a long stream of tiny, low-magnitude
// wheel events for a single physical gesture (plus an inertial "momentum"
// tail), and even a light brush of the surface produces spurious deltas.
// Without filtering, every one of those events turns a page, so a single
// touch cascades into several accidental page turns.
//
// This detector mirrors what native readers (e.g. Apple Books) do: it
// accumulates wheel travel, only flips once the accumulated distance crosses
// a deliberate-intent threshold, and then swallows the rest of the stream
// (the momentum tail) until the wheel goes idle — so one gesture flips
// exactly one page.

export interface WheelSample {
  deltaX: number;
  deltaY: number;
  /** WheelEvent.deltaMode: 0 = pixel, 1 = line, 2 = page. */
  deltaMode: number;
  /** Monotonic timestamp in milliseconds. */
  timeStamp: number;
}

export interface WheelFlipResult {
  deltaX: number;
  deltaY: number;
}

export interface WheelGestureOptions {
  /** Accumulated normalized travel (px) required before a page turn fires. */
  threshold?: number;
  /** Idle gap (ms) after which a gesture — including its momentum tail — is
   *  considered finished and the accumulators reset. */
  idleResetMs?: number;
  /** Pixels per line, used to normalize line-mode (deltaMode 1) deltas. */
  lineHeight?: number;
  /** Pixels per page, used to normalize page-mode (deltaMode 2) deltas. */
  pageHeight?: number;
}

const DEFAULT_THRESHOLD = 30;
const DEFAULT_IDLE_RESET_MS = 200;
const DEFAULT_LINE_HEIGHT = 40;
const DEFAULT_PAGE_HEIGHT = 800;

// Minimum cooldown (ms) after a flip before a velocity spike on the same axis
// can be recognized as a fresh deliberate swipe interrupting the momentum tail.
const RE_SWIPE_COOLDOWN_MS = 180;
// Minimum normalized delta (px) for a sample to qualify as a re-swipe spike.
const RE_SWIPE_MIN_DELTA_PX = 8;
// Factor by which the current sample must exceed the decayed tail minimum to
// count as a fresh finger acceleration rather than inertial decay.
const RE_SWIPE_SPIKE_RATIO = 1.8;

export const createWheelGestureDetector = (options: WheelGestureOptions = {}) => {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const idleResetMs = options.idleResetMs ?? DEFAULT_IDLE_RESET_MS;
  const lineHeight = options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const pageHeight = options.pageHeight ?? DEFAULT_PAGE_HEIGHT;

  let accumX = 0;
  let accumY = 0;
  let lastTime = -Infinity;
  // True once a flip has fired for the current gesture: the remaining events
  // are the momentum tail and must be ignored until the wheel goes idle or a
  // new deliberate gesture interrupts the tail.
  let flipped = false;
  let flipTime = -Infinity;
  let flipAxis: 'x' | 'y' | null = null;
  let flipSign = 0;
  let tailMinAbs = Infinity;

  const normalize = (delta: number, mode: number) =>
    mode === 1 ? delta * lineHeight : mode === 2 ? delta * pageHeight : delta;

  const clearFlipLock = () => {
    accumX = 0;
    accumY = 0;
    flipped = false;
    flipAxis = null;
    flipSign = 0;
    tailMinAbs = Infinity;
  };

  /**
   * Feed one wheel sample. Returns the axis-resolved delta to flip by, or
   * `null` when the sample should not (yet) trigger a page turn.
   */
  const feed = (sample: WheelSample): WheelFlipResult | null => {
    const dx = normalize(sample.deltaX, sample.deltaMode);
    const dy = normalize(sample.deltaY, sample.deltaMode);

    // A gap longer than idleResetMs means the previous gesture (including any
    // inertial momentum tail) has ended — start a fresh gesture.
    if (sample.timeStamp - lastTime > idleResetMs) {
      clearFlipLock();
    }
    lastTime = sample.timeStamp;

    if (flipped) {
      if (flipAxis !== null) {
        const dominantAxis: 'x' | 'y' = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        const dominantDelta = dominantAxis === 'x' ? dx : dy;
        const absDominant = Math.abs(dominantDelta);
        const axisDelta = flipAxis === 'x' ? dx : dy;
        const absAxis = Math.abs(axisDelta);

        // 1. Axis switch or opposite direction swipe immediately starts a new gesture.
        const switchedAxis = dominantAxis !== flipAxis && absDominant >= RE_SWIPE_MIN_DELTA_PX;
        const reversedDirection =
          dominantAxis === flipAxis &&
          Math.sign(axisDelta) !== 0 &&
          Math.sign(axisDelta) !== flipSign &&
          absAxis >= 4;

        // 2. Same-direction re-swipe during an inertial momentum tail: once the
        // tail has decayed and the user's fingers accelerate the trackpad again
        // after a short cooldown, unlock so rapid consecutive swipes aren't
        // swallowed by a 500–1000ms OS momentum tail.
        const spikedAfterDecay =
          sample.timeStamp - flipTime >= RE_SWIPE_COOLDOWN_MS &&
          absAxis >= RE_SWIPE_MIN_DELTA_PX &&
          tailMinAbs < Infinity &&
          (tailMinAbs <= 2 || absAxis >= tailMinAbs * RE_SWIPE_SPIKE_RATIO);

        if (switchedAxis || reversedDirection || spikedAfterDecay) {
          clearFlipLock();
        } else {
          if (absAxis < tailMinAbs) {
            tailMinAbs = absAxis;
          }
          return null;
        }
      } else {
        // Suppressed by native scroll (`suppress()`): wait for the idle gap.
        return null;
      }
    }

    accumX += dx;
    accumY += dy;

    if (Math.abs(accumX) < threshold && Math.abs(accumY) < threshold) {
      return null;
    }

    const isHorizontal = Math.abs(accumX) > Math.abs(accumY);
    flipped = true;
    flipTime = sample.timeStamp;
    flipAxis = isHorizontal ? 'x' : 'y';
    flipSign = Math.sign(isHorizontal ? accumX : accumY);
    tailMinAbs = Math.abs(isHorizontal ? dx : dy);

    // Resolve to the dominant axis so a tiny amount of cross-axis noise
    // doesn't flip in the wrong direction.
    const result: WheelFlipResult = isHorizontal
      ? { deltaX: accumX, deltaY: 0 }
      : { deltaX: 0, deltaY: accumY };
    accumX = 0;
    accumY = 0;
    return result;
  };

  const reset = () => {
    lastTime = -Infinity;
    flipTime = -Infinity;
    clearFlipLock();
  };

  /**
   * Mark the current gesture as handled by native scrolling (a zoomed or
   * fit-width page scrolling within itself), so the rest of it — including
   * the ticks that land once the page reaches its edge — can't flip the page.
   */
  const suppress = (timeStamp: number) => {
    clearFlipLock();
    lastTime = timeStamp;
    flipped = true;
  };

  return { feed, reset, suppress };
};

/** Whether a scroll box still has room to scroll natively by `deltaY`. */
export const hasScrollRoomY = (
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  deltaY: number,
) => {
  if (deltaY > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  if (deltaY < 0) return el.scrollTop > 1;
  return false;
};

export type WheelGestureDetector = ReturnType<typeof createWheelGestureDetector>;
