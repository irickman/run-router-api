import { useState, useEffect } from 'react';
import * as Location from 'expo-location';

const SEATTLE_FALLBACK = { lat: 47.6062, lng: -122.3321 };

export function useGeolocation(): {
  location: { lat: number; lng: number };
  loading: boolean;
  error: string | null;
  isFallback: boolean;
  showLocationSettingsMessage: boolean;
} {
  const [location, setLocation] = useState<{ lat: number; lng: number }>(SEATTLE_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(true);
  const [showLocationSettingsMessage, setShowLocationSettingsMessage] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function getPosition() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!cancelled) {
            setError('Location access denied. Enable it in Settings to use your current position.');
            setIsFallback(true);
            setShowLocationSettingsMessage(true);
          }
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (!cancelled) {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setError(null);
          setIsFallback(false);
          setShowLocationSettingsMessage(false);
        }
      } catch {
        if (!cancelled) {
          setLocation(SEATTLE_FALLBACK);
          setError('Unable to get location');
          setIsFallback(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    getPosition();
    return () => { cancelled = true; };
  }, []);

  return { location, loading, error, isFallback, showLocationSettingsMessage };
}
