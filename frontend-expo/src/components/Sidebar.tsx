import { useRef, useMemo } from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';

interface SidebarProps {
  inputContent: React.ReactNode;
  statsContent: React.ReactNode;
  hasRoute: boolean;
}

const DARK_BG = '#0f172a';

export function Sidebar({ inputContent, statsContent, hasRoute }: SidebarProps) {
  const { top, bottom } = useSafeAreaInsets();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['35%', '80%'], []);

  if (hasRoute) {
    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        backgroundStyle={{ backgroundColor: DARK_BG }}
        handleIndicatorStyle={{ backgroundColor: 'rgba(6,182,212,0.5)', width: 40 }}
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
      style={{
        top: top + 12, left: 12, right: 12, position: 'absolute', zIndex: 40,
        backgroundColor: DARK_BG,
        borderRadius: 16,
        shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16,
      }}
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
        <Text style={{ color: '#06b6d4', fontWeight: '700', fontSize: 15, letterSpacing: 1 }}>ROUTE RUNNER</Text>
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        {inputContent}
      </View>
    </View>
  );
}
