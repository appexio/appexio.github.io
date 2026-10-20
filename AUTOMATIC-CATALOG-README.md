# AppExio — Admin-managed and external catalogs

## Homepage behavior

- **For You:** displays all items added through the AppExio admin panel, plus items discovered from connected public catalogs. External catalog loading starts when the homepage opens.
- **Search in For You:** searches the current library immediately and also queries connected external catalogs when the search is at least two characters long.
- **Apps:** displays only admin-added records categorized as `Apps`.
- **Games:** displays only admin-added records categorized as `Games`.
- **PC software:** displays only admin-added records categorized as `PC Software`.
- **Latest releases:** displays only admin-added records with a Firestore `createdAt` timestamp from the last 3 days.

External catalog records are not mixed into the admin-managed category filters or Latest Releases. Public catalog providers may occasionally be unavailable; one failed provider should not prevent results from other sources.

## Admin-managed items

1. Sign in through `login.html`.
2. Open `admin.html`.
3. Add an item and select its **Content Type**: Apps, Games, or PC Software.
4. Save it. The homepage reads the existing Firebase Firestore `apps` collection.

## External catalog configuration

`catalog-config.js` sets the Cloudflare Worker base URL used to proxy public catalogs. Keep it alongside `index.html`. The Worker implementation is in `cloudflare-worker/worker.js`. If the Worker URL is changed, update `window.APPEXIO_CATALOG_WORKER` in `catalog-config.js` (without a trailing slash) and redeploy the Worker if needed.

## Deployment

Upload the contents of this folder to the root of the existing GitHub Pages repository, preserving the filenames and `cloudflare-worker` folder. Do not replace your Firebase project. The site still depends on the existing Firebase project configuration and Firestore security rules.
