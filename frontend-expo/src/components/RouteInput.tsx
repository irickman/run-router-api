import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';

const PLACEHOLDERS = [
  '10k loop from Green Lake with minimal elevation',
  'Half marathon through Discovery Park',
  'Easy 5 mile run around Capitol Hill',
  'Trail run from Seward Park, hilly preferred',
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
        placeholderTextColor="rgba(255,255,255,0.35)"
        multiline
        numberOfLines={3}
        editable={!disabled}
        className="w-full px-3 py-2.5 rounded-lg text-white"
        style={{
          minHeight: 72, textAlignVertical: 'top',
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
        }}
        accessibilityLabel="Describe your route"
      />
      <View className="flex-row items-center justify-between">
        <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{value.length}/{MAX_CHARS}</Text>
        <TouchableOpacity
          onPress={onSubmit}
          disabled={!value.trim() || loading || disabled}
          className="px-5 py-2.5 rounded-lg flex-row items-center gap-2"
          style={{
            backgroundColor: '#06b6d4',
            opacity: (!value.trim() || loading || disabled) ? 0.4 : 1,
          }}
        >
          {loading ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text className="text-white font-semibold">Generating...</Text>
            </>
          ) : (
            <Text className="text-white font-semibold">Generate Route</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
