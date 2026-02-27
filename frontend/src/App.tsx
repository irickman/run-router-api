import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { ToastProvider } from './hooks/useToast';
import { HomePage } from './pages/HomePage';
import { RoutePage } from './pages/RoutePage';

function App() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      SplashScreen.hide().catch(() => {});
      StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    }
  }, []);

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/route/:sessionId/:routeId" element={<RoutePage />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
