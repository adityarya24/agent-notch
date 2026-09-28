#!/usr/bin/env python3
"""Compose fixture HUD captures into shareable screenshots and two silent videos."""
import json
import subprocess
import sys
from zipfile import ZipFile, ZIP_DEFLATED
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(sys.argv[1]).resolve()
CAPTURES = [ROOT / f"{n:02d}-{name}.png" for n, name in enumerate(
    ["overview", "quota-detail", "settings", "handoff", "live-activity"], 1
)]
for capture in CAPTURES:
    if not capture.exists():
        raise SystemExit(f"Missing capture: {capture}")

SCENES = [
    ("Your AI agents, at a glance.", "Live quota rings on the edge of your desktop.", "01 / AMBIENT QUOTAS"),
    ("Know when a limit is close.", "Hover for session and weekly usage details.", "02 / QUOTA DETAIL"),
    ("Make the rail yours.", "Choose your agents, alerts, and layout.", "03 / CUSTOMIZE"),
    ("A handoff you can see.", "Follow the work as it moves between agents.", "04 / HANDOFF"),
    ("Stay in flow.", "Active work glows quietly in the background.", "05 / LIVE ACTIVITY"),
]

FONT_DIR = Path("C:/Windows/Fonts")


def font(size, bold=False):
    name = "segoeuib.ttf" if bold else "segoeui.ttf"
    return ImageFont.truetype(str(FONT_DIR / name), size)


def background(size):
    w, h = size
    im = Image.new("RGB", size)
    pixels = im.load()
    for y in range(h):
        for x in range(w):
            glow = max(0.0, 1.0 - ((x / w - 0.77) ** 2 + (y / h - 0.45) ** 2) ** 0.5 * 1.6)
            pixels[x, y] = (int(10 + glow * 7), int(13 + glow * 25), int(19 + glow * 19))
    return im.convert("RGBA")


def fit_hud(path, max_size):
    im = Image.open(path).convert("RGBA")
    box = im.getchannel("A").getbbox()
    if not box:
        raise ValueError(f"Empty capture: {path}")
    im = im.crop(box)
    scale = min(max_size[0] / im.width, max_size[1] / im.height)
    return im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)


def draw_slide(index, size):
    w, h = size
    portrait = h > w
    im = background(size)
    draw = ImageDraw.Draw(im)
    margin = 76 if portrait else 115
    draw.rounded_rectangle((margin, 72, margin + 38, 110), 9, fill="#10b981")
    draw.text((margin + 13, 76), "N", font=font(21, True), fill="#052e24")
    draw.text((margin + 53, 72), "AGENT NOTCH", font=font(30 if portrait else 26, True), fill="#f4f4f5")
    draw.text((margin, 162), SCENES[index][2], font=font(21 if portrait else 20, True), fill="#34d399")
    title = SCENES[index][0]
    if portrait:
        # All titles fit two lines at this width, with deliberate line breaks.
        breaks = ["Your AI agents,\nat a glance.", "Know when a\nlimit is close.",
                  "Make the rail\nyours.", "A handoff you\ncan see.", "Stay in flow."]
        draw.multiline_text((margin, 216), breaks[index], font=font(80, True), fill="#f8fafc", spacing=4)
        draw.text((margin, 435), SCENES[index][1], font=font(28), fill="#a1a1aa")
        hud = fit_hud(CAPTURES[index], (w - 130, 1100))
        x = (w - hud.width) // 2
        y = 555 + (1100 - hud.height) // 2
    else:
        draw.text((margin, 328), title, font=font(61, True), fill="#f8fafc")
        draw.text((margin, 422), SCENES[index][1], font=font(29), fill="#a1a1aa")
        hud = fit_hud(CAPTURES[index], (780, 700))
        x = 1920 - 110 - hud.width
        y = (h - hud.height) // 2 + 20
    shadow = Image.new("RGBA", size)
    shadow.alpha_composite(Image.new("RGBA", hud.size, (0, 0, 0, 0)), (x, y))
    shadow.paste((0, 0, 0, 150), (x + 12, y + 20, x + 12 + hud.width, y + 20 + hud.height), hud.getchannel("A"))
    im = Image.alpha_composite(im, shadow.filter(ImageFilter.GaussianBlur(26)))
    im.alpha_composite(hud, (x, y))
    draw = ImageDraw.Draw(im)
    foot_y = h - 110
    draw.line((margin, foot_y - 22, w - margin, foot_y - 22), fill="#273d3a", width=2)
    draw.text((margin, foot_y), "agent-notch  /  desktop HUD", font=font(22), fill="#9ca3af")
    draw.text((w - margin - 170, foot_y), "DEMO DATA", font=font(20, True), fill="#64748b")
    return im.convert("RGB")


def video(slides, output):
    inputs = []
    for slide in slides:
        inputs.extend(["-loop", "1", "-t", "5", "-framerate", "30", "-i", str(slide)])
    filters = []
    prev = "0:v"
    for i in range(1, len(slides)):
        label = f"v{i}"
        filters.append(f"[{prev}][{i}:v]xfade=transition=fade:duration=0.6:offset={i * 4.4:.1f}[{label}]")
        prev = label
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs,
        "-filter_complex", ";".join(filters), "-map", f"[{prev}]",
        "-t", "22.6", "-r", "30", "-c:v", "libx264", "-preset", "medium",
        "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)
    ], check=True)


out = ROOT / "finished"
out.mkdir(exist_ok=True)
for name, size in [("horizontal", (1920, 1080)), ("vertical", (1080, 1920))]:
    slides = []
    for i in range(5):
        file = out / f"{name}-{i + 1:02d}.png"
        draw_slide(i, size).save(file, optimize=True)
        slides.append(file)
    video(slides, out / f"agent-notch-{name}.mp4")

for number, name in [(1, "hero"), (2, "quota-detail"), (4, "handoff")]:
    source = out / f"horizontal-{number:02d}.png"
    (out / f"screenshot-{name}.png").write_bytes(source.read_bytes())

(out / "manifest.json").write_text(json.dumps({
    "fixture": True, "source": "isolated Electron capture of built Agent Notch UI",
    "video": ["agent-notch-horizontal.mp4", "agent-notch-vertical.mp4"],
    "screenshots": ["screenshot-hero.png", "screenshot-quota-detail.png", "screenshot-handoff.png"],
    "note": "All usage percentages and handoff events are simulated demo data. Videos have no audio."
}, indent=2), encoding="utf-8")
with ZipFile(out / "agent-notch-product-media.zip", "w", ZIP_DEFLATED) as archive:
    for name in ["agent-notch-horizontal.mp4", "agent-notch-vertical.mp4",
                 "screenshot-hero.png", "screenshot-quota-detail.png",
                 "screenshot-handoff.png", "manifest.json"]:
        archive.write(out / name, name)
print(f"Finished media: {out}")
