import { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';

const MAX_CHARS = 240;

interface RouteRefineInputProps {
  loading?: boolean;
  onRefine: (instruction: string) => Promise<void> | void;
}

export function RouteRefineInput({ loading, onRefine }: RouteRefineInputProps) {
  const [instruction, setInstruction] = useState('');

  const handleRefine = async () => {
    const trimmed = instruction.trim();
    if (!trimmed || loading) return;

    try {
      await onRefine(trimmed);
      setInstruction('');
    } catch {
      // Caller manages error messaging.
    }
  };

  return (
    <View className="gap-2">
      <Text className="text-sm text-gray-600">Refine this route</Text>
      <BottomSheetTextInput
        value={instruction}
        onChangeText={(text) => setInstruction(text.slice(0, MAX_CHARS))}
        placeholder="Describe changes..."
        placeholderTextColor="#9ca3af"
        editable={!loading}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
      />
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-gray-500">{instruction.length}/{MAX_CHARS}</Text>
        <TouchableOpacity
          onPress={handleRefine}
          disabled={!instruction.trim() || loading}
          className="px-4 py-2 bg-blue-600 rounded-lg flex-row items-center gap-2"
          style={{ opacity: !instruction.trim() || loading ? 0.5 : 1 }}
        >
          {loading ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text className="text-white font-medium">Refining...</Text>
            </>
          ) : (
            <Text className="text-white font-medium">Refine</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
