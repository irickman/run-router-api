import { useState } from 'react';
import { View, Text, TouchableOpacity, Share } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useToast } from '../hooks/useToast';

const SHARE_BASE = 'https://route-runner-web.fly.dev';

interface RouteActionsProps {
  sessionId: string;
  routeId: string;
  onTryAnother: () => void;
}

export function RouteActions({ sessionId, routeId, onTryAnother }: RouteActionsProps) {
  const toast = useToast();
  const [gpxLoading, setGpxLoading] = useState(false);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'https://route-runner-api.fly.dev';

  const shareUrl = `${SHARE_BASE}/route/${sessionId}/${routeId}`;

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out this running route! ${shareUrl}`,
        url: shareUrl,
      });
    } catch {
      toast.show('Share cancelled');
    }
  };

  const handleGpxDownload = async () => {
    setGpxLoading(true);
    try {
      const filename = `route-runner-${routeId}.gpx`;
      const localUri = `${FileSystem.documentDirectory}${filename}`;

      const result = await FileSystem.downloadAsync(
        `${apiUrl}/api/route/${sessionId}/${routeId}/gpx`,
        localUri
      );

      if (result.status !== 200) throw new Error('Download failed');

      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/gpx+xml',
        dialogTitle: filename,
      });
      toast.show('GPX file ready to share');
    } catch {
      toast.show('Failed to download GPX');
    } finally {
      setGpxLoading(false);
    }
  };

  return (
    <View className="flex-row flex-wrap gap-3">
      <TouchableOpacity
        onPress={handleGpxDownload}
        disabled={gpxLoading}
        className="px-4 py-2 border border-gray-300 rounded-lg"
        style={{ opacity: gpxLoading ? 0.5 : 1 }}
      >
        <Text className="font-medium text-gray-700">{gpxLoading ? 'Downloading...' : 'Download GPX'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={handleShare}
        className="px-4 py-2 border border-gray-300 rounded-lg"
      >
        <Text className="font-medium text-gray-700">Share</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onTryAnother}
        className="px-4 py-2 border border-gray-300 rounded-lg"
      >
        <Text className="font-medium text-gray-700">Try Another</Text>
      </TouchableOpacity>
    </View>
  );
}
