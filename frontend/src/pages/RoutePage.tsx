import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRoute } from '../api';
import type { ApiError } from '../api';
import type { RouteResponse } from '../types';
import { RouteMap } from '../components/RouteMap';
import { StatsPanel } from '../components/StatsPanel';
import { RouteMetadata } from '../components/RouteMetadata';
import { RouteActions } from '../components/RouteActions';
import { ErrorDisplay } from '../components/ErrorDisplay';
import { Sidebar } from '../components/Sidebar';

export function RoutePage() {
  const { sessionId, routeId } = useParams<{ sessionId: string; routeId: string }>();
  const navigate = useNavigate();
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId || !routeId) return;
    getRoute(sessionId, routeId)
      .then(setRoute)
      .catch((err) => setError(err as ApiError))
      .finally(() => setLoading(false));
  }, [sessionId, routeId]);

  const handleTryAnother = () => navigate('/');
  const handleRetry = () => {
    if (!sessionId || !routeId) return;
    setError(null);
    setLoading(true);
    getRoute(sessionId, routeId)
      .then(setRoute)
      .catch((err) => setError(err as ApiError))
      .finally(() => setLoading(false));
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin h-10 w-10 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !route) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="max-w-md w-full space-y-3">
          <ErrorDisplay
            error={error ?? { error: 'Route not found' }}
            onRetry={handleRetry}
          />
          <button
            type="button"
            onClick={handleTryAnother}
            className="block w-full px-4 py-2 text-blue-600 hover:underline text-center"
          >
            Create new route
          </button>
        </div>
      </div>
    );
  }

  const statsContent = (
    <div className="space-y-4">
      <StatsPanel stats={route.stats} shape={route.metadata.shape} />
      <RouteMetadata name={route.name} parameters={route.parameters} />
      <RouteActions
        sessionId={route.sessionId}
        routeId={route.routeId}
        onTryAnother={handleTryAnother}
      />
    </div>
  );

  return (
    <div className="h-screen flex flex-col lg:flex-row">
      <Sidebar
        inputContent={<div />}
        statsContent={statsContent}
        hasRoute={true}
      />
      <main className="flex-1 min-h-0">
        <RouteMap geometry={route.geometry} fitBounds />
      </main>
    </div>
  );
}
