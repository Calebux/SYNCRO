# PWA Icons

This directory contains the required icons for the SYNCRO PWA.

## Generated Icons ✅

All required PNG icons have been generated from `icon.svg`:

### Standard Icons (for various devices):
- ✅ `icon-72.png` - 72x72px
- ✅ `icon-96.png` - 96x96px
- ✅ `icon-128.png` - 128x128px
- ✅ `icon-144.png` - 144x144px
- ✅ `icon-152.png` - 152x152px
- ✅ `icon-192.png` - 192x192px
- ✅ `icon-384.png` - 384x384px
- ✅ `icon-512.png` - 512x512px

### Maskable Icons (for adaptive icons on Android):
- ✅ `icon-192-maskable.png` - 192x192px with safe zone
- ✅ `icon-512-maskable.png` - 512x512px with safe zone

### Shortcut Icons:
- ✅ `add.png` - 96x96px (for "Add Subscription" shortcut)

## Generation

Icons are automatically generated using the script:
```bash
npm run generate-pwa-icons
```

This uses Sharp to convert the SVG icon to PNG format in all required sizes.

## Icon Design Guidelines

- Uses the existing SYNCRO brand colors and logo
- For maskable icons, padding is added for the safe zone (80% center area)
- PNG format with transparency support
- Optimized for various device pixel densities
