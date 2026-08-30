#!/usr/bin/env python3
import sys
from pathlib import Path
from PIL import Image

raw = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

pages = [p for p in sorted(raw.glob("page-*.png")) if p.stat().st_size > 20000]
desks = sorted(raw.glob("desk-*.png"))
if not pages:
    raise SystemExit("no populated page-*.png frames")


def content_crop(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    bbox = rgba.split()[-1].getbbox()
    if not bbox:
        return rgba
    pad = 8
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(rgba.width, r + pad)
    b = min(rgba.height, b + pad)
    return rgba.crop((l, t, r, b))


def on_dark(im: Image.Image, pad: int = 18) -> Image.Image:
    bg = Image.new("RGB", (im.width + pad * 2, im.height + pad * 2), (12, 12, 14))
    bg.paste(im, (pad, pad), im)
    return bg


rails = [content_crop(Image.open(p)) for p in pages]
w = max(im.width for im in rails)
h = max(im.height for im in rails)
normalized = []
for im in rails:
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(im, ((w - im.width) // 2, (h - im.height) // 2), im)
    normalized.append(on_dark(canvas))

still = normalized[min(3, len(normalized) - 1)]
still.save(out / "rail.png", optimize=True)
normalized[0].save(
    out / "glow.gif",
    save_all=True,
    append_images=normalized[1:],
    duration=140,
    loop=0,
    optimize=True,
    disposal=2,
)

if desks:
    # Prefer a later frame once quota rings have loaded.
    desk = Image.open(desks[min(len(desks) - 1, 5)]).convert("RGB")
    strip_w = min(desk.width, max(420, desk.width // 4))
    top = int(desk.height * 0.04)
    bottom = int(desk.height * 0.92)
    strip = desk.crop((desk.width - strip_w, top, desk.width, bottom))
    max_h = 1100
    if strip.height > max_h:
        ratio = max_h / strip.height
        strip = strip.resize((max(1, int(strip.width * ratio)), max_h), Image.Resampling.LANCZOS)
    strip.save(out / "desktop-edge.png", optimize=True)
    print(f"wrote {out / 'desktop-edge.png'} {strip.size}")

print(f"wrote {out / 'rail.png'} {still.size}")
print(f"wrote {out / 'glow.gif'} frames={len(normalized)}")
