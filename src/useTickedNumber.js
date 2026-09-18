import { useEffect, useRef, useState } from 'react';

export function useTickedNumber(value, { enabled = true, durationMs = 420 } = {}) {
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const [shown, setShown] = useState(numeric ? Math.round(value) : value);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (!numeric) {
      setShown(value);
      return undefined;
    }
    const target = Math.round(Math.min(100, Math.max(0, value)));
    if (!enabled) {
      setShown(target);
      return undefined;
    }
    const from = typeof shownRef.current === 'number' ? shownRef.current : target;
    if (from === target) {
      setShown(target);
      return undefined;
    }
    const started = performance.now();
    let frame;
    const step = (now) => {
      const k = Math.min(1, (now - started) / durationMs);
      setShown(Math.round(from + (target - from) * k));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, numeric, enabled, durationMs]);

  return shown;
}
