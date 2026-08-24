# Atlante Production Logo Exports

This directory contains named production exports organized by asset family and
derived from the canonical `../final_logo.svg` master. The artwork is not
redrawn or simplified here.

## Typography

The lockup SVGs live in family subdirectories and intentionally keep the
wordmark and tagline as live text. Keep their relative `../../../fonts/` paths
intact when moving or publishing these files. The bundled fonts are:

- Bodoni Moda for `ATLANTE`, from
  `../../../fonts/bodonimoda/bodoni-moda-latin.woff2`.
- JetBrains Mono for the formal tagline, from
  `../../../fonts/jetbrainsmono/jetbrains-mono-latin.woff2`.

Each family is distributed under SIL Open Font License 1.1. Retain the matching
`OFL.txt` files from the font directories when redistributing the fonts.

The wordmark uses uppercase `ATLANTE`, optical size `12`, weight `400`, and
controlled tracking. The tagline uses uppercase JetBrains Mono with wide
tracking. No outlined wordmark is included.

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
| `horizontal/atlante-horizontal-tagline-linen.svg`                                  | 1200 x 470 | README light-surface lockup    |
| `stacked/atlante-stacked-tagline.svg`, `stacked/atlante-stacked-tagline-reverse.svg`             |  683 x 930 | Stacked tagline lockup         |
| `favicons/atlante-favicon.svg`, `favicons/atlante-favicon-reverse.svg`                           |  256 x 256 | Scalable square favicon source |
| `favicons/atlante-favicon-1024.png`, `favicons/atlante-favicon-reverse-1024.png`                 | 683 x 1024 | High-resolution glyph sources  |
| `favicons/atlante-favicon.png`, `favicons/atlante-favicon-reverse.png`                           |  256 x 256 | Raster favicon deliveries      |
| `social/atlante-social.svg`, `social/atlante-social-reverse.svg`                                 | 1200 x 630 | Social preview SVG sources     |

Normal exports use Prussian Blue on Linen (`#112135` on `#F4ECE4`) where a
surface provides that background. The README Linen variant is an explicit
light-surface application for renderers that do not provide a light canvas.
Reverse exports are self-contained
Linen-on-Prussian-Blue applications with a `#112135` background. Normal SVGs
retain transparency. Raster favicon PNGs include their intended Linen or
Prussian Blue surface for standalone display; reverse SVGs include their dark
background for standalone readability.

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

The source and bundled wordmark fonts used for this package are identified by
these SHA-256 digests:

```text
final_logo.svg                         e7f772e4f7fc46eab0624e041f681d066d867b1cada91077e46252644ffb7761
fonts/bodonimoda/bodoni-moda-latin.woff2 fe710b15e2acd1f30159cec96b10c3455a32d27104c29d4027c5465d81fc11fe
fonts/jetbrainsmono/jetbrains-mono-latin.woff2 1e06740a02a443fb7f3eeda8fcaa685a0f6c620e3f01e6666e847295469ce3ad
```

The SVG outputs were raster-checked at their declared dimensions with
`rsvg-convert`. Light and reverse applications were checked on Linen and
Prussian-Blue surfaces.
