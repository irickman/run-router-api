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
      <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Refine this route</Text>
      <BottomSheetTextInput
        value={instruction}
        onChangeText={(text) => setInstruction(text.slice(0, MAX_CHARS))}
        placeholder="Describe changes..."
        placeholderTextColor="rgba(255,255,255,0.35)"
        editable={!loading}
        className="w-full px-3 py-2 rounded-lg text-white"
        style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}
      />
      <View className="flex-row items-center justify-between">
        <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{instruction.length}/{MAX_CHARS}</Text>
        <TouchableOpacity
          onPress={handleRefine}
          disabled={!instruction.trim() || loading}
          className="px-4 py-2 rounded-lg flex-row items-center gap-2"
          style={{ backgroundColor: '#06b6d4', opacity: !instruction.trim() || loading ? 0.4 : 1 }}
        >
          {loading ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text className="text-white font-semibold">Refining...</Text>
            </>
          ) : (
            <Text className="text-white font-semibold">Refine</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
