"""Render the FINAL PDF (not the HTML) to PNG for visual QC, and report fonts / page boxes.
usage: python catalog/preview.py [print|share] [dpi]"""
import sys, os, fitz  # PyMuPDF

mode = sys.argv[1] if len(sys.argv) > 1 else "print"
dpi = int(sys.argv[2]) if len(sys.argv) > 2 else 110
here = os.path.dirname(os.path.abspath(__file__))
pdf = os.path.join(here, "output", "NIL-Office-Catalog-Print.pdf" if mode == "print" else "NIL-Office-Catalog-Share.pdf")
outdir = os.path.join(here, "output", "previews" if mode == "print" else "previews-share")
os.makedirs(outdir, exist_ok=True)
doc = fitz.open(pdf)
print("pages:", len(doc), "size(pt):", doc[0].rect.width, "x", doc[0].rect.height, " = mm", round(doc[0].rect.width / 72 * 25.4, 1), "x", round(doc[0].rect.height / 72 * 25.4, 1))
fonts = {}
for i, p in enumerate(doc):
    for f in p.get_fonts(full=True):
        fonts.setdefault(f[3], set()).add((f[2], f[1]))  # basefont -> (type, ext)
    pix = p.get_pixmap(dpi=dpi)
    pix.save(os.path.join(outdir, f"page-{i + 1:02d}.png"))
print("fonts used (all embedded if name has subset prefix):")
for k, v in fonts.items():
    print("  ", k, sorted(v))
