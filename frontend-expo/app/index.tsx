import { useState } from 'react';
import { View, Text } from 'react-native';
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

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [refinementHistory, setRefinementHistory] = useState<string[]>([]);
  const { location, loading: locationLoading, isFallback, showLocationSettingsMessage } = useGeolocation();

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
    <View className="gap-4">
      <Text className="text-sm text-gray-600">
        {locationLoading
          ? 'Detecting location...'
          : isFallback
            ? 'Starting from Seattle (default)'
            : 'Starting from your location'}
      </Text>
      {showLocationSettingsMessage && (
        <Text className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
          Enable location access in Settings to use your current position.
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
          <Text className="text-xs uppercase tracking-wide text-gray-500">Original request</Text>
          <Text className="text-sm text-gray-700">{route.originalQuery}</Text>
        </View>
      )}
      {refinementHistory.length > 0 && (
        <View className="gap-1">
          <Text className="text-xs uppercase tracking-wide text-gray-500">Refinements</Text>
          {refinementHistory.map((item, index) => (
            <Text key={`${item}-${index}`} className="text-sm text-gray-700">• {item}</Text>
          ))}
        </View>
      )}
      <RouteRefineInput loading={refining} onRefine={handleRefine} />
      {refineError && <Text className="text-sm text-red-600">{refineError}</Text>}
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
        <View className="flex-1 bg-gray-200 items-center justify-center">
          <Text className="text-gray-500">Enter a route description and tap Generate</Text>
        </View>
      )}
      <Sidebar
        inputContent={inputContent}
        statsContent={statsContent ?? <View />}
        hasRoute={!!route}
      />
    </View>
  );
}
