import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { RouteGeometry } from '../types';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface RouteMapProps {
  geometry: RouteGeometry;
  fitBounds?: boolean;
}

export function RouteMap({ geometry, fitBounds = true }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ start: mapboxgl.Marker; end: mapboxgl.Marker } | null>(null);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [-122.3321, 47.6062],
      zoom: 12,
    });
    mapRef.current = map;
    return () => {
      markersRef.current?.start.remove();
      markersRef.current?.end.remove();
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geometry?.coordinates?.length) return;

    const coords = geometry.coordinates;
    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: coords.map((c) => [c[0], c[1]]),
      },
    };

    const applyRoute = () => {
      if (map.getSource('route')) map.removeSource('route');
      if (map.getLayer('route')) map.removeLayer('route');

      map.addSource('route', {
        type: 'geojson',
        data: geojson,
      });
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#2E75B6',
          'line-width': 4,
        },
      });

      markersRef.current?.start.remove();
      markersRef.current?.end.remove();
      const startEl = document.createElement('div');
      startEl.className = 'marker-start';
      startEl.textContent = 'S';
      startEl.style.cssText =
        'width:28px;height:28px;background:#22c55e;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;';
      const endEl = document.createElement('div');
      endEl.className = 'marker-end';
      endEl.textContent = 'E';
      endEl.style.cssText =
        'width:28px;height:28px;background:#ef4444;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;';
      const startMarker = new mapboxgl.Marker(startEl)
        .setLngLat([coords[0][0], coords[0][1]])
        .addTo(map);
      const endMarker = new mapboxgl.Marker(endEl)
        .setLngLat([coords[coords.length - 1][0], coords[coords.length - 1][1]])
        .addTo(map);
      markersRef.current = { start: startMarker, end: endMarker };

      if (fitBounds && coords.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        coords.forEach((c) => bounds.extend([c[0], c[1]]));
        map.fitBounds(bounds, { padding: 40 });
      }
    };

    if (map.isStyleLoaded()) {
      applyRoute();
    } else {
      map.once('load', applyRoute);
    }
  }, [geometry, fitBounds]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-200 text-gray-600">
        <p>Map requires VITE_MAPBOX_TOKEN</p>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full" aria-label="Route map" />;
}
