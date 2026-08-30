#!/usr/bin/env python3
import sys
from pathlib import Path

from PIL import Image

raw = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

pages = [p for p in sorted(raw.glob("page-*.png")) if p.stat().st_size > 20000]
if not pages:
    raise SystemExit("no populated page-*.png frames")


def content_crop(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    bbox = rgba.split()[-1].getbbox()
    if not bbox:
        return rgba
    pad = 6
    l, t, r, b = bbox
    return rgba.crop((
        max(0, l - pad),
        max(0, t - pad),
        min(rgba.width, r + pad),
        min(rgba.height, b + pad),
    ))


def on_dark(im: Image.Image, pad: int = 10) -> Image.Image:
    bg = Image.new("RGB", (im.width + pad * 2, im.height + pad * 2), (9, 9, 11))
    bg.paste(im, (pad, pad), im)
    return bg


rails = [content_crop(Image.open(p)) for p in pages]
w = max(im.width for im in rails)
h = max(im.height for im in rails)
normalized = []
for im in rails:
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(im, (w - im.width, (h - im.height) // 2), im)
    frame = on_dark(canvas)
    # Keep the rail readable in README without giant empty canvas.
    max_w = 280
    if frame.width > max_w:
        ratio = max_w / frame.width
        frame = frame.resize((max_w, max(1, int(frame.height * ratio))), Image.Resampling.LANCZOS)
    even_w = frame.width + (frame.width % 2)
    even_h = frame.height + (frame.height % 2)
    if even_w != frame.width or even_h != frame.height:
        padded = Image.new("RGB", (even_w, even_h), (9, 9, 11))
        padded.paste(frame, (0, 0))
        frame = padded
    normalized.append(frame.convert("RGB"))

mid = normalized[min(len(normalized) // 2, len(normalized) - 1)]
mid.save(out / "rail.png", optimize=True)

held = normalized + [normalized[-1]] * 12
gif_path = out / "glow.gif"
held[0].save(
    gif_path,
    save_all=True,
    append_images=held[1:],
    duration=110,
    loop=0,
    optimize=True,
    disposal=2,
)

mp4_path = out / "glow.mp4"
try:
    import imageio.v2 as imageio

    writer = imageio.get_writer(
        mp4_path,
        fps=10,
        codec="libx264",
        quality=8,
        pixelformat="yuv420p",
        macro_block_size=1,
    )
    for frame in held:
        writer.append_data(__import__("numpy").asarray(frame))
    writer.close()
    print(f"wrote {mp4_path} {mp4_path.stat().st_size} bytes")
except Exception as exc:
    print(f"mp4 skipped: {exc}")

print(f"wrote {out / 'rail.png'} {mid.size}")
print(f"wrote {gif_path} frames={len(normalized)} {gif_path.stat().st_size} bytes")
