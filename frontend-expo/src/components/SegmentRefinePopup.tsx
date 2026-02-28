import { useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';

interface SegmentRefinePopupProps {
  segmentDistanceMeters: number;
  loading?: boolean;
  onSubmit: (instruction: string) => Promise<void> | void;
  onCancel: () => void;
}

export function SegmentRefinePopup({
  segmentDistanceMeters,
  loading,
  onSubmit,
  onCancel,
}: SegmentRefinePopupProps) {
  const [instruction, setInstruction] = useState('');

  const handleSubmit = async () => {
    const trimmed = instruction.trim();
    if (!trimmed || loading) return;
    try {
      await onSubmit(trimmed);
      setInstruction('');
    } catch {
      // Caller handles errors.
    }
  };

  const distanceMiles = (segmentDistanceMeters / 1609.344).toFixed(2);

  return (
    <View
      style={{
        position: 'absolute',
        top: 80,
        left: 16,
        right: 16,
        zIndex: 50,
        backgroundColor: '#0f172a',
        borderRadius: 12,
        padding: 14,
        gap: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(6,182,212,0.3)',
      }}
    >
      <View className="flex-row items-center justify-between">
        <Text style={{ color: '#06b6d4', fontWeight: '600', fontSize: 13 }}>
          Refine selected segment
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
          {distanceMiles} mi
        </Text>
      </View>

      <TextInput
        value={instruction}
        onChangeText={(text) => setInstruction(text.slice(0, 200))}
        placeholder="e.g. avoid this street, go through the park instead..."
        placeholderTextColor="rgba(255,255,255,0.35)"
        editable={!loading}
        multiline
        numberOfLines={2}
        style={{
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.12)',
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          color: '#fff',
          fontSize: 14,
        }}
      />

      <View className="flex-row items-center justify-end gap-3">
        <TouchableOpacity onPress={onCancel} disabled={loading} className="px-3 py-2">
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontWeight: '500' }}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSubmit}
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
            <Text className="text-white font-semibold">Refine Segment</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
