# My Tasks background reminders

This optional Cloudflare Worker is preparation for reliable Web Push when the PWA is closed. It is not deployed automatically.

The cron runs once per minute and checks reminders due within five minutes. Delivery is best effort and may be delayed by Android or browser power-saving behavior; it is not an exact alarm.

Before deployment:
1. Deploy `../firestore.indexes.json` to the original Firebase project `azri-tasks`.
2. Create VAPID keys.
3. Configure Cloudflare secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `GOOGLE_CLIENT_EMAIL`, and `GOOGLE_PRIVATE_KEY`.
4. Put only the public VAPID key in `../firebase-config.js`.
5. Grant the dedicated service account minimum Firestore access.

Never commit private keys or service-account JSON. Do not deploy this Worker until its credentials and permissions have been reviewed.
