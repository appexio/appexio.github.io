# AppExio automatic multi-source catalog

This update preserves the existing Firebase/admin-managed app catalog and adds discovery from several public software catalogs. The homepage merges manual entries with automatic entries; manual AppExio entries take priority when the same app/platform is present.

## Connected catalog integrations

- **F-Droid** — Android open-source app search.
- **WinGet community catalog** — Windows package listings and featured packages.
- **GitHub Releases** — public projects with a latest release containing a recognized installer/archive asset.
- **GitLab Projects** — public software projects and their release pages.
- **Flathub** — Linux/Flatpak app search.
- **Repology** — cross-repository package/version discovery.
- **Homebrew formulae and casks** — macOS/Linux package metadata and publisher/project links.

Search requests run in parallel and fail independently. Results are deduplicated and cached in the browser. This is a multi-source catalog, not an unlimited/universal index: providers have different coverage, quotas, CORS behavior, and terms. Some listings provide only metadata or an official page, not a direct installer.

## Deploy the site

1. Upload the contents of this folder to the root of the existing GitHub Pages repository, keeping the existing file structure.
2. Test the homepage and search for `vlc`, `firefox`, `signal`, `7zip`, `gimp`, or `blender`.

## Recommended: deploy the Cloudflare Worker proxy

Some providers may block direct browser requests through CORS. The included Worker adds a proxy for F-Droid, WinGet, GitLab, Flathub, Repology, and Homebrew. The GitHub Releases search still uses GitHub's public API from the browser and is subject to its unauthenticated rate limits.

1. Create a Cloudflare Worker and paste the contents of `cloudflare-worker/worker.js`.
2. Deploy it and copy the Worker URL, for example `https://your-worker.your-subdomain.workers.dev`.
3. Open `catalog-config.js` and set `window.APPEXIO_CATALOG_WORKER` to that URL without a trailing slash.
4. Deploy the changed `catalog-config.js` to GitHub Pages.

The Worker restricts CORS to the configured origins. If you use a different custom domain, add that exact origin to `ALLOWED_ORIGINS` in `worker.js` before deploying.

## Download and safety model

AppExio does not re-host third-party installers by default. It links to provider listings or publisher/release assets when available. Metadata does not prove a file is safe; users should verify publishers and signatures. Do not scrape or redistribute third-party APK/installer files unless the source's terms and the software license permit it.

There is no single free, unrestricted API for every Google Play app/APK or every Windows installer. Some stores do not expose public APIs, and app-store coverage cannot honestly be described as unlimited. The existing manually managed Firebase catalog remains available even if every external provider is temporarily down.


## Expanded developer and archive discovery sources

The expanded catalog also searches public metadata APIs for:

- **npm** — JavaScript packages and developer tools.
- **Maven Central** — Java/JVM libraries.
- **crates.io** — Rust packages and command-line tools.
- **NuGet** — .NET libraries and tools.
- **Docker Hub** — public container images.
- **Internet Archive software collection** — archived software records where available.

These sources broaden the searchable library beyond consumer installers. Many are developer packages or container images, not one-click Windows/Android installers. AppExio links to the original publisher/catalog page and does not mirror third-party files. Availability, licenses, safety, and platform compatibility vary by listing.

For best cross-browser reliability, deploy the updated `cloudflare-worker/worker.js` and set its base URL in `catalog-config.js`. The APIs are optional and isolated: one provider failing should not stop the other sources. Search APIs may impose rate limits and result caps, so the catalog is broad and expandable, not literally unlimited.
