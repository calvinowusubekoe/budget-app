// Test stand-in for vite-plugin-pwa's virtual module.
export function useRegisterSW() {
  return { needRefresh: [false, () => undefined], offlineReady: [false, () => undefined], updateServiceWorker: async () => undefined };
}
