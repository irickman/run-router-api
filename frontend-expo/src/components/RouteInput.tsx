import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';

const PLACEHOLDERS = [
  '10k loop from Green Lake with minimal elevation gain',
  'Half marathon through Discovery Park and along the water',
  'Easy 5 mile run around Capitol Hill',
  'Trail run starting from Seward Park, hilly terrain preferred',
];

const MAX_CHARS = 500;

interface RouteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function RouteInput({ value, onChange, onSubmit, disabled, loading }: RouteInputProps) {
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <View className="gap-3">
      <TextInput
        value={value}
        onChangeText={(text) => onChange(text.slice(0, MAX_CHARS))}
        placeholder={PLACEHOLDERS[placeholderIdx]}
        placeholderTextColor="#9ca3af"
        multiline
        numberOfLines={3}
        editable={!disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
        style={{ minHeight: 72, textAlignVertical: 'top' }}
        accessibilityLabel="Describe your route"
      />
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-gray-500">{value.length}/{MAX_CHARS}</Text>
        <TouchableOpacity
          onPress={onSubmit}
          disabled={!value.trim() || loading || disabled}
          className="px-4 py-2 bg-blue-600 rounded-lg flex-row items-center gap-2 disabled:bg-gray-300"
          style={{ opacity: (!value.trim() || loading || disabled) ? 0.5 : 1 }}
        >
          {loading ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text className="text-white font-medium">Generating...</Text>
            </>
          ) : (
            <Text className="text-white font-medium">Generate Route</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
