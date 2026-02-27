import { createContext, useContext, useCallback, ReactNode } from 'react';
import Toast from 'react-native-toast-message';

interface ToastContextValue {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const show = useCallback((message: string) => {
    Toast.show({
      type: 'info',
      text1: message,
      visibilityTime: 2000,
      position: 'bottom',
    });
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <Toast />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
