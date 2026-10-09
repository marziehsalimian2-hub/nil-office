"""Builds catalog/assets-share: the same assets, downscaled/optimised for WhatsApp & Telegram delivery."""
import os, shutil
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
src, dst = os.path.join(here, "assets"), os.path.join(here, "assets-share")
shutil.rmtree(dst, ignore_errors=True)
for sub in ("fonts", "logo", "screens", "graphics"):
    os.makedirs(os.path.join(dst, sub), exist_ok=True)
for f in os.listdir(os.path.join(src, "fonts")):
    if f.endswith(".ttf"):
        shutil.copy(os.path.join(src, "fonts", f), os.path.join(dst, "fonts", f))
def shrink(path, out, maxw, quant=None):
    im = Image.open(path)
    if im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    if quant:
        im = im.convert("RGB").quantize(colors=quant, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
    im.save(out, optimize=True)
for f in os.listdir(os.path.join(src, "logo")):
    shrink(os.path.join(src, "logo", f), os.path.join(dst, "logo", f), 560)
for f in os.listdir(os.path.join(src, "screens")):
    shrink(os.path.join(src, "screens", f), os.path.join(dst, "screens", f), 1300, quant=256)
tot = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(dst) for f in fs)
print("assets-share:", round(tot / 1024 / 1024, 2), "MB")
