import { useState, useRef } from 'react';
import { useGeolocation } from '../hooks/useGeolocation';
import { generateRoute } from '../api';
import type { ApiError } from '../api';
import type { RouteResponse } from '../types';
import { RouteInput } from '../components/RouteInput';
import { RouteMap } from '../components/RouteMap';
import { StatsPanel } from '../components/StatsPanel';
import { RouteMetadata } from '../components/RouteMetadata';
import { RouteActions } from '../components/RouteActions';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { ErrorDisplay } from '../components/ErrorDisplay';
import { Sidebar } from '../components/Sidebar';

export function HomePage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { location, loading: locationLoading, isFallback, showLocationSettingsMessage } = useGeolocation();

  const handleSubmit = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await generateRoute(query.trim(), location);
      setRoute(r);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  };

  const handleTryAnother = () => {
    setRoute(null);
    setError(null);
    setQuery('');
    inputRef.current?.focus();
  };

  const handleRetry = () => {
    setError(null);
    handleSubmit();
  };

  const inputContent = (
    <div className="space-y-4">
      <p className="text-sm text-gray-600" aria-live="polite">
        {locationLoading
          ? 'Detecting location...'
          : isFallback
            ? 'Starting from Seattle (default)'
            : 'Starting from your location'}
      </p>
      {showLocationSettingsMessage && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
          Enable location access in Settings to use your current position.
        </p>
      )}
      <RouteInput
        value={query}
        onChange={setQuery}
        onSubmit={handleSubmit}
        loading={loading}
        inputRef={inputRef}
      />
      {error && <ErrorDisplay error={error} onRetry={handleRetry} />}
    </div>
  );

  const statsContent = route ? (
    <div className="space-y-4">
      <StatsPanel stats={route.stats} shape={route.metadata.shape} />
      <RouteMetadata name={route.name} parameters={route.parameters} />
      <RouteActions
        sessionId={route.sessionId}
        routeId={route.routeId}
        onTryAnother={handleTryAnother}
      />
    </div>
  ) : null;

  return (
    <div className="h-screen flex flex-col lg:flex-row">
      {loading && <LoadingOverlay />}
      <Sidebar
        inputContent={inputContent}
        statsContent={statsContent ?? <div />}
        hasRoute={!!route}
      />
      <main className="flex-1 min-h-0 relative">
        {route ? (
          <RouteMap geometry={route.geometry} fitBounds />
        ) : (
          <div className="w-full h-full bg-gray-200 flex items-center justify-center">
            <p className="text-gray-500">Enter a route description and click Generate</p>
          </div>
        )}
      </main>
    </div>
  );
}
