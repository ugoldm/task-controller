import os
from PIL import Image, ImageDraw

OUT = "/Users/ugoldm/Documents/Claude/Projects/task-controller/public/icons"
os.makedirs(OUT, exist_ok=True)

INDIGO = (79, 70, 229, 255)   # #4f46e5
WHITE = (255, 255, 255, 255)

def checkmark(draw, size, scale=1.0):
    # центрированная галочка, scale — доля от размера (для safe-zone у maskable)
    cx, cy = size / 2, size / 2
    s = size * scale
    x0 = cx - s / 2
    y0 = cy - s / 2
    pts = [
        (x0 + s * 0.16, y0 + s * 0.54),
        (x0 + s * 0.42, y0 + s * 0.78),
        (x0 + s * 0.84, y0 + s * 0.26),
    ]
    w = max(2, int(s * 0.12))
    draw.line(pts, fill=WHITE, width=w, joint="curve")
    # скруглённые концы
    r = w / 2
    for (px, py) in (pts[0], pts[2]):
        draw.ellipse([px - r, py - r, px + r, py + r], fill=WHITE)

def rounded_icon(size, radius_frac=0.22):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_frac)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=INDIGO)
    checkmark(d, size, scale=0.62)
    return img

def maskable_icon(size):
    # фон на всю площадь (без скругления — маску накладывает ОС), галочка в safe-zone
    img = Image.new("RGBA", (size, size), INDIGO)
    d = ImageDraw.Draw(img)
    checkmark(d, size, scale=0.48)
    return img

def apple_icon(size):
    # без прозрачности, углы скруглит iOS сам
    img = Image.new("RGBA", (size, size), INDIGO)
    d = ImageDraw.Draw(img)
    checkmark(d, size, scale=0.6)
    return img.convert("RGB")

rounded_icon(192).save(f"{OUT}/icon-192.png")
rounded_icon(512).save(f"{OUT}/icon-512.png")
maskable_icon(512).save(f"{OUT}/icon-maskable-512.png")
apple_icon(180).save(f"{OUT}/apple-touch-icon-180.png")
print("icons written to", OUT)
for f in sorted(os.listdir(OUT)):
    print(" -", f)
