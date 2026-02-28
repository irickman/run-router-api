import { View, Text } from 'react-native';
import type { RouteStats } from '../types';

interface StatsPanelProps {
  stats: RouteStats;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 min-w-[45%] rounded-xl p-3" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
      <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</Text>
      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function StatsPanel({ stats }: StatsPanelProps) {
  const paceMinPerMile = 10;
  const estimatedMinutes = Math.round(stats.distance_miles * paceMinPerMile);

  return (
    <View className="flex-row flex-wrap gap-3">
      <StatCard label="Distance" value={`${stats.distance_miles.toFixed(2)} mi`} />
      <StatCard label="Elevation" value={`${Math.round(stats.elevation_gain_feet)} ft`} />
      <StatCard label="Est. Time" value={`~${estimatedMinutes} min`} />
    </View>
  );
}
