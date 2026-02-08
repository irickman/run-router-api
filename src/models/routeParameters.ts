export type DistancePrecision = 'exact' | 'approximate' | 'minimum' | 'maximum';
export type ShapeType = 'loop' | 'out-and-back' | 'point-to-point' | 'flexible';
export type ShapePreference = 'circular' | 'lollipop' | 'figure-eight' | null;
export type SurfaceType = 'trail' | 'paved' | 'gravel' | 'mixed';
export type SurfacePreference = 'required' | 'preferred' | 'acceptable' | 'avoid';
export type ElevationProfile = 'flat' | 'rolling' | 'hilly' | 'mountainous' | 'any';
export type ElevationPreference = 'minimize' | 'maximize' | 'neutral';

export interface RouteParameters {
  distance: {
    value: number;
    unit: 'miles' | 'kilometers' | 'meters';
    precision: DistancePrecision;
    originalText: string;
  };
  location: {
    startPoint: string | null;
    endPoint: string | null;
    landmarks: string[];
    neighborhood: string | null;
    region: string | null;
  };
  shape: {
    type: ShapeType;
    preference: ShapePreference;
    avoidDoubleBack: boolean;
  };
  terrain: {
    surfaces: Array<{
      type: SurfaceType;
      preference: SurfacePreference;
    }>;
    elevation: {
      profile: ElevationProfile;
      maxGain: number | null;
      preference: ElevationPreference;
    };
  };
  preferences: {
    difficulty: 'easy' | 'moderate' | 'challenging' | null;
    scenery: 'high' | 'moderate' | 'low' | null;
    safetyPriority: 'high' | 'normal';
    crowdedness: 'busy' | 'quiet' | 'any';
    waterFountains: boolean;
    restrooms: boolean;
  };
  confidence: {
    overall: number;
    needsClarification: string[];
    assumptions: string[];
  };
}

export interface RouteStats {
  distance_miles: number;
  distance_meters: number;
  elevation_gain_feet: number;
  duration_minutes: number;
}

export interface RouteData {
  sessionId: string;
  routeId: string;
  userId?: string;
  geometry: {
    type: 'LineString';
    coordinates: [number, number, number?][];
  };
  stats: RouteStats;
  parameters: RouteParameters;
  metadata: {
    shape: string;
    landmarks?: string[];
  };
  originalQuery: string;
  name: string;
  createdAt: string;
}
