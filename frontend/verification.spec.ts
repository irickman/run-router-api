/**
 * Route Runner Frontend Verification Tests
 * Verifies PRD user stories (web-only; skips US-10, US-13, US-15)
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

test.describe('Route Runner Frontend Verification', () => {
  test('US-2: Cycling placeholder examples change every ~4 seconds', async ({ page }) => {
    await page.goto(BASE_URL);
    const textarea = page.getByRole('textbox', { name: /describe your route/i });
    await expect(textarea).toBeVisible();

    const placeholder1 = await textarea.getAttribute('placeholder');
    await page.waitForTimeout(4500); // >4 seconds
    const placeholder2 = await textarea.getAttribute('placeholder');
    expect(placeholder1).toBeTruthy();
    expect(placeholder2).toBeTruthy();
    expect(placeholder1).not.toBe(placeholder2);
  });

  test('US-3: Location label - "Starting from your location", "Seattle (default)", or "Detecting location..."', async ({
    page,
  }) => {
    await page.goto(BASE_URL);
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({ latitude: 47.65, longitude: -122.35 });
    await page.goto(BASE_URL);

    const locationLabel = page.getByText(
      /starting from your location|starting from seattle \(default\)|detecting location\.\.\./i
    ).first();
    await expect(locationLabel).toBeVisible({ timeout: 5000 });
    const label = await locationLabel.textContent();
    expect(
      [
        'Starting from your location',
        'Starting from Seattle (default)',
        'Detecting location...',
      ].includes(label?.trim() ?? '')
    ).toBe(true);
  });

  test('US-4: Loading state during generation', async ({ page }) => {
    await page.goto(BASE_URL);
    const textarea = page.getByRole('textbox', { name: /describe your route/i });
    await textarea.fill('5 mile loop around Green Lake');

    const generateBtn = page.getByRole('button', { name: /generate route/i });
    await expect(generateBtn).toBeEnabled();

    await generateBtn.click();

    // During API call: overlay with "Generating your route..." or button shows "Generating..."
    await expect(page.getByText(/generating/i).first()).toBeVisible({ timeout: 2000 });
  });

  test('US-12: Responsive mobile layout - overlays/sheet at <1024px', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(BASE_URL);

    // Mobile: top overlay card when no route
    const describeCard = page.getByText('Describe your route');
    await expect(describeCard).toBeVisible();
    const card = page.locator('.fixed.top-0');
    await expect(card).toBeVisible();
  });

  test('US-14: Error message and retry - simulate network failure', async ({ page }) => {
    await page.route(/\/api\/route/, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: JSON.stringify({ error: 'Server error' }) });
      } else {
        route.continue();
      }
    });
    await page.goto(BASE_URL);
    const textarea = page.getByRole('textbox', { name: /describe your route/i });
    await textarea.fill('5 mile loop around Green Lake');
    await page.getByRole('button', { name: /generate route/i }).click();

    await expect(
      page.getByText(/something went wrong|server error|error|try again|invalid/i).first()
    ).toBeVisible({ timeout: 10000 });
    const retryBtn = page.getByRole('button', { name: /retry/i });
    await expect(retryBtn).toBeVisible();
  });
});

test.describe('US-1, US-5, US-6, US-7, US-8, US-9, US-11 - Full route flow (mocked API)', () => {
  test.setTimeout(30000);

  const mockRouteResponse = {
    sessionId: 'test-session-123',
    routeId: 'test-route-456',
    name: 'Green Lake Loop',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-122.3321, 47.68, 0],
        [-122.33, 47.681, 0],
        [-122.328, 47.68, 0],
        [-122.3321, 47.68, 0],
      ],
    },
    stats: {
      distance_miles: 5.01,
      distance_meters: 8062,
      elevation_gain_feet: 120,
      duration_minutes: 50,
    },
    parameters: {
      distance: { value: 5, unit: 'miles', precision: 'approximate', originalText: '5 mile' },
      location: { startPoint: null, endPoint: null, landmarks: ['Green Lake'], neighborhood: null, region: null },
      shape: { type: 'loop', preference: null, avoidDoubleBack: true },
      terrain: { surfaces: [], elevation: { profile: 'flat', maxGain: null, preference: 'neutral' } },
      preferences: {},
      confidence: {
        overall: 0.9,
        needsClarification: [],
        assumptions: ['Interpreted Green Lake as Green Lake Park in Seattle', 'Defaulted to loop shape'],
      },
    },
    metadata: { shape: 'loop', landmarks: ['Green Lake'] },
    gpxUrl: 'https://api.example.com/gpx',
  };

  test('US-1, US-4, US-5, US-6, US-7, US-8, US-9, US-11: Full flow with mocked API', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.resolve() },
        configurable: true,
      });
    });
    await page.route(/\/api\/route($|\?)/, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockRouteResponse) });
      } else {
        await route.continue();
      }
    });
    await page.route(/\/api\/route\/.*\/gpx/, async (route) => {
      await route.fulfill({
        status: 200,
        body: '<?xml version="1.0"?><gpx></gpx>',
        headers: { 'Content-Type': 'application/gpx+xml', 'Content-Disposition': 'attachment; filename="route-runner-test.gpx"' },
      });
    });

    await page.goto(BASE_URL);

    const textarea = page.getByRole('textbox', { name: /describe your route/i });
    await textarea.fill('5 mile loop around Green Lake');
    await page.getByRole('button', { name: /generate route/i }).click();

    await expect(page.getByText(/generating your route/i)).toBeVisible({ timeout: 2000 });
    await expect(page.getByText(/generating your route/i)).not.toBeVisible({ timeout: 8000 });

    await expect(page.getByText(/distance/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/elevation/i).first()).toBeVisible();
    await expect(page.getByText(/shape|loop|out|point/i).first()).toBeVisible();

    const statsPanel = page.locator('.grid.grid-cols-2').first();
    await expect(statsPanel).toContainText(/mi/);
    await expect(statsPanel).toContainText(/ft/);
    await expect(statsPanel).toContainText(/min/);

    const showAssumptions = page.getByRole('button', { name: /show ai assumptions/i });
    const hideAssumptions = page.getByRole('button', { name: /hide ai assumptions/i });
    const hasAssumptions = (await showAssumptions.count()) > 0 || (await hideAssumptions.count()) > 0;
    expect(hasAssumptions).toBe(true);

    const mapContainer = page.locator('[aria-label="Route map"]');
    const mapPlaceholder = page.getByText(/map requires|VITE_MAPBOX/);
    const hasMap = (await mapContainer.count()) > 0;
    const hasMapPlaceholder = await mapPlaceholder.isVisible();
    expect(hasMap || hasMapPlaceholder).toBe(true);

    await page.getByRole('button', { name: /copy link/i }).click();
    await expect(page.getByText('Link copied!')).toBeVisible({ timeout: 3000 });

    const gpxBtn = page.getByRole('button', { name: /download gpx/i });
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await gpxBtn.click();
    const download = await downloadPromise;
    expect(download).not.toBeNull();
    if (download) {
      expect(download.suggestedFilename()).toMatch(/route-runner-.*\.gpx/);
    }

    await page.getByRole('button', { name: /try another/i }).click();
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('');
    const placeholderAfter = await textarea.getAttribute('placeholder');
    expect(placeholderAfter).toBeTruthy();
  });
});
