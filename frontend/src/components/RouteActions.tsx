import { useState } from 'react';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { useToast } from '../hooks/useToast';
import { isNativePlatform } from '../utils/platform';

const SHARE_BASE = 'https://route-runner-web.fly.dev';

interface RouteActionsProps {
  sessionId: string;
  routeId: string;
  onTryAnother: () => void;
}

export function RouteActions({ sessionId, routeId, onTryAnother }: RouteActionsProps) {
  const toast = useToast();
  const [gpxLoading, setGpxLoading] = useState(false);
  const apiUrl = import.meta.env.VITE_API_URL || 'https://route-runner-api.fly.dev';

  const shareUrl = `${SHARE_BASE}/route/${sessionId}/${routeId}`;

  const handleShare = async () => {
    if (isNativePlatform()) {
      try {
        await Share.share({
          title: 'Check out this running route!',
          url: shareUrl,
        });
      } catch {
        toast.show('Share cancelled');
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.show('Link copied!');
      } catch {
        toast.show('Failed to copy');
      }
    }
  };

  const handleGpxDownload = async () => {
    setGpxLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/route/${sessionId}/${routeId}/gpx`);
      if (!res.ok) throw new Error('Download failed');

      if (isNativePlatform()) {
        const text = await res.text();
        const filename = `route-runner-${routeId}.gpx`;

        const result = await Filesystem.writeFile({
          path: filename,
          data: text,
          directory: Directory.Documents,
        });

        await Share.share({
          title: filename,
          url: result.uri,
        });
        toast.show('GPX file ready to share');
      } else {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `route-runner-${routeId}.gpx`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      toast.show('Failed to download GPX');
    } finally {
      setGpxLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={handleGpxDownload}
        disabled={gpxLoading}
        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
      >
        {gpxLoading ? 'Downloading...' : 'Download GPX'}
      </button>
      <button
        type="button"
        onClick={handleShare}
        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
      >
        {isNativePlatform() ? 'Share' : 'Copy Link'}
      </button>
      <button
        type="button"
        onClick={onTryAnother}
        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
      >
        Try Another
      </button>
    </div>
  );
}
