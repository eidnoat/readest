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

const DEFAULT_THRESHOLD = 20;
const DEFAULT_IDLE_RESET_MS = 140;
const DEFAULT_LINE_HEIGHT = 40;
const DEFAULT_PAGE_HEIGHT = 800;

// Minimum cooldown (ms) after a flip before a velocity spike on the same axis
// can be recognized as a fresh deliberate swipe interrupting the momentum tail.
// During the first ~180ms after threshold is crossed, the user's fingers are
// often still on the trackpad finishing the original stroke/flick.
const RE_SWIPE_COOLDOWN_MS = 220;
// Minimum normalized delta (px) for a sample to qualify as a re-swipe spike or
// cross-axis switch.
const RE_SWIPE_MIN_DELTA_PX = 14;
// Factor by which the current sample must exceed the decayed recent tail to
// count as a fresh finger acceleration rather than 2-events-in-1-frame browser
// batching jitter (which is at most ~2x).
const RE_SWIPE_SPIKE_RATIO = 2.5;
// Maximum recent smoothed tail magnitude (px) before a same-direction spike can
// unlock; ensures the previous swipe's active phase has currently wound down
// (not merely dipped on a single early frame).
const RE_SWIPE_MAX_DECAYED_EMA_PX = 6;
// Sub-pixel / tiny dying tail threshold (px): while locked after a flip, tiny
// 1–2px dying momentum ticks must not extend `lastTime` for 500ms+ after the
// gesture is effectively over.
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
  // are the momentum tail and must be ignored until the wheel goes idle or a
  // new deliberate gesture interrupts the tail.
  let flipped = false;
  let flipTime = -Infinity;
  let flipAxis: 'x' | 'y' | null = null;
  let flipSign = 0;
  let recentEmaAbs = Infinity;
  let prevAbsAxis = Infinity;
  let decayedTickCount = 0;

  const normalize = (delta: number, mode: number) =>
    mode === 1 ? delta * lineHeight : mode === 2 ? delta * pageHeight : delta;

  const clearFlipLock = () => {
    accumX = 0;
    accumY = 0;
    flipped = false;
    flipAxis = null;
    flipSign = 0;
    recentEmaAbs = Infinity;
    prevAbsAxis = Infinity;
    decayedTickCount = 0;
  };

  /**
   * Feed one wheel sample. Returns the axis-resolved delta to flip by, or
   * `null` when the sample should not (yet) trigger a page turn.
   */
  const feed = (sample: WheelSample): WheelFlipResult | null => {
    const dx = normalize(sample.deltaX, sample.deltaMode);
    const dy = normalize(sample.deltaY, sample.deltaMode);
    const maxAbs = Math.max(Math.abs(dx), Math.abs(dy));

    // A gap longer than idleResetMs means the previous gesture (including any
    // inertial momentum tail) has ended — start a fresh gesture.
    if (sample.timeStamp - lastTime > idleResetMs) {
      // If a single dying momentum tick (<= 2.5px) arrives right after the idle
      // window, drop it without starting a new gesture.
      if (flipped && maxAbs <= DYING_TAIL_NOISE_PX) {
        clearFlipLock();
        return null;
      }
      clearFlipLock();
    }

    // While locked in the post-flip tail, do not let tiny 1–2px dying momentum
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

        // 1. Deliberate axis switch or opposite direction swipe starts a new gesture.
        // Guard against cross-axis wobble (e.g. a 1px vertical tick while dx=0)
        // and tiny bounce-back noise at the end of a gesture.
        const switchedAxis =
          dominantAxis !== flipAxis &&
          absDominant >= RE_SWIPE_MIN_DELTA_PX &&
          absCross > absAxis * 2;
        const reversedDirection =
          dominantAxis === flipAxis &&
          Math.sign(axisDelta) !== 0 &&
          Math.sign(axisDelta) !== flipSign &&
          absAxis >= 10;

        // 2. Same-direction re-swipe during an inertial momentum tail: only
        // unlock when the CURRENT tail has genuinely wound down (previous sample
        // <= 6px and smoothed EMA <= 10px), the cooldown has elapsed, and the new
        // sample jumps well above both the recent EMA and the previous sample.
        // Because `recentEmaAbs` and `prevAbsAxis` track current velocity up and
        // down, an early dip before a strong flick cannot leave them latched low
        // during high-velocity momentum.
        const spikedAfterDecay =
          sample.timeStamp - flipTime >= RE_SWIPE_COOLDOWN_MS &&
          decayedTickCount >= 1 &&
          absAxis >= RE_SWIPE_MIN_DELTA_PX &&
          prevAbsAxis <= RE_SWIPE_MAX_DECAYED_EMA_PX &&
          recentEmaAbs <= 10 &&
          absAxis >= Math.max(recentEmaAbs, 1) * 1.8 &&
          absAxis >= Math.max(prevAbsAxis, 1) * RE_SWIPE_SPIKE_RATIO;

        if (switchedAxis || reversedDirection || spikedAfterDecay) {
          clearFlipLock();
          lastTime = sample.timeStamp;
        } else {
          // Ignore 0-delta samples on the flipped axis (caused by a 1px cross-axis
          // wobble frame) so they don't artificially decay the tracked tail.
          if (absAxis > 0) {
            recentEmaAbs = Number.isFinite(recentEmaAbs)
              ? recentEmaAbs * 0.5 + absAxis * 0.5
              : absAxis;
            prevAbsAxis = absAxis;
            if (absAxis <= RE_SWIPE_MAX_DECAYED_EMA_PX) {
              decayedTickCount += 1;
            } else {
              decayedTickCount = 0;
            }
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
    const initialAxisAbs = Math.abs(isHorizontal ? dx : dy);
    recentEmaAbs = initialAxisAbs > 0 ? initialAxisAbs : threshold;
    prevAbsAxis = recentEmaAbs;
    decayedTickCount = 0;

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
