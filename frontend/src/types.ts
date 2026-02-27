export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number, number?][];
}

export interface RouteStats {
  distance_miles: number;
  distance_meters: number;
  elevation_gain_feet: number;
  duration_minutes: number;
}

export interface RouteResponse {
  sessionId: string;
  routeId: string;
  name: string;
  geometry: RouteGeometry;
  stats: RouteStats;
  parameters: RouteParameters;
  metadata: RouteMetadata;
  gpxUrl: string;
}

export interface RouteParameters {
  distance: { value: number; unit: string; precision: string; originalText: string };
  location: {
    startPoint: string | null;
    endPoint: string | null;
    landmarks: string[];
    neighborhood: string | null;
    region: string | null;
  };
  shape: { type: string; preference: string | null; avoidDoubleBack: boolean };
  terrain: {
    surfaces: Array<{ type: string; preference: string }>;
    elevation: { profile: string; maxGain: number | null; preference: string };
  };
  preferences: Record<string, unknown>;
  confidence: {
    overall: number;
    needsClarification: string[];
    assumptions: string[];
  };
}

export interface RouteMetadata {
  shape: string;
  landmarks?: string[];
}
