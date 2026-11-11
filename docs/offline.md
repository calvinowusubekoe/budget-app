# PWA and offline use

Kontaa installs as a Progressive Web App. It uses `vite-plugin-pwa` (Workbox `generateSW`) with the manifest in `client/vite.config.ts` and icons generated from `client/public/pwa-icon.svg`.

## What the service worker caches

- **Only the app shell:** HTML, JS, CSS, fonts and icons, precached at build time. The app opens and navigates offline.
- **Never API responses.** `/api` requests are excluded from the navigation fallback and have no runtime caching, so no financial data is written to the Cache Storage.
- **Query data stays in memory.** The TanStack Query cache isn't persisted to disk, and signing out clears it.
- **Updates wait for the person.** When a new version is ready the app shows "A new version of Kontaa is ready" with a **Reload** button, so an update never interrupts someone mid-entry.
- **Recovery after a bad deploy.** If nothing renders 8 seconds after load (for example, a broken cached version), a small script in `index.html` activates any waiting update, or checks for one, and reloads once.

## Offline drafts and the sync queue

**What can be made offline:**
- new transactions (income, expenses, transfers)
- personal Susu contributions and withdrawals
- group Susu contribution records

Editing, deleting, confirming and everything else needs a connection, and says so.

**How it works** (`client/src/offline`):

1. **Saving.** The form calls `sendOrQueue`.
   - Online, it posts as usual.
   - If the browser is offline, or the request fails with no response, the record goes to the outbox in IndexedDB under the form's Idempotency-Key.
   - If the server answers with an error (validation, permissions, plan limit), the error shows on the form as usual and nothing is queued.
2. **Never shown as server-confirmed.** A queued record appears only in the sync list, never among the server's records, until the server accepts it.
3. **Statuses:**
   | Status | Meaning |
   | --- | --- |
   | Saved on this device | Queued, not sent yet |
   | Syncing… | Being sent now |
   | Synced | Stored by the server; kept in the list for 24 hours |
   | Sync failed, will retry | Network or server error; retried automatically |
   | Needs your review | The server refused it; shows the reason |
4. **When it syncs:**
   - on sign-in and app start
   - when the browser comes back online
   - once a minute while online
   - when the person taps **Sync now**
   - on a Background Sync wake-up, where supported (Chromium). The service worker can't send records itself, because the access token lives only in page memory, so it wakes any open Kontaa tab. With no tab open, records wait until the app is next opened.
5. **Retries.** Network and server errors (status 0, 429, 5xx) retry after 30 s, 2 min, 10 min, then every 30 min. A 401 pauses the queue until sign-in.
6. **Duplicate prevention.**
   - Each record is sent with its original Idempotency-Key. The server stores one record per key for each person: transactions use `clientRef`, Susu entries and group contributions use `clientRef`.
   - It returns the original record on a replay, including when two copies race.
   - Tabs take turns using `navigator.locks`, so two tabs never send the same queue at once.
7. **Conflicts.** If the server refuses a record (validation error, a plan that's now closed, an archived account, removed workspace access, a plan limit), it becomes **Needs your review** with the server's message. The person can **Try again** after fixing the cause, or **Discard** it. Nothing is changed silently.

## Shared devices

- **Separate per person.** The outbox is a separate IndexedDB database per user (`bf-outbox-<userId>`). Someone else signing in on the same device never sees another person's queued records.
- **Signing out deletes it.** Signing out deletes that user's outbox and clears all cached data. If records haven't synced, the person is warned first and can stay signed in instead.
- **No tokens on disk.** The access token is never stored on disk. The refresh token is an httpOnly cookie scoped to `/api/auth`.

## Starting while offline

The app shell opens, but restoring the session needs the server. If Kontaa can't be reached at startup, the app shows **Can't reach Kontaa** rather than the sign-in page. The session is untouched, queued records are kept, and it reconnects by itself when the connection returns. During a running session a lost connection never signs the person out.

## Known limits

- Offline drafts can only be made in a session that was opened online. Account and category lists come from that session's memory, not from storage.
- Records waiting on the device aren't encrypted at rest beyond the browser's own protections. They are removed on sign-out, and the sign-out warning says so.
- If the session expires while records are queued and someone else then signs in on that device, the first person's queue stays on the device, hidden from the second person, until the first person signs in and it syncs or they sign out.
