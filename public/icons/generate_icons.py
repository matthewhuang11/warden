"""Generates Warden's shield-motif toolbar icons at the sizes Chrome requires.
Run with: python3 generate_icons.py
"""
from PIL import Image, ImageDraw

SIZES = [16, 32, 48, 128]
NAVY = (26, 35, 55, 255)
BLUE = (58, 110, 210, 255)
LIGHT_BLUE = (110, 168, 255, 255)
WHITE = (255, 255, 255, 255)


def shield_path(w, h):
    return [
        (0.50, 0.02), (0.92, 0.16), (0.92, 0.50),
        (0.92, 0.72), (0.50, 0.98), (0.08, 0.72),
        (0.08, 0.50), (0.08, 0.16),
    ]


def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pts = [(x * size, y * size) for x, y in shield_path(size, size)]
    draw.polygon(pts, fill=BLUE, outline=NAVY)

    inner_pts = []
    for x, y in shield_path(size, size):
        cx, cy = size / 2, size * 0.5
        inner_pts.append((cx + (x * size - cx) * 0.78, cy + (y * size - cy) * 0.78))
    draw.polygon(inner_pts, fill=LIGHT_BLUE)

    lw = max(1, round(size * 0.09))
    p1 = (size * 0.32, size * 0.50)
    p2 = (size * 0.45, size * 0.63)
    p3 = (size * 0.70, size * 0.34)
    draw.line([p1, p2, p3], fill=WHITE, width=lw, joint="curve")

    return img


for s in SIZES:
    icon = draw_icon(s)
    icon.save(f"icon{s}.png")

print("Generated:", ", ".join(f"icon{s}.png" for s in SIZES))
