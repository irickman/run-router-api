import { View, Text } from 'react-native';

interface RouteMetadataProps {
  name: string;
}

export function RouteMetadata({ name }: RouteMetadataProps) {
  return (
    <View>
      <Text style={{ color: '#06b6d4', fontSize: 18, fontWeight: '700' }}>{name}</Text>
    </View>
  );
}
