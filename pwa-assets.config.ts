import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/**
 * Mid-point of the amber→coral brand gradient (#FF9E5E → #FF6B6B).
 *
 * The source SVG is a ROUNDED square, so it leaves the four corners
 * transparent. The generator composites it over a canvas painted with this
 * colour, which makes the maskable / apple icons bleed to the edge. The flat
 * corner seam never shows: both Android and iOS crop the corners with their
 * own mask. The transparent ("any") icons keep the rounded shape, which is
 * what desktop shortcuts want — nothing masks those.
 */
const BRAND = '#FF8464';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // Full-bleed. The preset default of 0.3 padding on a white canvas was
    // wrong twice over: Android only guarantees the centre 80% of a maskable
    // icon, so 30% padding spent the entire safe zone on a white border and
    // shipped a small badge floating on white. At padding 0 the note still
    // sits inside the safe circle (its bbox radius is ~191px of the 205px
    // allowance at 512), so nothing important can be cropped.
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { fit: 'contain', background: BRAND } },
    // Same fix for iOS: it applies its own squircle mask, so a pre-padded
    // white square just rendered small and boxed on the home screen.
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { fit: 'contain', background: BRAND } },
  },
  images: ['public/pwa-icon.svg'],
});
