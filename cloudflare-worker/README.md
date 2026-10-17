# AppExio automatic catalog Worker

This optional Cloudflare Worker proxies the public F-Droid search API and WinGet catalog API to avoid browser CORS restrictions. It does not need secrets.

## Deploy
1. Open Cloudflare Dashboard → Workers & Pages → Create → Worker.
2. Paste the contents of `worker.js` and deploy.
3. Copy the deployed Worker URL.
4. Open `catalog-config.js` in the website and set `window.APPEXIO_CATALOG_WORKER = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev";` (no trailing slash).
5. Commit and push the website files.

The Worker allows the production AppExio origin and common local development ports. Add any additional development origin to `ALLOWED_ORIGINS` before testing from it.

## Notes
- The WinGet community API may change or be unavailable; AppExio handles provider failures and still keeps your Firestore apps visible.
- F-Droid results link to the official F-Droid listing page rather than treating metadata as proof that an APK is safe.
- GitHub search results are only shown when a public repository has a latest release containing a downloadable installer/archive asset.
