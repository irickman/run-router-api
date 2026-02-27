import { Modal, View, ActivityIndicator, Text } from 'react-native';

export function LoadingOverlay() {
  return (
    <Modal transparent animationType="fade" visible>
      <View className="flex-1 items-center justify-center bg-black/40">
        <View className="bg-white rounded-xl shadow-xl px-8 py-6 items-center gap-4">
          <ActivityIndicator size="large" color="#2563eb" />
          <Text className="text-gray-700 font-medium">Generating your route...</Text>
        </View>
      </View>
    </Modal>
  );
}
