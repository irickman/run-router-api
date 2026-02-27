import { View, Text } from 'react-native';

interface RouteMetadataProps {
  name: string;
}

export function RouteMetadata({ name }: RouteMetadataProps) {
  return (
    <View className="gap-2">
      <View>
        <Text className="text-sm text-gray-500">Route name</Text>
        <Text className="font-medium">{name}</Text>
      </View>
    </View>
  );
}
