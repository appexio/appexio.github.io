AUSIC — GITHUB PAGES EDITION (UI HOTFIX v11)
================================

This is a static, audio-first music website with a spacious desktop layout and a mobile-first, single-row music list. It no longer needs start.bat, Node.js, package.json, or a custom backend.

DESIGN UPDATES
--------------
- Left navigation sidebar on desktop with Home, Search, Explore, Liked songs, Recently played, Local audio, Playlists, and Preferences.
- The main music area now uses the available width instead of being squeezed by a permanent right-hand player panel.
- 4-column song cards on regular desktop screens and up to 5 columns on wide screens.
- Mobile music results become full-width horizontal rows, with cover art on the left and song details on the right.
- A floating bottom player dock and mobile bottom navigation.
- Queue, lyrics, and track information are available in an optional player drawer.
- Search, preferences, import music, and navigation controls are sized for touch.

DEPLOY TO GITHUB PAGES
----------------------
1. Extract this ZIP.
2. Create or open your GitHub repository.
3. Upload the CONTENTS of this extracted folder directly to the repository root (the folder containing index.html). Do not upload only the outer folder.
4. In GitHub, open Settings → Pages. Choose “Deploy from a branch”, select your branch (usually main), and choose “/(root)”. Save.
5. After GitHub Pages publishes the site, open the Pages URL. HTTPS is required for the optional offline app shell.

AUDIO CATALOG / SEARCH
----------------------
- Audio discovery uses the public read-only Audius API directly from the browser; no API key settings screen is required.
- The app uses Audius's official stream endpoint for audio playback. This site does not embed YouTube videos or extract MP3 audio from YouTube.
- Audius owns the upstream catalog availability. Some tracks can be restricted, removed, or unavailable in a region; choose another track if one fails.
- Lyrics are looked up from LRCLIB when available.
- The remote catalog requires an internet connection. The local MP3 library, likes, history, and playlists are saved in the current browser/device; they do not sync to other devices.
- Import local audio files using the “+” button. Supported types depend on the browser and may include MP3, M4A, AAC, OGG, OPUS, WAV, FLAC, AIFF, and WMA. Imported audio is stored in this browser's IndexedDB. Keep backup copies of your original files.

IMPORTANT STATIC HOSTING LIMITATION
-----------------------------------
GitHub Pages only hosts static files; it does not run a Node server. Version 4 has been updated to make the search, trending feed, streams, and lyrics requests directly from the browser instead of using /api/* routes. That means API availability and browser/CORS rules still depend on the upstream providers.

PRIVACY
-------
Likes, recently played, theme, local playlists, and saved queue are stored in local browser storage. There is no Ausic user account or cross-device sync in this version.
