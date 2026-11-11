import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { router } from '@/app/router';
import { queryClient } from '@/app/queryClient';
import { refreshSession } from '@/services/api';
import { useTheme } from '@/hooks/useTheme';
import { OfflineRuntime, UpdatePrompt } from '@/offline/OfflineUi';
import './index.css';

function App() {
  // Restore the session from the httpOnly refresh cookie on load.
  useEffect(() => {
    void refreshSession();
  }, []);
  const { pref } = useTheme();
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <OfflineRuntime />
      <UpdatePrompt />
      <Toaster
        position="top-center"
        theme={pref}
        toastOptions={{ className: '!glass-strong !rounded-2xl !text-ink !border-[var(--glass-border)]' }}
      />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
