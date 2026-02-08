import { RouteData } from '../models/routeParameters';

export function toGPX(route: RouteData): string {
  const lines = route.geometry.coordinates
    .map(([lng, lat, ele]) => {
      const eleTag = ele !== undefined ? `<ele>${ele}</ele>` : '';
      return `<trkpt lon="${lng}" lat="${lat}">${eleTag}</trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Route Runner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${route.name}</name><desc>${route.originalQuery}</desc></metadata>
  <trk>
    <name>${route.name}</name>
    <trkseg>
      ${lines}
    </trkseg>
  </trk>
</gpx>`;
}
