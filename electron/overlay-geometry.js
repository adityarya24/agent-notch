'use strict';

// One window footprint for every overlay mode.
//
// The dock has to be wider than card + margin + rail or the hover card is
// clipped against the window edge; the settings panel is the widest content
// (300px modal + 8px margin + rail), so its width wins for all modes.
//
// These used to differ per mode (dock 380x620, settings 440x640). Switching
// modes then animated the native window bounds, and resizing a transparent
// frameless window visibly shifts the HUD on every settings open/close. Keeping
// one footprint means snapOverlay has nothing to animate. The extra width is
// transparent and click-through, so a wider window costs nothing on screen.
const OVERLAY_SIZE = { width: 440, height: 620 };

const OVERLAY = {
  dock: { ...OVERLAY_SIZE },
  settings: { ...OVERLAY_SIZE },
  collapsed: { ...OVERLAY_SIZE }
};

function overlaySize(mode) {
  return Object.hasOwn(OVERLAY, mode) ? OVERLAY[mode] : OVERLAY.dock;
}

// Right-anchored to the work area, vertically centred in it.
function overlayBounds(mode, workArea) {
  const size = overlaySize(mode);
  return {
    x: Math.max(0, workArea.x + workArea.width - size.width),
    y: Math.max(0, workArea.y + Math.round((workArea.height - size.height) / 2)),
    width: size.width,
    height: size.height
  };
}

module.exports = { OVERLAY, OVERLAY_SIZE, overlaySize, overlayBounds };
