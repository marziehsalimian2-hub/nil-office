# NIL Office — Product Catalog (source)

20-page A4 Persian catalog, built from HTML/CSS with Chromium (RTL, Persian digits, fonts embedded).

| Path | What it is |
|---|---|
| `output/NIL-Office-Catalog-Print.pdf` | final PDF for presentation and print (A4, 20 pages) |
| `output/NIL-Office-Catalog-Share.pdf` | lighter copy for WhatsApp / Telegram |
| `output/previews/` , `output/previews-share/` | page PNGs rendered **from the PDFs** (used for visual QC) |
| `src/catalog.html`, `src/catalog.css` | editable source (`{{A}}` = assets folder, set by the build) |
| `assets/logo/` | NIL logo derived from `public/nil-logo.png` (same artwork, recoloured ivory / gold / navy, wreath and wordmark split) |
| `assets/screens/` | real NIL Office screenshots, cropped; the user's name was removed from the dashboard header |
| `assets/graphics/` | the catalog's own infographics exported as PNG |
| `assets/fonts/` | Vazirmatn (SIL Open Font License 1.1), static instances cut from the variable font in `app/fonts` |

## Rebuild
```bash
node catalog/build.mjs print          # -> output/NIL-Office-Catalog-Print.pdf
python catalog/make_share_assets.py   # downscaled assets for the share copy
node catalog/build.mjs share          # -> output/NIL-Office-Catalog-Share.pdf
node catalog/export-graphics.mjs      # refresh assets/graphics (needs a prior print build)
python catalog/preview.py print 110   # PNG previews from the PDF + embedded-font report
```
Needs Node + puppeteer (already in the project) and Python with Pillow and PyMuPDF.

## Content rules followed
Only capabilities verified in the product audit (`NIL_OFFICE_PRODUCT_AUDIT.md`) are described. Not claimed anywhere: WhatsApp bot, multi-tenant SaaS,
per-module licensing, unverified board claims (Phase 2 is shown as "deployed, field test in progress", Phase 3 as "in development and test"), tested backup restore, ROI/percentage figures. Trade Portal appears as "pilot".
Contact details (phone, WhatsApp, web, e-mail) are on the closing page.
Test figures on the "provable advantages" page (416 tests / 39 suites) were measured on `origin/master` @ `db66a56`; update if you re-issue later.
