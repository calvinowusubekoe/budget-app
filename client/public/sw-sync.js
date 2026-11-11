/* global self, clients */
// Background Sync for the offline outbox.
// The access token lives only in page memory, so the service worker can't send
// records itself. When the browser fires the sync event (connection back), it
// tells any open BudgetFlow tab to flush its queue. With no tab open, records
// stay queued on the device until the app is next opened.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'bf-outbox') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) c.postMessage({ type: 'bf-outbox-sync' });
    }),
  );
});
