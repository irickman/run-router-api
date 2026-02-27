# Implementation complete. Ready for verification.

**Scope: iOS-only** (Capacitor). Web deployment removed. `npm run dev` works for development in browser.

## Fixes applied (post-verification)

- **US-3:** Added visible location label near the input:
  - When geolocation succeeds: "Starting from your location"
  - When fallback to Seattle (denied/unsupported): "Starting from Seattle (default)"
  - While detecting: "Detecting location..."

## What was built

### Tech stack
- Vite + React + TypeScript
- Tailwind CSS
- Mapbox GL JS
- React Router
- Capacitor 8 (iOS)

### Route Input (Section 3.1)
- Multi-line textarea (min 3 rows, 500 char limit with live count)
- Cycling placeholder examples every 4 seconds
- Geolocation: Capacitor plugin on iOS, browser API on web (dev)
- Generate button: default "Generate Route", loading "Generating..." with spinner, disabled when empty, Enter submits

### Route Display (Section 3.2)
- Mapbox GL JS with Outdoors style
- Route line: 4px, #2E75B6, rounded joins
- Start marker: green circle "S", End marker: red circle "E"
- Auto-fit camera to route bounds with padding
- Stats panel: distance (mi, 2 decimals), elevation gain (ft), estimated time (10 min/mile), shape badge (Loop/Out & Back/Point-to-Point)
- Route metadata: AI name, confidence (High/Medium/Low), collapsible AI assumptions

### Route Actions (Section 3.3)
- GPX: On iOS, save to Documents + native Share sheet. On web, download.
- Share URL: On iOS, native Share sheet. On web, Copy Link + toast "Link copied!"
- Try Another: reset to input, focus textarea

### Layout (Section 5.1)
- Desktop (≥1024px): left sidebar 400px, right full-height map
- Mobile (<1024px): full-viewport map, top overlay card (input), bottom sheet (stats)
- Safe area insets for notch and home indicator (US-13)

### iOS-specific
- Capacitor Geolocation, Filesystem, Share, Splash Screen, Status Bar
- Info.plist: NSLocationWhenInUseUsageDescription
- US-15: Location permission denied message ("Enable location access in Settings...")
- SplashScreen.hide() and StatusBar.setStyle() on app load

### Loading & Errors
- Loading: semi-transparent overlay, spinner, "Generating your route..."
- Errors: retry button for network, invalid query, not found, server error
- Toast for "Link copied!" / "GPX ready to share" and errors

### Build and run
- `npm run build` then `npx cap sync ios` (or `npm run ios`)
- `npx cap open ios` to open in Xcode
- .env.example: VITE_API_URL, VITE_MAPBOX_TOKEN

### User stories covered
- US-1: Plain English route generation
- US-2: Cycling placeholder examples
- US-3: Current location as starting point
- US-4: Loading state during generation
- US-5: Route on interactive map
- US-6: Distance, elevation, time, shape displayed
- US-7: AI assumptions visible
- US-8: GPX download (native Share on iOS)
- US-9: Share URL (native Share on iOS)
- US-10: GPX via native share sheet (iOS)
- US-13: Safe area insets
- US-15: Location permission denied guidance
- US-11: Try Another resets
- US-12: Responsive mobile layout
- US-14: Error messages and retry
