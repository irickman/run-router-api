import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Keyboard } from 'react-native';
import { reverseGeocode, forwardGeocode } from '../utils/geocode';

interface LocationPickerProps {
  location: { lat: number; lng: number };
  onLocationChange: (loc: { lat: number; lng: number } | null) => void;
  loading: boolean;
}

export function LocationPicker({ location, onLocationChange, loading }: LocationPickerProps) {
  const [placeName, setPlaceName] = useState('Detecting...');
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) { setPlaceName('Detecting...'); return; }
    reverseGeocode(location.lat, location.lng).then(setPlaceName);
  }, [location, loading]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 3) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      const r = await forwardGeocode(query);
      setResults(r);
      setSearchLoading(false);
    }, 300);
  }, []);

  const selectResult = (item: { name: string; lat: number; lng: number }) => {
    onLocationChange({ lat: item.lat, lng: item.lng });
    setPlaceName(item.name);
    setSearching(false);
    setSearchQuery('');
    setResults([]);
    Keyboard.dismiss();
  };

  const handleUseMyLocation = () => {
    onLocationChange(null);
    setSearching(false);
    setSearchQuery('');
    setResults([]);
  };

  if (searching) {
    return (
      <View className="gap-2">
        <TextInput
          value={searchQuery}
          onChangeText={handleSearch}
          placeholder="Search for a location..."
          placeholderTextColor="rgba(255,255,255,0.4)"
          autoFocus
          className="px-3 py-2 rounded-lg text-white"
          style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(6,182,212,0.5)' }}
        />
        <View className="flex-row gap-2">
          <TouchableOpacity onPress={handleUseMyLocation} className="px-3 py-1.5 rounded-md" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <Text className="text-cyan-400 text-xs">Use My Location</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setSearching(false); setResults([]); setSearchQuery(''); }} className="px-3 py-1.5 rounded-md" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <Text className="text-white/60 text-xs">Cancel</Text>
          </TouchableOpacity>
        </View>
        {results.length > 0 && (
          <FlatList
            data={results}
            keyExtractor={(_, i) => String(i)}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => selectResult(item)}
                className="py-2 px-3 rounded-md"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              >
                <Text className="text-white text-sm">{item.name}</Text>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
          />
        )}
        {searchLoading && <Text className="text-white/40 text-xs">Searching...</Text>}
      </View>
    );
  }

  return (
    <TouchableOpacity onPress={() => setSearching(true)} className="flex-row items-center gap-2 py-1">
      <Text style={{ fontSize: 16 }}>📍</Text>
      <View className="flex-1">
        <Text className="text-white/50 text-xs uppercase tracking-wide">Starting from</Text>
        <Text className="text-white font-medium text-sm" numberOfLines={1}>{placeName}</Text>
      </View>
      <Text className="text-cyan-400 text-xs">Change</Text>
    </TouchableOpacity>
  );
}
