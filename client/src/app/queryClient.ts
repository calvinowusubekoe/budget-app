import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/services/api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    // Writes never wait silently for a connection: offline-capable ones queue on the device (src/offline),
    // the rest fail at once with a clear "can't reach BudgetFlow" message.
    mutations: { retry: false, networkMode: 'always' },
  },
});
