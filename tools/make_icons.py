"""Gera os ícones PNG do app (prancheta com marca de presença)."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
BG = (31, 95, 139)
WHITE = (255, 255, 255)
GREEN = (46, 125, 50)


def icon(size, maskable=False):
    s = 4 * size  # desenha grande e reduz (antialias)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, s, s], fill=BG)
        pad = int(s * 0.22)
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BG)
        pad = int(s * 0.16)
    # folha
    x0, y0, x1, y1 = pad + s * 0.06, pad, s - pad - s * 0.06, s - pad
    d.rounded_rectangle([x0, y0, x1, y1], radius=int(s * 0.05), fill=WHITE)
    # linhas da lista
    lw = int(s * 0.035)
    for i in range(3):
        y = y0 + (y1 - y0) * (0.25 + 0.22 * i)
        d.rounded_rectangle([x0 + (x1 - x0) * 0.40, y - lw / 2, x1 - (x1 - x0) * 0.12, y + lw / 2],
                            radius=lw // 2, fill=(200, 210, 220))
        cx, cy, r = x0 + (x1 - x0) * 0.22, y, (x1 - x0) * 0.08
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN if i < 2 else (198, 40, 40))
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
icon(192).save(OUT / "icon-192.png")
icon(512).save(OUT / "icon-512.png")
icon(512, maskable=True).save(OUT / "maskable-512.png")
print("ok")
