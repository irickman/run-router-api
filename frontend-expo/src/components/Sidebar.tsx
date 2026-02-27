import { useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';

interface SidebarProps {
  inputContent: React.ReactNode;
  statsContent: React.ReactNode;
  hasRoute: boolean;
}

export function Sidebar({ inputContent, statsContent, hasRoute }: SidebarProps) {
  const { top, bottom } = useSafeAreaInsets();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['32%', '75%'], []);

  if (hasRoute) {
    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        backgroundStyle={{ backgroundColor: 'white' }}
        handleIndicatorStyle={{ backgroundColor: '#d1d5db' }}
      >
        <BottomSheetScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingBottom: bottom + 28, gap: 16 }}
        >
          {statsContent}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  }

  return (
    <View
      style={{ top: top + 12, left: 12, right: 12, position: 'absolute', zIndex: 40 }}
      className="bg-white rounded-xl shadow-lg overflow-hidden"
    >
      <View className="px-4 py-3 border-b border-gray-100">
        <Text className="font-medium">Describe your route</Text>
      </View>
      <View className="px-4 py-4">
        {inputContent}
      </View>
    </View>
  );
}
