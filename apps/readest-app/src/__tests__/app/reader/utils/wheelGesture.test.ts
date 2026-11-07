import { describe, test, expect } from 'vitest';
import {
  createWheelGestureDetector,
  hasScrollRoomY,
  WheelSample,
} from '@/app/reader/utils/wheelGesture';

const sample = (over: Partial<WheelSample> & Pick<WheelSample, 'timeStamp'>): WheelSample => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ...over,
});

describe('createWheelGestureDetector', () => {
  test('ignores a single tiny horizontal touch below the threshold', () => {
    const detector = createWheelGestureDetector({ threshold: 30 });
    expect(detector.feed(sample({ deltaX: 4, timeStamp: 0 }))).toBeNull();
  });

  test('ignores sporadic tiny touches spaced beyond the idle gap (Magic Mouse brush)', () => {
    // Each light brush emits a tiny delta; spaced apart they must never
    // accumulate into a page turn — this is the accidental-flip bug.
    const detector = createWheelGestureDetector({ threshold: 30, idleResetMs: 200 });
    let t = 0;
    for (let i = 0; i < 20; i++) {
      t += 500; // > idle gap, so accumulators reset between touches
      expect(detector.feed(sample({ deltaX: 8, timeStamp: t }))).toBeNull();
    }
  });

  test('flips exactly once when a deliberate horizontal swipe crosses the threshold', () => {
    const detector = createWheelGestureDetector({ threshold: 30, idleResetMs: 200 });
    expect(detector.feed(sample({ deltaX: 12, timeStamp: 0 }))).toBeNull();
    expect(detector.feed(sample({ deltaX: 12, timeStamp: 16 }))).toBeNull();
    const flip = detector.feed(sample({ deltaX: 12, timeStamp: 32 }));
    expect(flip).not.toBeNull();
    expect(flip!.deltaX).toBeGreaterThan(0);
    expect(flip!.deltaY).toBe(0);
  });

  test('swallows the inertial momentum tail after a flip', () => {
    const detector = createWheelGestureDetector({ threshold: 30, idleResetMs: 200 });
    expect(detector.feed(sample({ deltaX: 40, timeStamp: 0 }))).not.toBeNull();
    // Momentum tail: continuous decaying events within the idle gap.
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 16;
      expect(detector.feed(sample({ deltaX: 35, timeStamp: t }))).toBeNull();
    }
  });

  test('starts a new gesture after the wheel goes idle', () => {
    const detector = createWheelGestureDetector({ threshold: 30, idleResetMs: 200 });
    expect(detector.feed(sample({ deltaX: 40, timeStamp: 0 }))).not.toBeNull();
    // Idle gap elapses, then a fresh deliberate swipe.
    expect(detector.feed(sample({ deltaX: 40, timeStamp: 1000 }))).not.toBeNull();
  });

  test('unlocks immediately when the user swipes in the opposite direction during momentum', () => {
    const detector = createWheelGestureDetector({ threshold: 30, idleResetMs: 200 });
    expect(detector.feed(sample({ deltaX: 40, timeStamp: 0 }))).not.toBeNull();
    // Reverse swipe within the 200ms idle window should accumulate and flip back.
    expect(detector.feed(sample({ deltaX: -18, timeStamp: 40 }))).toBeNull();
    const flipBack = detector.feed(sample({ deltaX: -18, timeStamp: 56 }));
    expect(flipBack).not.toBeNull();
    expect(flipBack!.deltaX).toBeLessThan(0);
  });

  test('recognizes a fresh same-direction swipe when velocity spikes after momentum decay', () => {
    const detector = createWheelGestureDetector({ threshold: 30, idleResetMs: 200 });
    expect(detector.feed(sample({ deltaX: 40, timeStamp: 0 }))).not.toBeNull();
    // Momentum tail decays continuously without any 200ms gap.
    expect(detector.feed(sample({ deltaX: 12, timeStamp: 80 }))).toBeNull();
    expect(detector.feed(sample({ deltaX: 4, timeStamp: 180 }))).toBeNull();
    expect(detector.feed(sample({ deltaX: 2, timeStamp: 250 }))).toBeNull();
    // User performs a second swipe while tail is still trickling (no 200ms gap):
    expect(detector.feed(sample({ deltaX: 20, timeStamp: 300 }))).toBeNull();
    const secondFlip = detector.feed(sample({ deltaX: 20, timeStamp: 316 }));
    expect(secondFlip).not.toBeNull();
    expect(secondFlip!.deltaX).toBeGreaterThan(0);
  });

  test('does not double-flip on a single swipe with a noisy/jittery momentum tail', () => {
    const detector = createWheelGestureDetector({ threshold: 30, idleResetMs: 200 });
    // Initial finger swipe triggers the first page turn at t=16ms
    expect(detector.feed(sample({ deltaX: 15, timeStamp: 0 }))).toBeNull();
    expect(detector.feed(sample({ deltaX: 20, timeStamp: 16 }))).not.toBeNull();
    // Long trackpad momentum tail with non-monotonic jitter AND an early dip
    // followed by a high-velocity flick and frame-batched 2x jumps (e.g. 11 -> 20)
    const tail = [
      { deltaX: 2, deltaY: 1, t: 32 }, // brief early dip while fingers are still on pad
      { deltaX: 0, deltaY: 1, t: 48 }, // pure cross-axis wobble frame
      { deltaX: 36, deltaY: 0, t: 64 }, // strong flick as fingers lift off
      { deltaX: 28, deltaY: 0, t: 96 },
      { deltaX: 22, deltaY: 0, t: 160 },
      { deltaX: 11, deltaY: 0, t: 250 }, // 1-tick frame
      { deltaX: 20, deltaY: 0, t: 285 }, // 2-tick coalesced frame at >220ms! Must NOT unlock!
      { deltaX: 12, deltaY: 0, t: 310 },
      { deltaX: 9, deltaY: 0, t: 340 },
      { deltaX: 5, deltaY: 0, t: 370 },
      { deltaX: 3, deltaY: 0, t: 400 },
    ];
    for (const tick of tail) {
      expect(
        detector.feed(sample({ deltaX: tick.deltaX, deltaY: tick.deltaY, timeStamp: tick.t })),
      ).toBeNull();
    }
  });

  test('does not let 1-2px dying momentum ticks extend lockout and block the next swipe', () => {
    const detector = createWheelGestureDetector(); // default threshold=20, idleResetMs=140
    expect(detector.feed(sample({ deltaX: 25, timeStamp: 0 }))).not.toBeNull();
    // Active tail ends at t=60ms (deltaX=8), then only 1-2px dying ticks trickle until t=220ms
    expect(detector.feed(sample({ deltaX: 8, timeStamp: 60 }))).toBeNull();
    expect(detector.feed(sample({ deltaX: 2, timeStamp: 100 }))).toBeNull();
    expect(detector.feed(sample({ deltaX: 1, timeStamp: 150 }))).toBeNull();
    expect(detector.feed(sample({ deltaX: 1, timeStamp: 190 }))).toBeNull();
    // At t=220ms (160ms after last >2.5px tick at t=60ms), a gentle new swipe (8 + 8 + 8 = 24px)
    // must immediately accumulate and flip!
    expect(detector.feed(sample({ deltaX: 8, timeStamp: 220 }))).toBeNull();
    expect(detector.feed(sample({ deltaX: 8, timeStamp: 236 }))).toBeNull();
    const secondFlip = detector.feed(sample({ deltaX: 8, timeStamp: 252 }));
    expect(secondFlip).not.toBeNull();
    expect(secondFlip!.deltaX).toBeGreaterThan(0);
  });

  test('resolves to the dominant axis, ignoring cross-axis noise', () => {
    const detector = createWheelGestureDetector({ threshold: 30 });
    // Large horizontal travel with small vertical jitter.
    detector.feed(sample({ deltaX: 20, deltaY: 3, timeStamp: 0 }));
    const flip = detector.feed(sample({ deltaX: 20, deltaY: -2, timeStamp: 16 }));
    expect(flip).not.toBeNull();
    expect(flip!.deltaY).toBe(0);
    expect(flip!.deltaX).toBeGreaterThan(0);
  });

  test('preserves direction sign for negative (left/up) swipes', () => {
    const detector = createWheelGestureDetector({ threshold: 30 });
    detector.feed(sample({ deltaY: -16, timeStamp: 0 }));
    const flip = detector.feed(sample({ deltaY: -16, timeStamp: 16 }));
    expect(flip).not.toBeNull();
    expect(flip!.deltaY).toBeLessThan(0);
    expect(flip!.deltaX).toBe(0);
  });

  test('normalizes line-mode deltas so one wheel notch flips a page', () => {
    const detector = createWheelGestureDetector({ threshold: 30, lineHeight: 40 });
    // A single line-mode notch (3 lines) normalizes to 120px > threshold.
    const flip = detector.feed(sample({ deltaY: 3, deltaMode: 1, timeStamp: 0 }));
    expect(flip).not.toBeNull();
    expect(flip!.deltaY).toBeGreaterThan(0);
  });

  test('reset() clears accumulated travel', () => {
    const detector = createWheelGestureDetector({ threshold: 30 });
    detector.feed(sample({ deltaX: 20, timeStamp: 0 }));
    detector.reset();
    // After reset the earlier 20px is forgotten, so 20px more is still short.
    expect(detector.feed(sample({ deltaX: 20, timeStamp: 16 }))).toBeNull();
  });
});

describe('hasScrollRoomY (#6552)', () => {
  const box = (scrollTop: number) => ({ scrollTop, clientHeight: 500, scrollHeight: 1200 });

  test('a page scrolled to the top has no room upward but room downward', () => {
    expect(hasScrollRoomY(box(0), -100)).toBe(false);
    expect(hasScrollRoomY(box(0), 100)).toBe(true);
  });

  test('a page scrolled to the bottom has no room downward but room upward', () => {
    expect(hasScrollRoomY(box(700), 100)).toBe(false);
    expect(hasScrollRoomY(box(700), -100)).toBe(true);
  });

  test('a page that fits has no room either way', () => {
    const fits = { scrollTop: 0, clientHeight: 500, scrollHeight: 500 };
    expect(hasScrollRoomY(fits, 100)).toBe(false);
    expect(hasScrollRoomY(fits, -100)).toBe(false);
  });
});

describe('detector suppress (#6552)', () => {
  test('swallows the rest of a gesture the page scrolled natively', () => {
    const detector = createWheelGestureDetector();
    detector.suppress(0);
    expect(detector.feed({ deltaX: 0, deltaY: 120, deltaMode: 0, timeStamp: 50 })).toBeNull();
    expect(detector.feed({ deltaX: 0, deltaY: 120, deltaMode: 0, timeStamp: 100 })).toBeNull();
    // A new gesture after the wheel goes idle flips again.
    expect(detector.feed({ deltaX: 0, deltaY: 120, deltaMode: 0, timeStamp: 400 })).not.toBeNull();
  });
});
