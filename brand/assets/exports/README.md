# Atlante production logo exports

This directory contains named production exports organized by asset family and
derived from the canonical `../final_logo.svg` master. The artwork is not
redrawn or simplified here.

## Typography

The lockup SVGs live in family subdirectories and intentionally keep the
wordmark and tagline as live text for design and print use. The embedded README hero includes the bundled WOFF2 data so GitHub does not depend on relative font loading. The other live-text SVG files retain their relative `../../../fonts/` paths and must move with the bundled fonts. The bundled fonts are:

- Bodoni Moda for `ATLANTE`, from
  `../../../fonts/bodonimoda/bodoni-moda-latin.woff2`.
- JetBrains Mono for the formal tagline, from
  `../../../fonts/jetbrainsmono/jetbrains-mono-latin.woff2`.

Each family is distributed under SIL Open Font License 1.1. Retain the matching
`OFL.txt` files from the font directories when redistributing the fonts.

The wordmark uses uppercase `ATLANTE`, optical size `12`, weight `400`, and
controlled tracking. The tagline uses uppercase JetBrains Mono with wide
tracking. No outlined wordmark is included; the README hero is a self-contained
live-text SVG with embedded font data, while the other live-text exports retain
their relative font references.

## Palette

The canonical `--atlante-jet` token now uses Prussian Blue:
`oklch(24.5% 0.044 254.7)` / `#112135`. The token name remains stable as a
semantic API; Linen remains `#F4ECE4` and the other palette primitives are
unchanged.

The darker Prussian Blue improves the tested contrast relationships: Prussian
Blue on Linen and Linen on Prussian Blue are `13.90:1` (previously `12.41:1`),
muted Prussian Blue on Linen is `5.28:1` (previously `4.8:1`), and Bronze on
Prussian Blue is `6.71:1` (previously `5.99:1`).

## Exports

| Export                                                                                           | Dimensions | Use                            |
| ------------------------------------------------------------------------------------------------ | ---------: | ------------------------------ |
| `glyph/atlante-glyph.svg`, `glyph/atlante-glyph-reverse.svg`                                     | 683 x 1024 | Scalable glyph-only mark       |
| `horizontal/atlante-horizontal.svg`, `horizontal/atlante-horizontal-reverse.svg`                 | 1200 x 420 | Horizontal wordmark lockup     |
| `stacked/atlante-stacked.svg`, `stacked/atlante-stacked-reverse.svg`                             |  683 x 860 | Stacked wordmark lockup        |
| `horizontal/atlante-horizontal-tagline.svg`, `horizontal/atlante-horizontal-tagline-reverse.svg` | 1200 x 470 | Horizontal tagline lockup      |
| `stacked/atlante-stacked-tagline.svg`, `stacked/atlante-stacked-tagline-reverse.svg`             |  683 x 930 | Stacked tagline lockup         |
| `favicons/atlante-favicon.svg`, `favicons/atlante-favicon-reverse.svg`                           |  256 x 256 | Scalable square favicon source |
| `favicons/atlante-favicon-1024.png`, `favicons/atlante-favicon-reverse-1024.png`                 | 683 x 1024 | High-resolution glyph sources  |
| `favicons/atlante-favicon.png`, `favicons/atlante-favicon-reverse.png`                           |  256 x 256 | Raster favicon deliveries      |
| `social/atlante-social.svg`, `social/atlante-social-reverse.svg`                                 | 1200 x 630 | Social preview SVG sources     |
| `horizontal/atlante-horizontal-tagline-embedded.svg`                                               | 1200 x 470 | Self-contained README hero    |
| `social/atlante-social.png`                                                                         | 1200 x 630 | GitHub social preview image    |

Path-only glyph and favicon SVGs are self-contained Prussian Blue-on-Linen or
Linen-on-Prussian-Blue applications. The README hero is also self-contained
with embedded font data; other live-text lockup and social SVGs retain relative
references to the bundled fonts by design. Raster PNG deliveries are
self-contained and include their intended Linen or Prussian Blue surface for
standalone display.

## Usage Rules

- Keep at least `0.1H` clear space around the complete mark, where `H` is the
  rendered height of the selected lockup.
- Do not crop the sphere, figure, or ground line.
- Do not add glow, shadow, gradients, partial recoloring, or a simplified
  bearer.
- Use the reverse files as complete Linen-on-Prussian-Blue applications; do not
  recolor individual glyph details.
- Raster favicon PNGs are provided at 16, 24, 32, 48, 64, 128, and 256 px. The
  256 px variants use the unsuffixed names; smaller variants use the size
  suffix, such as `atlante-favicon-32.png`.
- The `683 x 1024` PNGs are the high-resolution glyph sources used to derive the
  square favicon deliveries.
- These sizes are delivery and validation targets, not a prohibition on larger
  vector use.

## Provenance

The source, bundled fonts, and generated raster deliveries used for this package are identified by
these SHA-256 digests:

```text
final_logo.svg                         249bea17e7e55cd2123c35306ced5d63c7d7e17ef182afa6601813b940a690b3
fonts/bodonimoda/bodoni-moda-latin.woff2 fe710b15e2acd1f30159cec96b10c3455a32d27104c29d4027c5465d81fc11fe
fonts/jetbrainsmono/jetbrains-mono-latin.woff2 1e06740a02a443fb7f3eeda8fcaa685a0f6c620e3f01e6666e847295469ce3ad
fonts/sourcesans3/source-sans-3-latin.woff2 ac057a5593cbe3df0d2585da5dd5f33b8efa84aa30550c710fe061b37fc5c54b
fonts/sourceserif4/source-serif-4-latin.woff2 2a24bad466f09b88b8e9cbc488bf774117c912e66374c57bf4716855849143f8
exports/horizontal/atlante-horizontal-tagline-embedded.svg 63a61213976f468a33cac5dcf15e4d041160b39527c34e0163e813fcbce0a910
exports/social/atlante-social.png 0c2c4d8839a10e91706bfcb42fe16c510cbfa6d0723479b442d87de24b366981
```

The SVG outputs were raster-checked at their declared dimensions with
`rsvg-convert`. Light and reverse applications were checked on Linen and
Prussian-Blue surfaces.
