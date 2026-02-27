import { useState, useEffect } from 'react';
import { Geolocation } from '@capacitor/geolocation';
import { isNativePlatform } from '../utils/platform';

const SEATTLE_FALLBACK = { lat: 47.6062, lng: -122.3321 };

export function useGeolocation(): {
  location: { lat: number; lng: number };
  loading: boolean;
  error: string | null;
  /** True when using Seattle fallback (denied, unsupported, or failed) */
  isFallback: boolean;
  /** True when on iOS and location was denied - show Settings guidance */
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
        if (isNativePlatform()) {
          const permission = await Geolocation.requestPermissions();
          if (permission.location !== 'granted') {
            throw new Error('Location denied');
          }
          const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
          if (!cancelled) {
            setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            setError(null);
            setIsFallback(false);
            setShowLocationSettingsMessage(false);
          }
        } else {
          if (!navigator.geolocation) {
            throw new Error('Geolocation not supported');
          }
          await new Promise<void>((resolve) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                if (!cancelled) {
                  setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                  setError(null);
                  setIsFallback(false);
                  setShowLocationSettingsMessage(false);
                }
                resolve();
              },
              () => {
                if (!cancelled) {
                  setLocation(SEATTLE_FALLBACK);
                  setError('Location denied');
                  setIsFallback(true);
                }
                resolve();
              }
            );
          });
        }
      } catch {
        if (!cancelled) {
          setLocation(SEATTLE_FALLBACK);
          setError('Location denied');
          setIsFallback(true);
          setShowLocationSettingsMessage(isNativePlatform());
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    getPosition();
    return () => { cancelled = true; };
  }, []);

  return { location, loading, error, isFallback, showLocationSettingsMessage };
}
