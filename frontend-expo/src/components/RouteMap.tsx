import { View, Text } from 'react-native';
import MapView, { Polyline, Marker, Region } from 'react-native-maps';
import type { RouteGeometry } from '../types';

interface RouteMapProps {
  geometry: RouteGeometry;
  fitBounds?: boolean;
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

export function RouteMap({ geometry }: RouteMapProps) {
  const raw = geometry?.coordinates ?? [];

  if (raw.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-200">
        <Text className="text-gray-600">No route coordinates available</Text>
      </View>
    );
  }

  const coords = raw.map((c) => ({ latitude: c[1], longitude: c[0] }));
  const initialRegion = calcRegion(coords);
  const start = coords[0];
  const end = coords[coords.length - 1];

  return (
    <MapView style={{ flex: 1 }} initialRegion={initialRegion} accessibilityLabel="Route map">
      <Polyline coordinates={coords} strokeColor="#06b6d4" strokeWidth={4} />
      <Marker coordinate={start}>
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
      <Marker coordinate={end}>
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
    </MapView>
  );
}
