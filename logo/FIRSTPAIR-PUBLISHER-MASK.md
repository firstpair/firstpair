# First Pair Publisher Mask

The reusable publisher treatment is split into three files:

- `firstpair-catdog-logo.jpeg` is the local source copy of the established
  First Pair Press seal from `~/src/firstpair/logo/firstpair-catdog.jpeg`.
- `firstpair-publisher-mask.png` is a full-strength grayscale ink mask. White
  pixels are logo ink; black pixels are transparent paper.
- `firstpair-publisher-bronze.png` is the ready-to-place transparent bronze
  mark used for this cover family.

`make-publisher-mask.py` reproduces both PNGs. It extracts blue chroma instead
of luminance because the source is a JPEG with off-white paper and pale scan
noise. A luminance key leaves a rectangular paper badge; the chroma key keeps
the blue engraving while removing the paper and the white letterforms.

## Rebuild The Bronze Mark

The script requires Pillow. Use an existing environment that provides it, or a
disposable virtual environment; do not add Pillow to the book build merely for
this optional cover operation.

```sh
python3 logo/make-publisher-mask.py
```

The defaults reproduce the current treatment:

- bronze: `#c2a979`
- maximum alpha: `94` of `255` (about 37%)
- blue-chroma threshold: `20`

The neutral mask is deliberately full strength. Opacity belongs to each
edition's tinted output, not to the mask, so the same mask can support light,
dark, print, and screen variants.

## Adapt It For Another Edition

Choose a tint already present in the cover and adjust opacity before changing
the extraction threshold. For example:

```sh
python3 logo/make-publisher-mask.py \
  --color '#b8c1c8' \
  --max-alpha 82 \
  --tint-out logo/firstpair-publisher-silver.png
```

Useful starting points:

| Cover | Tint | Max alpha |
| --- | --- | ---: |
| Dark, warm, historical | `#c2a979` | 80-105 |
| Dark, cool, technical | `#b8c1c8` | 75-100 |
| Light cover | a sampled dark ink | 105-145 |
| High-detail background | a nearby midtone | 65-90 |

Keep `--threshold 20` for the supplied source. Raise it only if JPEG paper
noise becomes visible; lowering it tends to restore the rectangular paper
field.

## Place It On A Cover

1. Open the tinted PNG as RGBA and preserve its transparency.
2. Scale it to roughly 24-28% of the cover width without changing its aspect
   ratio.
3. Center it horizontally at the bottom with a margin near 1% of cover height.
4. Alpha-composite it directly over the artwork. Do not add a white backplate,
   drop shadow, or enclosing card.
5. Check the final mark at thumbnail size. Increase opacity only until
   `FIRST PAIR PRESS` is readable; the artwork should remain continuous through
   the logo boundary.

Pillow placement example:

```python
from PIL import Image

cover = Image.open("cover.png").convert("RGBA")
mark = Image.open("logo/firstpair-publisher-bronze.png").convert("RGBA")
width = round(cover.width * 0.26)
height = round(mark.height * width / mark.width)
mark = mark.resize((width, height), Image.Resampling.LANCZOS)
x = (cover.width - width) // 2
y = cover.height - height - round(cover.height * 0.01)
cover.alpha_composite(mark, (x, y))
cover.convert("RGB").save("cover-with-publisher.png", quality=96)
```

For this book, `book.build.json` points at the already composed
`russia-space-gradient-title-cover.png`; the book builder does not apply the
publisher mask separately.
