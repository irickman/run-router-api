import { View, Text } from 'react-native';
import type { RouteStats } from '../types';

interface StatsPanelProps {
  stats: RouteStats;
}

export function StatsPanel({ stats }: StatsPanelProps) {
  return (
    <View className="flex-row flex-wrap gap-3">
      <View className="flex-1 min-w-[45%] rounded-lg bg-gray-50 p-3">
        <Text className="text-xs text-gray-500 uppercase tracking-wide">Distance</Text>
        <Text className="text-lg font-semibold">{stats.distance_miles.toFixed(2)} mi</Text>
      </View>
      <View className="flex-1 min-w-[45%] rounded-lg bg-gray-50 p-3">
        <Text className="text-xs text-gray-500 uppercase tracking-wide">Elevation</Text>
        <Text className="text-lg font-semibold">{Math.round(stats.elevation_gain_feet)} ft</Text>
      </View>
    </View>
  );
}
