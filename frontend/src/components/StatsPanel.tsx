import type { RouteStats } from '../types';

interface StatsPanelProps {
  stats: RouteStats;
  shape: string;
}

function formatShape(shape: string): string {
  const s = shape.toLowerCase().replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function StatsPanel({ stats, shape }: StatsPanelProps) {
  const paceMinPerMile = 10;
  const estimatedMinutes = Math.round(stats.distance_miles * paceMinPerMile);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg bg-gray-50 p-3">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Distance</div>
        <div className="text-lg font-semibold">{stats.distance_miles.toFixed(2)} mi</div>
      </div>
      <div className="rounded-lg bg-gray-50 p-3">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Elevation</div>
        <div className="text-lg font-semibold">{Math.round(stats.elevation_gain_feet)} ft</div>
      </div>
      <div className="rounded-lg bg-gray-50 p-3">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Est. time</div>
        <div className="text-lg font-semibold">~{estimatedMinutes} min</div>
      </div>
      <div className="rounded-lg bg-gray-50 p-3">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Shape</div>
        <div className="text-lg font-semibold">{formatShape(shape)}</div>
      </div>
    </div>
  );
}
