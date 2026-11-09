// Wheel-to-page-flip gesture detection.
//
// In paginated mode a horizontal/vertical wheel event flips the page. Touch
// surfaces like the Magic Mouse and laptop trackpads emit a long stream of
// events for a single physical gesture (plus an inertial "momentum" tail),
// and even a light brush of the surface produces spurious deltas.
//
// This detector mirrors what native readers (e.g. Apple Books) do: it
// accumulates wheel travel, only flips once the accumulated distance crosses
// a deliberate-intent threshold, and then swallows the rest of the stream
// (the momentum tail) until the gesture goes idle or a fresh deliberate stroke
// occurs — so one gesture flips exactly one page.

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

const DEFAULT_THRESHOLD = 20;
const DEFAULT_IDLE_RESET_MS = 140;
const DEFAULT_LINE_HEIGHT = 40;
const DEFAULT_PAGE_HEIGHT = 800;

// Minimum cooldown (ms) after a flip during which same-direction events are
// unconditionally swallowed as the follow-through and initial momentum of the
// original stroke. Also prevents premature idle resets during main-thread
// render stalls accompanying page transitions.
const FLIP_COOLDOWN_MS = 200;

// Velocity threshold (px/tick) below which a post-flip momentum tail is
// considered to have wound down to a low baseline.
const MOMENTUM_DECAY_VELOCITY_PX = 8;

// Minimum delta (px) required after decay and cooldown to recognize a fresh
// deliberate finger acceleration rather than dying momentum trickle.
const RE_SWIPE_MIN_DELTA_PX = 14;

// Sub-pixel / tiny dying tail threshold (px): while locked after a flip,
// tiny 1–2.5px dying momentum ticks must not extend `lastTime` indefinitely.
const DYING_TAIL_NOISE_PX = 2.5;

export const createWheelGestureDetector = (options: WheelGestureOptions = {}) => {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const idleResetMs = options.idleResetMs ?? DEFAULT_IDLE_RESET_MS;
  const lineHeight = options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const pageHeight = options.pageHeight ?? DEFAULT_PAGE_HEIGHT;

  let accumX = 0;
  let accumY = 0;
  let lastTime = -Infinity;
  // True once a flip has fired for the current gesture: the remaining events
  // are the momentum tail and must be swallowed until the wheel goes idle or a
  // new deliberate gesture interrupts the tail.
  let flipped = false;
  let flipTime = -Infinity;
  let flipAxis: 'x' | 'y' | null = null;
  let flipSign = 0;
  let tailHasDecayed = false;
  let prevAbsAxis = Infinity;

  const normalize = (delta: number, mode: number) =>
    mode === 1 ? delta * lineHeight : mode === 2 ? delta * pageHeight : delta;

  const clearFlipLock = () => {
    accumX = 0;
    accumY = 0;
    flipped = false;
    flipAxis = null;
    flipSign = 0;
    tailHasDecayed = false;
    prevAbsAxis = Infinity;
  };

  /**
   * Feed one wheel sample. Returns the axis-resolved delta to flip by, or
   * `null` when the sample should not (yet) trigger a page turn.
   */
  const feed = (sample: WheelSample): WheelFlipResult | null => {
    const dx = normalize(sample.deltaX, sample.deltaMode);
    const dy = normalize(sample.deltaY, sample.deltaMode);
    const maxAbs = Math.max(Math.abs(dx), Math.abs(dy));
    const timeSinceFlip = sample.timeStamp - flipTime;

    // A gap longer than idleResetMs means the previous gesture has ended.
    // Guard: during the first FLIP_COOLDOWN_MS, a frame freeze or JS thread
    // stall caused by page rendering must NOT trigger an early idle reset,
    // which would cause the remaining momentum tail to fire a second flip.
    if (sample.timeStamp - lastTime > idleResetMs) {
      if (!flipped || timeSinceFlip >= FLIP_COOLDOWN_MS) {
        // If a single tiny dying tick arrives right after the idle window,
        // drop it without starting a new gesture.
        if (flipped && maxAbs <= DYING_TAIL_NOISE_PX) {
          clearFlipLock();
          return null;
        }
        clearFlipLock();
      }
    }

    // While locked in the post-flip tail, do not let tiny 1–2.5px dying momentum
    // ticks endlessly refresh `lastTime` and block the next swipe.
    if (!flipped || maxAbs > DYING_TAIL_NOISE_PX) {
      lastTime = sample.timeStamp;
    }

    if (flipped) {
      if (flipAxis !== null) {
        const dominantAxis: 'x' | 'y' = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        const dominantDelta = dominantAxis === 'x' ? dx : dy;
        const absDominant = Math.abs(dominantDelta);
        const axisDelta = flipAxis === 'x' ? dx : dy;
        const absAxis = Math.abs(axisDelta);
        const crossDelta = flipAxis === 'x' ? dy : dx;
        const absCross = Math.abs(crossDelta);

        // 1. Deliberate axis switch or opposite direction swipe starts a new gesture immediately.
        // Guard against cross-axis wobble (e.g. 1px vertical tick while dx=0)
        // and tiny bounce-back noise at the end of a gesture.
        const switchedAxis =
          dominantAxis !== flipAxis &&
          absDominant >= RE_SWIPE_MIN_DELTA_PX &&
          absCross > absAxis * 1.5;
        const reversedDirection =
          dominantAxis === flipAxis &&
          Math.sign(axisDelta) !== 0 &&
          Math.sign(axisDelta) !== flipSign &&
          absAxis >= 10;

        // Track whether the tail has genuinely wound down to a low baseline.
        // Only valid after the initial flick has left the trackpad (>= 50ms).
        if (timeSinceFlip >= 50 && absAxis > 0 && absAxis <= MOMENTUM_DECAY_VELOCITY_PX) {
          tailHasDecayed = true;
        }

        // 2. Same-direction re-swipe: once cooldown has elapsed and the tail has
        // decayed, a clear finger acceleration / elevated delta marks the beginning
        // of a fresh stroke. Unlocking starts accumulating, ensuring that deliberate
        // finger travel is required before another flip fires.
        const spikedAfterDecay =
          timeSinceFlip >= FLIP_COOLDOWN_MS &&
          tailHasDecayed &&
          absAxis >= RE_SWIPE_MIN_DELTA_PX &&
          (absAxis > prevAbsAxis || absAxis >= 18);

        if (switchedAxis || reversedDirection || spikedAfterDecay) {
          clearFlipLock();
          lastTime = sample.timeStamp;
        } else {
          if (absAxis > 0) {
            prevAbsAxis = absAxis;
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
    tailHasDecayed = false;
    prevAbsAxis = Math.abs(isHorizontal ? dx : dy);

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
