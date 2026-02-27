import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ToastContextValue {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const show = useCallback((msg: string) => {
    setMessage(msg);
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      setMessage(null);
    }, 2000);
    return () => clearTimeout(t);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {visible && message && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2 rounded-lg bg-gray-900 text-white text-sm shadow-lg animate-fade-in"
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
