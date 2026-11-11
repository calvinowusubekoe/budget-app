import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Icons are generated from the full-bleed brand mark so the maskable icon has a safe zone.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: { ...minimal2023Preset, maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#0F6B66' } }, apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#0F6B66' } } },
  images: ['public/pwa-icon.svg'],
});
