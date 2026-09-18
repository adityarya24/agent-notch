// Keep the geometry here in sync with tests/handoff-spark.test.js (CJS copy).
export function sparkStops(railBox, fromBox, toBox) {
  if (!railBox || !fromBox || !toBox) return null;
  return {
    from: fromBox.top + fromBox.height / 2 - railBox.top,
    to: toBox.top + toBox.height / 2 - railBox.top
  };
}
