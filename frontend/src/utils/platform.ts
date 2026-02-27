import { Capacitor } from '@capacitor/core';

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export const platform: 'ios' | 'web' = Capacitor.getPlatform() === 'ios' ? 'ios' : 'web';
