# Route Runner Improvement Prompt for Claude Code

## Project Context

I'm building **Route Runner**, an iOS app that converts natural language descriptions into GPX running routes for Strava export. The backend is a Cloudflare Workers API using TypeScript.

### Tech Stack
- Cloudflare Workers (serverless backend)
- TypeScript
- Multiple AI providers (Claude, Gemini, OpenAI) with model selection
- Mapbox for routing/geocoding
- Elevation and GPX generation services

### Current File Structure
```
src/
├── agents/
│   ├── ai/
│   │   ├── providers/ (anthropic.ts, gemini.ts, openai.ts)
│   │   ├── modelSelector.ts
│   │   └── types.ts
│   └── landmarkAgent.ts
├── services/
│   ├── routeService.ts
│   ├── mapboxService.ts
│   ├── elevationService.ts
│   ├── gpxService.ts
│   └── statsService.ts
├── controllers/
│   └── routeController.ts
├── utils/
│   ├── geometry.ts
│   └── xml.ts
└── index.ts
```

---

## Your Task

Analyze my codebase and implement improvements in these priority areas:

1. **Natural Language Processing** - Better extraction of route parameters from user input
2. **Loop Generation Algorithm** - Create true circular running routes (not just A→B)
3. **Distance Optimization** - Hit target distances accurately (e.g., "5 miles" should be ~5.0 miles)
4. **Route Quality** - Runner-specific preferences (trails, scenery, safety)

---

## Priority 1: Route Parameter Extraction

### Problem
The current NLP doesn't reliably extract all route parameters from natural language like:
- "5 mile loop around Green Lake"
- "Easy 3 miler in Capitol Hill with some hills"
- "Long trail run, about 10k, starting from Discovery Park"

### Required Implementation

Create or update `src/types/routeParameters.ts` with this schema:

```typescript
// src/types/routeParameters.ts

export interface RouteParameters {
  // Distance specification
  distance: {
    value: number;
    unit: 'miles' | 'kilometers' | 'meters';
    precision: 'exact' | 'approximate' | 'minimum' | 'maximum';
    originalText: string;
  };
  
  // Location information
  location: {
    startPoint: string | null;
    endPoint: string | null;
    landmarks: string[];
    neighborhood: string | null;
    region: string | null;
  };
  
  // Route shape preferences
  shape: {
    type: 'loop' | 'out-and-back' | 'point-to-point' | 'flexible';
    preference: 'circular' | 'lollipop' | 'figure-eight' | null;
    avoidDoubleBack: boolean;
  };
  
  // Terrain and surface preferences
  terrain: {
    surfaces: Array<{
      type: 'trail' | 'paved' | 'gravel' | 'mixed';
      preference: 'required' | 'preferred' | 'acceptable' | 'avoid';
    }>;
    elevation: {
      profile: 'flat' | 'rolling' | 'hilly' | 'mountainous' | 'any';
      maxGain: number | null;
      preference: 'minimize' | 'maximize' | 'neutral';
    };
  };
  
  // Runner-specific preferences
  preferences: {
    difficulty: 'easy' | 'moderate' | 'challenging' | null;
    scenery: 'high' | 'moderate' | 'low' | null;
    safetyPriority: 'high' | 'normal';
    crowdedness: 'busy' | 'quiet' | 'any';
    waterFountains: boolean;
    restrooms: boolean;
  };
  
  // Confidence and clarification needs
  confidence: {
    overall: number;  // 0-1
    needsClarification: string[];
    assumptions: string[];
  };
}

export interface ParsedRouteRequest {
  parameters: RouteParameters;
  rawInput: string;
  parsedAt: string;
}
```

### Create the Parameter Extraction Prompt

Create `src/prompts/routeParameterExtraction.ts`:

```typescript
// src/prompts/routeParameterExtraction.ts

export const ROUTE_PARAMETER_SYSTEM_PROMPT = `You are a running route planning assistant. Extract structured parameters from natural language route requests.

## Your Task
Parse the user's route request and extract all relevant parameters. Make reasonable assumptions for missing information based on context, but flag low-confidence interpretations.

## Context
- Default location: Seattle, WA area (unless specified otherwise)
- User is a runner planning a running route
- Default to loops unless point-to-point is implied

## Extraction Rules

### Distance Parsing
- "5 mile" / "5 miler" → exact 5 miles
- "about 5 miles" / "around 5 miles" → approximate 5 miles (±10%)
- "at least 5 miles" → minimum 5 miles
- "5k" → 5 kilometers (3.1 miles)
- "10k" → 10 kilometers (6.2 miles)
- "long run" without number → assume 8-12 miles, flag for clarification
- "short run" → assume 2-4 miles
- "easy run" often implies shorter (3-5 miles)

### Route Shape Parsing
- "loop" / "circular" → loop, avoid doubling back
- "out and back" → out-and-back explicitly
- "from X to Y" → point-to-point
- "around [lake/park]" → loop around that feature
- No shape specified + single location → assume loop

### Terrain Signals
- "trail run" / "trails" → prefer unpaved surfaces
- "road run" → prefer paved
- "with some hills" → rolling to hilly elevation
- "flat" / "easy" → minimize elevation gain
- "hilly" / "hills" → seek elevation variety
- Parks/greenways mentioned → likely prefers trails/paths

### Location Parsing
- Named landmarks → geocode as waypoints
- Neighborhoods → use as center point for route generation
- "starting from X" → explicit start point
- "around X" → X is the center, create loop encompassing it

## Output Format
Return ONLY valid JSON matching the RouteParameters schema. No markdown, no explanation, just JSON.`;

export const ROUTE_PARAMETER_EXAMPLES = `
## Examples

### Example 1
Input: "5 mile loop around Green Lake"
Output:
{
  "distance": {"value": 5, "unit": "miles", "precision": "exact", "originalText": "5 mile"},
  "location": {"startPoint": "Green Lake", "endPoint": null, "landmarks": ["Green Lake"], "neighborhood": null, "region": "Seattle"},
  "shape": {"type": "loop", "preference": "circular", "avoidDoubleBack": true},
  "terrain": {"surfaces": [{"type": "paved", "preference": "preferred"}], "elevation": {"profile": "flat", "preference": "neutral", "maxGain": null}},
  "preferences": {"difficulty": null, "scenery": "high", "safetyPriority": "normal", "crowdedness": "any", "waterFountains": false, "restrooms": false},
  "confidence": {"overall": 0.95, "needsClarification": [], "assumptions": ["Green Lake path is ~2.8mi, route will extend into neighborhood"]}
}

### Example 2
Input: "Easy 3 miler in Capitol Hill with some hills"
Output:
{
  "distance": {"value": 3, "unit": "miles", "precision": "exact", "originalText": "3 miler"},
  "location": {"startPoint": null, "endPoint": null, "landmarks": [], "neighborhood": "Capitol Hill", "region": "Seattle"},
  "shape": {"type": "loop", "preference": null, "avoidDoubleBack": true},
  "terrain": {"surfaces": [{"type": "mixed", "preference": "acceptable"}], "elevation": {"profile": "rolling", "preference": "neutral", "maxGain": null}},
  "preferences": {"difficulty": "easy", "scenery": null, "safetyPriority": "normal", "crowdedness": "any", "waterFountains": false, "restrooms": false},
  "confidence": {"overall": 0.85, "needsClarification": ["Do you have a preferred starting point in Capitol Hill?"], "assumptions": ["Loop route preferred", "Some hills means rolling terrain not steep climbs"]}
}

### Example 3
Input: "Long trail run, about 10k, starting from Discovery Park"
Output:
{
  "distance": {"value": 10, "unit": "kilometers", "precision": "approximate", "originalText": "about 10k"},
  "location": {"startPoint": "Discovery Park", "endPoint": null, "landmarks": ["Discovery Park"], "neighborhood": null, "region": "Seattle"},
  "shape": {"type": "loop", "preference": null, "avoidDoubleBack": true},
  "terrain": {"surfaces": [{"type": "trail", "preference": "required"}], "elevation": {"profile": "rolling", "preference": "neutral", "maxGain": null}},
  "preferences": {"difficulty": "moderate", "scenery": "high", "safetyPriority": "normal", "crowdedness": "quiet", "waterFountains": false, "restrooms": false},
  "confidence": {"overall": 0.90, "needsClarification": [], "assumptions": ["Trail run implies unpaved surfaces required", "Discovery Park has good trail network"]}
}`;

export function buildParameterExtractionPrompt(userInput: string): string {
  return `${ROUTE_PARAMETER_SYSTEM_PROMPT}

${ROUTE_PARAMETER_EXAMPLES}

---
Now parse this route request:
"${userInput}"`;
}
```

### Create the Parameter Extraction Service

Create or update a service to use this prompt:

```typescript
// src/services/parameterExtractionService.ts

import { RouteParameters, ParsedRouteRequest } from '../types/routeParameters';
import { buildParameterExtractionPrompt } from '../prompts/routeParameterExtraction';

export class ParameterExtractionService {
  private aiProvider: AIProvider;
  
  constructor(aiProvider: AIProvider) {
    this.aiProvider = aiProvider;
  }
  
  async extractParameters(userInput: string): Promise<ParsedRouteRequest> {
    const prompt = buildParameterExtractionPrompt(userInput);
    
    const response = await this.aiProvider.complete({
      prompt,
      maxTokens: 1000,
      temperature: 0.1, // Low temperature for consistent extraction
    });
    
    try {
      const parameters = JSON.parse(response.content) as RouteParameters;
      
      // Validate required fields
      this.validateParameters(parameters);
      
      return {
        parameters,
        rawInput: userInput,
        parsedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Failed to parse route parameters: ${error.message}`);
    }
  }
  
  private validateParameters(params: RouteParameters): void {
    if (!params.distance?.value || params.distance.value <= 0) {
      throw new Error('Invalid or missing distance');
    }
    if (!params.shape?.type) {
      throw new Error('Invalid or missing route shape');
    }
  }
}
```

---

## Priority 2: Loop Generation Algorithm

### Problem
Current routing uses simple A→B Mapbox routing, which doesn't create proper circular running loops.

### Required Implementation

Create `src/services/loopGenerator.ts`:

```typescript
// src/services/loopGenerator.ts

export interface LoopGenerationConfig {
  center: [number, number];  // [lng, lat]
  targetDistance: number;    // meters
  numWaypoints: number;      // 4-8 typically
  shape: 'circular' | 'lollipop' | 'figure-eight';
  avoidBearings?: number[];  // Directions to avoid (water, highways)
}

export interface GeneratedWaypoint {
  coordinates: [number, number];
  bearing: number;
  distanceFromCenter: number;
  purpose: 'structural' | 'scenic' | 'distance-adjustment';
}

export class LoopGenerator {
  
  /**
   * Main entry point: generate waypoints for a loop route
   */
  generateLoopWaypoints(config: LoopGenerationConfig): GeneratedWaypoint[] {
    switch (config.shape) {
      case 'circular':
        return this.generateCircularWaypoints(config);
      case 'lollipop':
        return this.generateLollipopWaypoints(config);
      case 'figure-eight':
        return this.generateFigureEightWaypoints(config);
      default:
        return this.generateCircularWaypoints(config);
    }
  }
  
  /**
   * Generate waypoints for a circular loop route
   * 
   * Strategy: Create a polygon of waypoints around the center point,
   * then use Mapbox to route between them sequentially.
   */
  generateCircularWaypoints(config: LoopGenerationConfig): GeneratedWaypoint[] {
    const { center, targetDistance, numWaypoints, avoidBearings = [] } = config;
    
    // Estimate radius from target circumference
    // C = 2πr → r = C / (2π)
    // Routes aren't perfect circles, so use factor of ~0.75
    const estimatedRadius = (targetDistance / (2 * Math.PI)) * 0.75;
    
    const waypoints: GeneratedWaypoint[] = [];
    const angleStep = 360 / numWaypoints;
    
    // Add randomness for more interesting routes
    const radiusVariation = 0.15; // ±15% variation
    const angleVariation = 10;    // ±10 degrees
    
    for (let i = 0; i < numWaypoints; i++) {
      let baseAngle = i * angleStep;
      
      // Avoid specified bearings (e.g., toward water)
      if (avoidBearings.length > 0) {
        baseAngle = this.adjustAngleAwayFrom(baseAngle, avoidBearings);
      }
      
      const angle = baseAngle + (Math.random() - 0.5) * angleVariation * 2;
      const radius = estimatedRadius * (1 + (Math.random() - 0.5) * radiusVariation * 2);
      
      const point = this.destinationPoint(center, radius, angle);
      
      waypoints.push({
        coordinates: point,
        bearing: angle,
        distanceFromCenter: radius,
        purpose: 'structural'
      });
    }
    
    return waypoints;
  }
  
  /**
   * Generate a lollipop route (stem + loop)
   * Good when starting point is away from desired loop area
   */
  generateLollipopWaypoints(config: LoopGenerationConfig): GeneratedWaypoint[] {
    const { center, targetDistance } = config;
    
    // For lollipop, we need a separate start point
    // The "stem" connects start to loop center
    // Reduce loop distance to account for stem out-and-back
    const stemDistance = config.targetDistance * 0.2; // 20% for stem
    const loopDistance = targetDistance - (stemDistance * 2);
    
    if (loopDistance < 500) {
      // Fall back to simple circular if not enough distance
      return this.generateCircularWaypoints(config);
    }
    
    const loopWaypoints = this.generateCircularWaypoints({
      ...config,
      targetDistance: loopDistance,
      numWaypoints: 6,
    });
    
    return loopWaypoints;
  }
  
  /**
   * Generate figure-eight pattern
   * Two connected loops - good for variety
   */
  generateFigureEightWaypoints(config: LoopGenerationConfig): GeneratedWaypoint[] {
    const { center, targetDistance } = config;
    
    // Split distance between two loops
    const loopDistance = targetDistance / 2;
    const loopRadius = (loopDistance / (2 * Math.PI)) * 0.75;
    
    // Create two loop centers offset from main center
    const offset = loopRadius * 0.8;
    const center1 = this.destinationPoint(center, offset, 0);    // North
    const center2 = this.destinationPoint(center, offset, 180);  // South
    
    const waypoints: GeneratedWaypoint[] = [];
    
    // First loop (4 points)
    for (let i = 0; i < 4; i++) {
      const angle = i * 90;
      const point = this.destinationPoint(center1, loopRadius * 0.5, angle);
      waypoints.push({
        coordinates: point,
        bearing: angle,
        distanceFromCenter: loopRadius * 0.5,
        purpose: 'structural'
      });
    }
    
    // Second loop (4 points)
    for (let i = 0; i < 4; i++) {
      const angle = i * 90 + 45; // Offset by 45 degrees
      const point = this.destinationPoint(center2, loopRadius * 0.5, angle);
      waypoints.push({
        coordinates: point,
        bearing: angle,
        distanceFromCenter: loopRadius * 0.5,
        purpose: 'structural'
      });
    }
    
    return waypoints;
  }
  
  /**
   * Adjust angle to avoid specified bearings
   */
  private adjustAngleAwayFrom(angle: number, avoidBearings: number[]): number {
    const tolerance = 30; // degrees
    
    for (const avoid of avoidBearings) {
      const diff = Math.abs(this.normalizeAngle(angle - avoid));
      if (diff < tolerance) {
        // Push away from avoided bearing
        angle = avoid + (angle > avoid ? tolerance : -tolerance);
      }
    }
    
    return this.normalizeAngle(angle);
  }
  
  private normalizeAngle(angle: number): number {
    return ((angle % 360) + 360) % 360;
  }
  
  /**
   * Calculate destination point given start, distance (meters), and bearing (degrees)
   */
  destinationPoint(
    start: [number, number], 
    distance: number, 
    bearing: number
  ): [number, number] {
    const R = 6371000; // Earth's radius in meters
    const δ = distance / R; // Angular distance
    const θ = this.toRadians(bearing);
    const φ1 = this.toRadians(start[1]); // lat
    const λ1 = this.toRadians(start[0]); // lng
    
    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(δ) +
      Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
    );
    
    const λ2 = λ1 + Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
    
    return [this.toDegrees(λ2), this.toDegrees(φ2)];
  }
  
  /**
   * Haversine distance between two points (meters)
   */
  haversineDistance(p1: [number, number], p2: [number, number]): number {
    const R = 6371000;
    const φ1 = this.toRadians(p1[1]);
    const φ2 = this.toRadians(p2[1]);
    const Δφ = this.toRadians(p2[1] - p1[1]);
    const Δλ = this.toRadians(p2[0] - p1[0]);
    
    const a = Math.sin(Δφ/2) ** 2 +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }
  
  /**
   * Calculate bearing from p1 to p2 (degrees)
   */
  bearing(p1: [number, number], p2: [number, number]): number {
    const φ1 = this.toRadians(p1[1]);
    const φ2 = this.toRadians(p2[1]);
    const Δλ = this.toRadians(p2[0] - p1[0]);
    
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    
    return (this.toDegrees(Math.atan2(y, x)) + 360) % 360;
  }
  
  /**
   * Calculate midpoint between two points
   */
  midpoint(p1: [number, number], p2: [number, number]): [number, number] {
    return [
      (p1[0] + p2[0]) / 2,
      (p1[1] + p2[1]) / 2
    ];
  }
  
  private toRadians(degrees: number): number {
    return degrees * Math.PI / 180;
  }
  
  private toDegrees(radians: number): number {
    return radians * 180 / Math.PI;
  }
}
```

---

## Priority 3: Distance Optimization

### Problem
Routes often don't hit the target distance accurately. Need iterative refinement.

### Required Implementation

Create `src/services/distanceOptimizer.ts`:

```typescript
// src/services/distanceOptimizer.ts

import { MapboxService } from './mapboxService';
import { LoopGenerator } from './loopGenerator';

export interface RouteAttempt {
  waypoints: [number, number][];
  routedDistance: number;
  geometry: GeoJSON.LineString;
  iterations: number;
}

export interface DistanceOptimizerConfig {
  maxIterations: number;
  tolerance: number;        // e.g., 0.05 for 5%
  dampingFactor: number;    // e.g., 0.6 to prevent oscillation
}

export class DistanceOptimizer {
  private mapboxService: MapboxService;
  private loopGenerator: LoopGenerator;
  private config: DistanceOptimizerConfig;
  
  constructor(
    mapboxService: MapboxService,
    config: Partial<DistanceOptimizerConfig> = {}
  ) {
    this.mapboxService = mapboxService;
    this.loopGenerator = new LoopGenerator();
    this.config = {
      maxIterations: 5,
      tolerance: 0.05,
      dampingFactor: 0.6,
      ...config
    };
  }
  
  /**
   * Iteratively adjust waypoints to hit target distance
   */
  async optimizeForDistance(
    waypoints: [number, number][],
    targetDistance: number,
    profile: 'walking' | 'cycling' = 'walking'
  ): Promise<RouteAttempt> {
    
    let currentWaypoints = [...waypoints];
    let bestAttempt: RouteAttempt | null = null;
    let bestError = Infinity;
    
    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      // Route through current waypoints
      const route = await this.mapboxService.getRoute(currentWaypoints, { profile });
      const routedDistance = route.distance;
      const error = Math.abs(routedDistance - targetDistance) / targetDistance;
      
      console.log(`Iteration ${iteration + 1}: ${routedDistance.toFixed(0)}m (target: ${targetDistance.toFixed(0)}m, error: ${(error * 100).toFixed(1)}%)`);
      
      // Track best attempt
      if (error < bestError) {
        bestError = error;
        bestAttempt = {
          waypoints: [...currentWaypoints],
          routedDistance,
          geometry: route.geometry,
          iterations: iteration + 1
        };
      }
      
      // Check if within tolerance
      if (error <= this.config.tolerance) {
        console.log(`Target distance achieved within ${(this.config.tolerance * 100)}% tolerance`);
        break;
      }
      
      // Adjust waypoints based on error
      if (routedDistance < targetDistance) {
        // Route too short - expand waypoints OR add detour
        const deficit = targetDistance - routedDistance;
        if (deficit > targetDistance * 0.15) {
          // Large deficit - add a detour waypoint
          currentWaypoints = this.addDetourWaypoint(currentWaypoints, deficit);
        } else {
          // Small deficit - scale outward
          const scaleFactor = targetDistance / routedDistance;
          currentWaypoints = this.scaleWaypoints(currentWaypoints, scaleFactor);
        }
      } else {
        // Route too long - contract waypoints
        const scaleFactor = targetDistance / routedDistance;
        currentWaypoints = this.scaleWaypoints(currentWaypoints, scaleFactor);
      }
    }
    
    if (!bestAttempt) {
      throw new Error('Failed to generate route after all iterations');
    }
    
    return bestAttempt;
  }
  
  /**
   * Scale waypoints outward/inward from centroid
   */
  private scaleWaypoints(
    waypoints: [number, number][],
    factor: number
  ): [number, number][] {
    const centroid = this.calculateCentroid(waypoints);
    
    // Apply damping to prevent oscillation
    const dampenedFactor = 1 + (factor - 1) * this.config.dampingFactor;
    
    return waypoints.map(wp => {
      const dx = wp[0] - centroid[0];
      const dy = wp[1] - centroid[1];
      return [
        centroid[0] + dx * dampenedFactor,
        centroid[1] + dy * dampenedFactor
      ] as [number, number];
    });
  }
  
  /**
   * Add a detour waypoint to increase route distance
   */
  private addDetourWaypoint(
    waypoints: [number, number][],
    targetIncrease: number
  ): [number, number][] {
    // Find the longest segment
    let maxLength = 0;
    let maxIndex = 0;
    
    for (let i = 0; i < waypoints.length; i++) {
      const next = (i + 1) % waypoints.length;
      const length = this.loopGenerator.haversineDistance(waypoints[i], waypoints[next]);
      if (length > maxLength) {
        maxLength = length;
        maxIndex = i;
      }
    }
    
    // Create detour perpendicular to longest segment
    const p1 = waypoints[maxIndex];
    const p2 = waypoints[(maxIndex + 1) % waypoints.length];
    const midpoint = this.loopGenerator.midpoint(p1, p2);
    
    // Perpendicular bearing (90 degrees from segment bearing)
    const segmentBearing = this.loopGenerator.bearing(p1, p2);
    const perpBearing = (segmentBearing + 90) % 360;
    
    // Detour distance (roughly 40% of target increase, since we go out and back)
    const detourDistance = targetIncrease * 0.4;
    const detourPoint = this.loopGenerator.destinationPoint(midpoint, detourDistance / 2, perpBearing);
    
    // Insert detour point after maxIndex
    const newWaypoints = [...waypoints];
    newWaypoints.splice(maxIndex + 1, 0, detourPoint);
    
    return newWaypoints;
  }
  
  private calculateCentroid(points: [number, number][]): [number, number] {
    const sum = points.reduce(
      (acc, p) => [acc[0] + p[0], acc[1] + p[1]] as [number, number],
      [0, 0] as [number, number]
    );
    return [sum[0] / points.length, sum[1] / points.length];
  }
}
```

---

## Priority 4: Enhanced Mapbox Service

### Problem
Current Mapbox usage doesn't optimize for running routes.

### Required Implementation

Update `src/services/mapboxService.ts`:

```typescript
// src/services/mapboxService.ts

export interface MapboxRouteOptions {
  profile: 'walking' | 'cycling' | 'driving';
  alternatives?: boolean;
  geometries?: 'geojson' | 'polyline';
  overview?: 'full' | 'simplified' | 'false';
  annotations?: string[];
  continueStraight?: boolean;
  exclude?: string[];
  walkwayBias?: number;   // -1 to 1
  alleyBias?: number;     // -1 to 1
}

export interface MapboxRoute {
  distance: number;       // meters
  duration: number;       // seconds
  geometry: GeoJSON.LineString;
  legs: MapboxRouteLeg[];
}

export interface MapboxRouteLeg {
  distance: number;
  duration: number;
  steps: MapboxRouteStep[];
}

export interface MapboxRouteStep {
  distance: number;
  duration: number;
  geometry: GeoJSON.LineString;
  name: string;
  maneuver: {
    type: string;
    instruction: string;
    location: [number, number];
  };
}

export class MapboxService {
  private accessToken: string;
  private baseUrl = 'https://api.mapbox.com';
  
  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }
  
  /**
   * Get optimized route for running
   */
  async getRunningRoute(
    waypoints: [number, number][],
    preferences: {
      preferTrails?: boolean;
      avoidBusyStreets?: boolean;
      preferScenic?: boolean;
    } = {}
  ): Promise<MapboxRoute> {
    const options: MapboxRouteOptions = {
      profile: 'walking',
      geometries: 'geojson',
      overview: 'full',
      annotations: ['distance', 'duration', 'speed'],
      continueStraight: false, // Allow turns for more interesting routes
      // Prefer walkways/paths over streets
      walkwayBias: preferences.preferTrails ? 1 : 0.5,
      alleyBias: -0.5, // Avoid alleys for safety
    };
    
    return this.getRoute(waypoints, options);
  }
  
  /**
   * Core routing method
   */
  async getRoute(
    waypoints: [number, number][],
    options: Partial<MapboxRouteOptions> = {}
  ): Promise<MapboxRoute> {
    const profile = options.profile || 'walking';
    const coordinates = waypoints.map(wp => wp.join(',')).join(';');
    
    const url = new URL(
      `${this.baseUrl}/directions/v5/mapbox/${profile}/${coordinates}`
    );
    
    url.searchParams.set('access_token', this.accessToken);
    url.searchParams.set('geometries', options.geometries || 'geojson');
    url.searchParams.set('overview', options.overview || 'full');
    
    if (options.annotations) {
      url.searchParams.set('annotations', options.annotations.join(','));
    }
    if (options.alternatives !== undefined) {
      url.searchParams.set('alternatives', String(options.alternatives));
    }
    if (options.continueStraight !== undefined) {
      url.searchParams.set('continue_straight', String(options.continueStraight));
    }
    if (options.walkwayBias !== undefined) {
      url.searchParams.set('walkway_bias', String(options.walkwayBias));
    }
    if (options.alleyBias !== undefined) {
      url.searchParams.set('alley_bias', String(options.alleyBias));
    }
    
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Mapbox API error: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found');
    }
    
    const route = data.routes[0];
    
    return {
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry,
      legs: route.legs,
    };
  }
  
  /**
   * Geocode a location name to coordinates
   */
  async geocode(
    query: string,
    options: {
      proximity?: [number, number];
      bbox?: [number, number, number, number];
      types?: string[];
    } = {}
  ): Promise<{ coordinates: [number, number]; placeName: string }[]> {
    const url = new URL(
      `${this.baseUrl}/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
    );
    
    url.searchParams.set('access_token', this.accessToken);
    url.searchParams.set('limit', '5');
    
    if (options.proximity) {
      url.searchParams.set('proximity', options.proximity.join(','));
    }
    if (options.bbox) {
      url.searchParams.set('bbox', options.bbox.join(','));
    }
    if (options.types) {
      url.searchParams.set('types', options.types.join(','));
    }
    
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`Geocoding failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    return data.features.map((f: any) => ({
      coordinates: f.center as [number, number],
      placeName: f.place_name as string,
    }));
  }
  
  /**
   * Get route using Optimization API (better for loops with multiple waypoints)
   */
  async getOptimizedLoop(
    waypoints: [number, number][],
    options: {
      roundtrip?: boolean;
      source?: 'first' | 'last' | 'any';
      destination?: 'first' | 'last' | 'any';
    } = {}
  ): Promise<MapboxRoute> {
    const coordinates = waypoints.map(wp => wp.join(',')).join(';');
    
    const url = new URL(
      `${this.baseUrl}/optimized-trips/v1/mapbox/walking/${coordinates}`
    );
    
    url.searchParams.set('access_token', this.accessToken);
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('overview', 'full');
    url.searchParams.set('roundtrip', String(options.roundtrip ?? true));
    url.searchParams.set('source', options.source || 'first');
    url.searchParams.set('destination', options.destination || 'last');
    
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Mapbox Optimization API error: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    if (!data.trips || data.trips.length === 0) {
      throw new Error('No optimized trip found');
    }
    
    const trip = data.trips[0];
    
    return {
      distance: trip.distance,
      duration: trip.duration,
      geometry: trip.geometry,
      legs: trip.legs,
    };
  }
}
```

---

## Priority 5: Integrated Route Service

### Required Implementation

Update `src/services/routeService.ts` to orchestrate all components:

```typescript
// src/services/routeService.ts

import { ParameterExtractionService } from './parameterExtractionService';
import { LoopGenerator, LoopGenerationConfig } from './loopGenerator';
import { DistanceOptimizer } from './distanceOptimizer';
import { MapboxService } from './mapboxService';
import { ElevationService } from './elevationService';
import { GpxService } from './gpxService';
import { RouteParameters } from '../types/routeParameters';

export interface GeneratedRoute {
  gpx: string;
  metadata: {
    distance: number;          // meters
    distanceMiles: number;
    elevationGain: number;     // meters
    estimatedDuration: number; // seconds
    waypoints: number;
    shape: string;
  };
  geometry: GeoJSON.LineString;
  parameters: RouteParameters;
}

export class RouteService {
  private parameterService: ParameterExtractionService;
  private loopGenerator: LoopGenerator;
  private distanceOptimizer: DistanceOptimizer;
  private mapboxService: MapboxService;
  private elevationService: ElevationService;
  private gpxService: GpxService;
  
  constructor(
    aiProvider: AIProvider,
    mapboxToken: string,
    elevationApiKey?: string
  ) {
    this.mapboxService = new MapboxService(mapboxToken);
    this.parameterService = new ParameterExtractionService(aiProvider);
    this.loopGenerator = new LoopGenerator();
    this.distanceOptimizer = new DistanceOptimizer(this.mapboxService);
    this.elevationService = new ElevationService(elevationApiKey);
    this.gpxService = new GpxService();
  }
  
  /**
   * Main entry point: Generate a route from natural language
   */
  async generateRoute(userInput: string): Promise<GeneratedRoute> {
    // Step 1: Extract parameters from natural language
    console.log('Step 1: Extracting parameters...');
    const { parameters } = await this.parameterService.extractParameters(userInput);
    
    // Step 2: Geocode the starting location
    console.log('Step 2: Geocoding location...');
    const center = await this.resolveLocation(parameters);
    
    // Step 3: Convert distance to meters
    const targetDistanceMeters = this.toMeters(
      parameters.distance.value,
      parameters.distance.unit
    );
    
    // Step 4: Generate initial waypoints based on shape
    console.log('Step 3: Generating waypoints...');
    const waypointConfig: LoopGenerationConfig = {
      center,
      targetDistance: targetDistanceMeters,
      numWaypoints: this.calculateWaypointCount(targetDistanceMeters),
      shape: this.mapShapePreference(parameters.shape),
    };
    
    const initialWaypoints = this.loopGenerator.generateLoopWaypoints(waypointConfig);
    const waypointCoords = initialWaypoints.map(wp => wp.coordinates);
    
    // Step 5: Close the loop (return to start)
    const closedWaypoints: [number, number][] = [
      center,
      ...waypointCoords,
      center // Return to start
    ];
    
    // Step 6: Optimize for target distance
    console.log('Step 4: Optimizing distance...');
    const optimizedRoute = await this.distanceOptimizer.optimizeForDistance(
      closedWaypoints,
      targetDistanceMeters
    );
    
    // Step 7: Add elevation data
    console.log('Step 5: Adding elevation...');
    const routeWithElevation = await this.elevationService.addElevation(
      optimizedRoute.geometry
    );
    
    // Step 8: Generate GPX
    console.log('Step 6: Generating GPX...');
    const gpx = this.gpxService.generateGpx(routeWithElevation, {
      name: this.generateRouteName(parameters),
      description: userInput,
    });
    
    // Calculate stats
    const elevationGain = this.elevationService.calculateElevationGain(routeWithElevation);
    
    return {
      gpx,
      metadata: {
        distance: optimizedRoute.routedDistance,
        distanceMiles: optimizedRoute.routedDistance / 1609.34,
        elevationGain,
        estimatedDuration: optimizedRoute.routedDistance / 2.5, // ~2.5 m/s running pace
        waypoints: optimizedRoute.waypoints.length,
        shape: parameters.shape.type,
      },
      geometry: routeWithElevation,
      parameters,
    };
  }
  
  /**
   * Resolve location from parameters to coordinates
   */
  private async resolveLocation(params: RouteParameters): Promise<[number, number]> {
    const locationQuery = params.location.startPoint 
      || params.location.landmarks[0] 
      || params.location.neighborhood
      || 'Seattle';
    
    // Add region context for better geocoding
    const fullQuery = params.location.region 
      ? `${locationQuery}, ${params.location.region}`
      : locationQuery;
    
    const results = await this.mapboxService.geocode(fullQuery, {
      // Bias toward Seattle area
      proximity: [-122.3321, 47.6062],
    });
    
    if (results.length === 0) {
      throw new Error(`Could not find location: ${fullQuery}`);
    }
    
    return results[0].coordinates;
  }
  
  /**
   * Convert distance to meters
   */
  private toMeters(value: number, unit: 'miles' | 'kilometers' | 'meters'): number {
    switch (unit) {
      case 'miles':
        return value * 1609.34;
      case 'kilometers':
        return value * 1000;
      case 'meters':
        return value;
    }
  }
  
  /**
   * Calculate appropriate waypoint count based on distance
   */
  private calculateWaypointCount(distanceMeters: number): number {
    // More waypoints for longer routes
    if (distanceMeters < 3000) return 4;      // < 2 miles
    if (distanceMeters < 8000) return 6;      // 2-5 miles
    if (distanceMeters < 16000) return 8;     // 5-10 miles
    return 10;                                 // > 10 miles
  }
  
  /**
   * Map route parameters shape to loop generator shape
   */
  private mapShapePreference(
    shape: RouteParameters['shape']
  ): 'circular' | 'lollipop' | 'figure-eight' {
    if (shape.preference) {
      return shape.preference;
    }
    // Default based on type
    return shape.type === 'loop' ? 'circular' : 'circular';
  }
  
  /**
   * Generate a descriptive route name
   */
  private generateRouteName(params: RouteParameters): string {
    const parts: string[] = [];
    
    // Distance
    parts.push(`${params.distance.value} ${params.distance.unit}`);
    
    // Shape
    parts.push(params.shape.type);
    
    // Location
    if (params.location.startPoint) {
      parts.push(`from ${params.location.startPoint}`);
    } else if (params.location.neighborhood) {
      parts.push(`in ${params.location.neighborhood}`);
    }
    
    return parts.join(' ');
  }
}
```

---

## Implementation Checklist

Complete these tasks in order:

### Phase 1: Foundation (Do First)
- [ ] Create `src/types/routeParameters.ts` with the RouteParameters interface
- [ ] Create `src/prompts/routeParameterExtraction.ts` with the extraction prompt
- [ ] Create `src/services/parameterExtractionService.ts`
- [ ] Test parameter extraction with example inputs

### Phase 2: Loop Generation
- [ ] Create `src/services/loopGenerator.ts`
- [ ] Add unit tests for waypoint generation
- [ ] Test circular, lollipop, and figure-eight patterns

### Phase 3: Distance Optimization
- [ ] Create `src/services/distanceOptimizer.ts`
- [ ] Integrate with MapboxService
- [ ] Test iterative refinement achieves target distances

### Phase 4: Mapbox Enhancement
- [ ] Update `src/services/mapboxService.ts` with running-specific options
- [ ] Add Optimization API support for better loops
- [ ] Add proper error handling and retries

### Phase 5: Integration
- [ ] Update `src/services/routeService.ts` to orchestrate all components
- [ ] Update controller to use new service
- [ ] End-to-end testing with real inputs

### Phase 6: Refinement
- [ ] Add caching for geocoding results
- [ ] Add error recovery and fallback strategies
- [ ] Performance optimization
- [ ] Add logging and monitoring

---

## Testing Commands

After implementation, test with these inputs:

```bash
# Test 1: Simple loop
curl -X POST http://localhost:8787/api/route \
  -H "Content-Type: application/json" \
  -d '{"input": "5 mile loop around Green Lake"}'

# Test 2: Neighborhood route
curl -X POST http://localhost:8787/api/route \
  -H "Content-Type: application/json" \
  -d '{"input": "Easy 3 miler in Capitol Hill with some hills"}'

# Test 3: Trail run
curl -X POST http://localhost:8787/api/route \
  -H "Content-Type: application/json" \
  -d '{"input": "Long trail run, about 10k, starting from Discovery Park"}'

# Test 4: Specific landmarks
curl -X POST http://localhost:8787/api/route \
  -H "Content-Type: application/json" \
  -d '{"input": "6 mile run from Gas Works Park to Fremont and back"}'
```

---

## Success Criteria

The implementation is successful when:

1. **Parameter Extraction**: Correctly parses distance, location, shape, and terrain from 90%+ of natural language inputs
2. **Loop Quality**: Generates true circular routes that don't double back on themselves
3. **Distance Accuracy**: Routes are within 5% of target distance
4. **Route Quality**: Routes prefer trails/paths when requested and avoid doubling back
5. **Performance**: Route generation completes in < 10 seconds

---

## Questions to Ask Me

If you need clarification on any of these:
1. Current AI provider interface/types
2. Existing Mapbox service implementation details
3. Elevation service API details
4. GPX generation requirements
5. Error handling preferences
6. Specific Seattle-area constraints or preferences
