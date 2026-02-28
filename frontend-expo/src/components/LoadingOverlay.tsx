import { Modal, View, ActivityIndicator, Text } from 'react-native';

export function LoadingOverlay() {
  return (
    <Modal transparent animationType="fade" visible>
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: 'rgba(15,23,42,0.85)' }}>
        <View className="rounded-2xl px-8 py-6 items-center gap-4" style={{ backgroundColor: '#1e293b' }}>
          <ActivityIndicator size="large" color="#06b6d4" />
          <Text style={{ color: '#fff', fontWeight: '600' }}>Generating your route...</Text>
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>This may take a few seconds</Text>
        </View>
      </View>
    </Modal>
  );
}
