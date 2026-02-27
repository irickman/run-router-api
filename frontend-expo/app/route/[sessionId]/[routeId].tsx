import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getRoute, refineRoute } from '../../../src/api';
import type { ApiError } from '../../../src/api';
import type { RouteResponse } from '../../../src/types';
import { RouteMap } from '../../../src/components/RouteMap';
import { StatsPanel } from '../../../src/components/StatsPanel';
import { RouteMetadata } from '../../../src/components/RouteMetadata';
import { RouteRefineInput } from '../../../src/components/RouteRefineInput';
import { RouteActions } from '../../../src/components/RouteActions';
import { ErrorDisplay } from '../../../src/components/ErrorDisplay';
import { Sidebar } from '../../../src/components/Sidebar';

export default function RoutePage() {
  const { sessionId, routeId } = useLocalSearchParams<{ sessionId: string; routeId: string }>();
  const router = useRouter();
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [refinementHistory, setRefinementHistory] = useState<string[]>([]);

  const fetchRoute = () => {
    if (!sessionId || !routeId) return;
    setLoading(true);
    setError(null);
    setRefineError(null);
    getRoute(sessionId, routeId)
      .then((result) => {
        setRoute(result);
        setRefinementHistory([]);
      })
      .catch((err) => setError(err as ApiError))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRoute();
  }, [sessionId, routeId]);

  const handleTryAnother = () => router.replace('/');

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

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-100">
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error || !route) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-100 p-4">
        <View className="w-full max-w-sm gap-3">
          <ErrorDisplay
            error={error ?? { error: 'Route not found' }}
            onRetry={fetchRoute}
          />
          <TouchableOpacity onPress={handleTryAnother}>
            <Text className="text-blue-600 text-center">Create new route</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const statsContent = (
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
  );

  return (
    <View style={{ flex: 1 }}>
      <RouteMap geometry={route.geometry} fitBounds />
      <Sidebar
        inputContent={<View />}
        statsContent={statsContent}
        hasRoute={true}
      />
    </View>
  );
}
