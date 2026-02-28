import { useState, useCallback } from 'react';
import { View, Text } from 'react-native';
import MapView, { Marker, MapPressEvent } from 'react-native-maps';
import { useGeolocation } from '../src/hooks/useGeolocation';
import { generateRoute, refineRoute } from '../src/api';
import type { ApiError } from '../src/api';
import type { RouteResponse } from '../src/types';
import { RouteInput } from '../src/components/RouteInput';
import { RouteMap } from '../src/components/RouteMap';
import { StatsPanel } from '../src/components/StatsPanel';
import { RouteMetadata } from '../src/components/RouteMetadata';
import { RouteRefineInput } from '../src/components/RouteRefineInput';
import { RouteActions } from '../src/components/RouteActions';
import { LoadingOverlay } from '../src/components/LoadingOverlay';
import { ErrorDisplay } from '../src/components/ErrorDisplay';
import { Sidebar } from '../src/components/Sidebar';
import { LocationPicker } from '../src/components/LocationPicker';

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [refinementHistory, setRefinementHistory] = useState<string[]>([]);
  const { location: geoLocation, loading: locationLoading, showLocationSettingsMessage } = useGeolocation();
  const [startLocation, setStartLocation] = useState<{ lat: number; lng: number } | null>(null);
  const location = startLocation ?? geoLocation;

  const handleMapPress = useCallback((e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setStartLocation({ lat: latitude, lng: longitude });
  }, []);

  const handleSubmit = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setRefineError(null);
    try {
      const r = await generateRoute(query.trim(), location);
      setRoute(r);
      setRefinementHistory([]);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  };

  const handleTryAnother = () => {
    setRoute(null);
    setError(null);
    setRefineError(null);
    setQuery('');
    setRefinementHistory([]);
  };

  const handleRetry = () => {
    setError(null);
    handleSubmit();
  };

  const handleRefine = async (instruction: string) => {
    if (!route) return;
    setRefining(true);
    setRefineError(null);
    try {
      const next = await refineRoute(route.sessionId, route.routeId, instruction);
      setRoute(next);
      setRefinementHistory((prev) => [...prev, instruction]);
    } catch (err) {
      const apiErr = err as ApiError;
      setRefineError(apiErr.error || 'Failed to refine route');
      throw err;
    } finally {
      setRefining(false);
    }
  };

  const inputContent = (
    <View className="gap-3">
      <LocationPicker
        location={location}
        onLocationChange={setStartLocation}
        loading={locationLoading}
      />
      {showLocationSettingsMessage && (
        <Text style={{ color: '#fbbf24', fontSize: 12, backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: 8, padding: 10 }}>
          Enable location in Settings for your current position.
        </Text>
      )}
      <RouteInput
        value={query}
        onChange={setQuery}
        onSubmit={handleSubmit}
        loading={loading}
      />
      {error && <ErrorDisplay error={error} onRetry={handleRetry} />}
    </View>
  );

  const statsContent = route ? (
    <View className="gap-4">
      <StatsPanel stats={route.stats} />
      <RouteMetadata name={route.name} />
      {route.originalQuery && (
        <View className="gap-1">
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Original request</Text>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>{route.originalQuery}</Text>
        </View>
      )}
      {refinementHistory.length > 0 && (
        <View className="gap-1">
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Refinements</Text>
          {refinementHistory.map((item, index) => (
            <Text key={`${item}-${index}`} style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>• {item}</Text>
          ))}
        </View>
      )}
      <RouteRefineInput loading={refining} onRefine={handleRefine} />
      {refineError && <Text style={{ color: '#fca5a5', fontSize: 13 }}>{refineError}</Text>}
      <RouteActions
        sessionId={route.sessionId}
        routeId={route.routeId}
        onTryAnother={handleTryAnother}
      />
    </View>
  ) : null;

  return (
    <View style={{ flex: 1 }}>
      {loading && <LoadingOverlay />}
      {route ? (
        <RouteMap geometry={route.geometry} fitBounds />
      ) : (
        <MapView
          style={{ flex: 1 }}
          region={{
            latitude: location.lat,
            longitude: location.lng,
            latitudeDelta: 0.04,
            longitudeDelta: 0.04,
          }}
          showsUserLocation
          onPress={handleMapPress}
        >
          {startLocation && (
            <Marker coordinate={{ latitude: startLocation.lat, longitude: startLocation.lng }}>
              <View style={{ width: 28, height: 28, backgroundColor: '#06b6d4', borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}>
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 12 }}>S</Text>
              </View>
            </Marker>
          )}
        </MapView>
      )}
      <Sidebar
        inputContent={inputContent}
        statsContent={statsContent ?? <View />}
        hasRoute={!!route}
      />
    </View>
  );
}
