import { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import MapView, { MapPressEvent, Polyline, Marker, Region } from 'react-native-maps';
import type { RouteGeometry } from '../types';

export interface SegmentSelection {
  startCoord: [number, number]; // [lng, lat]
  endCoord: [number, number];
  startIdx: number;
  endIdx: number;
  distanceMeters: number;
}

interface RouteMapProps {
  geometry: RouteGeometry;
  fitBounds?: boolean;
  selectionMode?: boolean;
  onSegmentSelected?: (selection: SegmentSelection | null) => void;
}

const SEATTLE_REGION: Region = {
  latitude: 47.6062,
  longitude: -122.3321,
  latitudeDelta: 0.1,
  longitudeDelta: 0.1,
};

function calcRegion(coords: { latitude: number; longitude: number }[]): Region {
  const lats = coords.map((c) => c.latitude);
  const lngs = coords.map((c) => c.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latDelta = (maxLat - minLat) * 1.2 || 0.01;
  const lngDelta = (maxLng - minLng) * 1.2 || 0.01;
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

function closestPointOnRoute(
  coords: { latitude: number; longitude: number }[],
  target: { latitude: number; longitude: number }
): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const dx = coords[i].latitude - target.latitude;
    const dy = coords[i].longitude - target.longitude;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLon * sinLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function segmentDistance(coords: { latitude: number; longitude: number }[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i++) {
    total += haversineMeters(coords[i], coords[i + 1]);
  }
  return total;
}

export function RouteMap({ geometry, selectionMode, onSegmentSelected }: RouteMapProps) {
  const raw = geometry?.coordinates ?? [];
  const [tapCount, setTapCount] = useState(0);
  const [startIdx, setStartIdx] = useState<number | null>(null);
  const [endIdx, setEndIdx] = useState<number | null>(null);

  const coords = raw.map((c) => ({ latitude: c[1], longitude: c[0] }));

  const handleMapPress = useCallback(
    (e: MapPressEvent) => {
      if (!selectionMode || coords.length === 0) return;
      const { latitude, longitude } = e.nativeEvent.coordinate;
      const idx = closestPointOnRoute(coords, { latitude, longitude });

      if (tapCount === 0) {
        setStartIdx(idx);
        setEndIdx(null);
        setTapCount(1);
        onSegmentSelected?.(null);
      } else {
        const si = Math.min(startIdx!, idx);
        const ei = Math.max(startIdx!, idx);
        setStartIdx(si);
        setEndIdx(ei);
        setTapCount(0);
        const dist = segmentDistance(coords, si, ei);
        onSegmentSelected?.({
          startCoord: [raw[si][0], raw[si][1]],
          endCoord: [raw[ei][0], raw[ei][1]],
          startIdx: si,
          endIdx: ei,
          distanceMeters: dist,
        });
      }
    },
    [selectionMode, coords, tapCount, startIdx, raw, onSegmentSelected]
  );

  if (raw.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-200">
        <Text className="text-gray-600">No route coordinates available</Text>
      </View>
    );
  }

  const initialRegion = calcRegion(coords);
  const routeStart = coords[0];
  const routeEnd = coords[coords.length - 1];

  const hasSelection = startIdx !== null && endIdx !== null;
  const selectedCoords = hasSelection ? coords.slice(startIdx, endIdx + 1) : [];

  return (
    <MapView
      style={{ flex: 1 }}
      initialRegion={initialRegion}
      accessibilityLabel="Route map"
      onPress={handleMapPress}
    >
      <Polyline coordinates={coords} strokeColor="#06b6d4" strokeWidth={4} />
      {hasSelection && (
        <Polyline coordinates={selectedCoords} strokeColor="#f59e0b" strokeWidth={6} />
      )}
      <Marker coordinate={routeStart}>
        <View
          style={{
            width: 28,
            height: 28,
            backgroundColor: '#06b6d4',
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 12 }}>S</Text>
        </View>
      </Marker>
      <Marker coordinate={routeEnd}>
        <View
          style={{
            width: 28,
            height: 28,
            backgroundColor: '#ef4444',
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 12 }}>E</Text>
        </View>
      </Marker>
      {startIdx !== null && (
        <Marker coordinate={coords[startIdx]}>
          <View
            style={{
              width: 20,
              height: 20,
              backgroundColor: '#f59e0b',
              borderRadius: 10,
              borderWidth: 2,
              borderColor: '#fff',
            }}
          />
        </Marker>
      )}
      {endIdx !== null && (
        <Marker coordinate={coords[endIdx]}>
          <View
            style={{
              width: 20,
              height: 20,
              backgroundColor: '#f59e0b',
              borderRadius: 10,
              borderWidth: 2,
              borderColor: '#fff',
            }}
          />
        </Marker>
      )}
    </MapView>
  );
}
