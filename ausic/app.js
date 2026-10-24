(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORE_KEY = 'ausic-platform-v3';
  const YEAR = new Date().getFullYear();
  const audio = $('#local-audio');
  const pageContent = $('#page-content');
  const modalBackdrop = $('#modal-backdrop');
  const modalCard = $('#modal-card');
  const toastRegion = $('#toast-region');
  const state = {
    page: 'home', query: '', results: [], resultMap: new Map(), cache: new Map(),
    liked: [], history: [], playlists: [], localTracks: [], queue: [], queueIndex: -1,
    currentTrack: null, isPlaying: false, theme: 'dark', shuffle: false, repeat: 'off',
    volume: 75, panelTab: 'queue', lyrics: null, lyricTokens: [], sleepTimer: null,
    currentCollection: [], currentCollectionName: '', searchError: '', busy: false,
    category: 'all', progressInterval: null, localObjectUrl: null, lastView: 'home', historyPages: []
  };
  let dbPromise;

  // Static-hosting version: the public Audius read-only API is called directly
  // from the browser, so this site can be deployed to GitHub Pages without Node.
  const AUDIO_API = 'https://api.audius.co/v1';
  const AUDIO_APP_NAME = 'Ausic';
  function audiusEndpoint(resource, params = {}) {
    const url = new URL(`${AUDIO_API}${resource}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    url.searchParams.set('app_name', AUDIO_APP_NAME);
    return url.toString();
  }
  function mapAudiusTrack(track) {
    if (!track?.id || track.is_streamable === false) return null;
    const artwork = typeof track.artwork === 'string' ? track.artwork : (track.artwork?.['1000x1000'] || track.artwork?.['480x480'] || track.artwork?.['150x150'] || track.artwork?.['100x100'] || '');
    const permalink = typeof track.permalink === 'string' ? `https://audius.co${track.permalink.startsWith('/') ? '' : '/'}${track.permalink}` : '';
    return {
      id: String(track.id), type: 'audius', title: String(track.title || 'Untitled track').slice(0, 220),
      artist: String(track.user?.name || track.user?.handle || track.artist_name || 'Unknown artist').slice(0, 140),
      thumbnail: artwork, description: String(track.description || '').slice(0, 1200),
      duration: Math.max(0, Number(track.duration) || 0), genre: String(track.genre || ''),
      permalink, publishedAt: track.release_date || track.release_date_original || ''
    };
  }
  async function getAudius(resource, params = {}) {
    const response = await fetch(audiusEndpoint(resource, params), {
      headers: { 'Accept': 'application/json' },
      mode: 'cors',
      signal: AbortSignal.timeout ? AbortSignal.timeout(18000) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.errors?.[0]?.message || `Music catalog request failed (${response.status}).`);
    return data;
  }

  function escapeHTML(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  }
  function keyOf(track) { return track ? `${track.type === 'local' ? 'local' : 'audio'}:${track.id}` : ''; }
  function byKey(key) {
    if (!key) return null;
    const all = [state.currentTrack, ...state.results, ...state.history, ...state.liked.map(k => state.cache.get(k)), ...state.localTracks, ...state.playlists.flatMap(p => p.tracks || []), ...state.queue].filter(Boolean);
    for (const item of all) if (keyOf(item) === key) return item;
    return state.cache.get(key) || null;
  }
  function remember(track) {
    if (track && track.id) state.cache.set(keyOf(track), track);
    return track;
  }
  function normalizeTrack(track) {
    return remember({
      id: String(track.id), type: track.type === 'local' ? 'local' : 'audius', title: track.title || 'Untitled track',
      artist: track.artist || 'Unknown artist', thumbnail: track.thumbnail || '', description: track.description || '',
      publishedAt: track.publishedAt || track.releaseDate || '', channelId: track.channelId || '', filename: track.filename || '', duration: Number(track.duration) || 0, genre: track.genre || '', permalink: track.permalink || ''
    });
  }
  function toast(message, kind = 'normal', duration = 3200) {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = message;
    toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), duration);
  }
  function readStored() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      state.liked = Array.isArray(saved.liked) ? saved.liked.map(key => String(key).replace(/^yt:/, 'audio:')) : [];
      state.localTracks = Array.isArray(saved.localTracks) ? saved.localTracks.map(normalizeTrack).filter(t => t.type === 'local') : [];
      state.localTracks.forEach(remember);
      if (Array.isArray(saved.likedTracks)) saved.likedTracks.map(normalizeTrack).forEach(remember);
      state.history = Array.isArray(saved.history) ? saved.history.map(normalizeTrack) : [];
      state.playlists = Array.isArray(saved.playlists) ? saved.playlists.map(p => ({ id: p.id || crypto.randomUUID(), name: String(p.name || 'Playlist').slice(0, 70), tracks: Array.isArray(p.tracks) ? p.tracks.map(normalizeTrack) : [] })) : [];
      state.theme = saved.theme === 'light' ? 'light' : 'dark';
      state.shuffle = Boolean(saved.shuffle);
      state.repeat = ['off', 'one', 'all'].includes(saved.repeat) ? saved.repeat : 'off';
      state.volume = Number.isFinite(saved.volume) ? Math.max(0, Math.min(100, saved.volume)) : 75;
      if (Array.isArray(saved.queue)) state.queue = saved.queue.map(normalizeTrack);
      if (saved.currentTrack && saved.currentTrack.type !== 'local' && saved.currentTrack.id) state.currentTrack = normalizeTrack(saved.currentTrack);
    } catch (error) { console.warn('Could not load saved Ausic state:', error); }
    state.liked.forEach(key => { const track = state.history.find(t => keyOf(t) === key); if (track) remember(track); });
    applyTheme();
    $('#volume-slider').value = String(state.volume);
    paintRange($('#volume-slider'));
  }
  function persist() {
    const payload = {
      liked: state.liked, likedTracks: state.liked.map(byKey).filter(Boolean).map(t => ({id:t.id,type:t.type,title:t.title,artist:t.artist,thumbnail:t.thumbnail,description:t.description,publishedAt:t.publishedAt,channelId:t.channelId,filename:t.filename,duration:t.duration})), history: state.history.slice(0, 60),
      localTracks: state.localTracks.map(t => ({ id:t.id,type:t.type,title:t.title,artist:t.artist,thumbnail:t.thumbnail,description:t.description,filename:t.filename,duration:t.duration })),
      playlists: state.playlists, theme: state.theme, shuffle: state.shuffle,
      repeat: state.repeat, volume: state.volume,
      queue: state.queue.slice(0, 100).map(t => ({ id:t.id,type:t.type,title:t.title,artist:t.artist,thumbnail:t.thumbnail,description:t.description,publishedAt:t.publishedAt,channelId:t.channelId,filename:t.filename })),
      currentTrack: state.currentTrack && state.currentTrack.type !== 'local' ? state.currentTrack : null
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); } catch (e) { console.warn('Ausic storage is full.', e); }
  }
  function openDB() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('This browser does not support offline audio storage.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('AusicOfflineLibrary', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open offline music storage.'));
    });
    return dbPromise;
  }
  async function dbPut(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('audio', 'readwrite');
      tx.objectStore('audio').put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Could not save audio file.'));
    });
  }
  async function dbGet(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('audio', 'readonly');
      const req = tx.objectStore('audio').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('audio', 'readwrite');
      tx.objectStore('audio').delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
  function applyTheme() {
    document.body.classList.toggle('theme-light', state.theme === 'light');
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = state.theme === 'light' ? '#edf1e9' : '#080a08';
    $('#theme-toggle').textContent = state.theme === 'light' ? '☾' : '☼';
  }
  function trackThumb(track, extra = '') {
    const thumb = track?.thumbnail;
    if (thumb) return `<img class="track-art ${extra}" src="${escapeHTML(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.parentElement.classList.add('fallback-art')">`;
    return `<div class="track-art-placeholder ${extra}">♫</div>`;
  }
  function isLiked(track) { return state.liked.includes(keyOf(track)); }
  function renderTrackCard(track, index = 0) {
    const t = normalizeTrack(track);
    return `<article class="track-card" data-track-key="${escapeHTML(keyOf(t))}">
      <div class="track-art-wrap">${trackThumb(t)}<button class="card-play" data-action="play-card" data-key="${escapeHTML(keyOf(t))}" aria-label="Play ${escapeHTML(t.title)}">▶</button><button class="card-options" data-action="track-menu" data-key="${escapeHTML(keyOf(t))}" aria-label="More options">•••</button></div>
      <h3 title="${escapeHTML(t.title)}">${escapeHTML(t.title)}</h3><p title="${escapeHTML(t.artist)}">${escapeHTML(t.artist)}</p>
      <span class="content-chip ${t.type === 'local' ? 'badge-local' : ''}">${t.type === 'local' ? 'LOCAL AUDIO' : 'AUDIO STREAM'}</span>
    </article>`;
  }
  function renderCards(tracks, emptyText = 'No tracks yet.') {
    if (!tracks?.length) return `<div class="empty-state"><span class="empty-icon">♫</span><b>${escapeHTML(emptyText)}</b><p>Search for a song or import music from your device to get started.</p><button class="hero-primary" data-action="go-search">⌕ Search music</button></div>`;
    return `<div class="track-grid">${tracks.map(renderTrackCard).join('')}</div>`;
  }
  function renderSkeletons(count = 4) {
    return `<div class="skeleton-grid">${Array.from({length:count}, () => '<div class="skeleton-card"><div class="skeleton-thumb"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>').join('')}</div>`;
  }
  function renderQuickCards() {
    const moods = [
      ['Pop','↗','latest pop hits'], ['Chill','☾','lofi chill beats'], ['Desi','✦','Pakistani music hits'], ['Focus','⌁','instrumental focus music'],
      ['Rock','⚡','rock music mix'], ['Classical','♬','classical piano music'], ['Electronic','◉','electronic dance music'], ['Jazz','♬','popular jazz music']
    ];
    return `<div class="quick-grid">${moods.map(([name,symbol,query]) => `<button class="quick-card" data-mood="${name}" data-symbol="${escapeHTML(symbol)}" data-query="${escapeHTML(query)}"><span>${name}</span></button>`).join('')}</div>`;
  }
  function renderHome() {
    const recent = state.history.slice(0, 4);
    pageContent.innerHTML = `
      <section class="section-block home-discover-first"><div class="section-heading"><div><h2>Discover music</h2><p>Find your next repeat from the audio catalog.</p></div><button class="text-btn" data-action="go-search">Search everything ↗</button></div><div id="home-results">${state.busy ? renderSkeletons() : state.results.length ? renderCards(state.results.slice(0,8)) : renderHomeConnectState()}</div></section>
      ${recent.length ? `<section class="section-block"><div class="section-heading"><div><h2>Pick up where you left off</h2><p>Your recent listening on this device.</p></div><button class="text-btn" data-page="history">View history ↗</button></div>${renderCards(recent, 'Nothing played yet.')}</section>` : ''}
      <section class="section-block"><div class="section-heading"><div><h2>Find your mood</h2><p>A sound for every side of you.</p></div></div>${renderQuickCards()}</section>
      ${state.localTracks.length ? `<section class="section-block"><div class="section-heading"><div><h2>From your device</h2><p>Audio files saved in your local Ausic library.</p></div><button class="text-btn" data-page="local">View library ↗</button></div>${renderCards(state.localTracks.slice(0,4))}</section>` : ''}
    `;
    state.currentCollection = state.results;
    state.currentCollectionName = 'Explore music';
  }
  function renderHomeConnectState() {
    return `<div class="wide-banner"><div class="banner-symbol">♫</div><div><h3>Your audio mix starts here</h3><p>Search real audio tracks, browse moods, or import MP3 and FLAC files from your device. No video player and no API-key setup screen.</p></div><button class="hero-primary" data-action="go-search">Find music</button></div>`;
  }
  function pageTitle(kicker, title, description = '') {
    return `<header class="page-title"><span class="eyebrow">${escapeHTML(kicker)}</span><h1>${escapeHTML(title)}</h1>${description ? `<p>${escapeHTML(description)}</p>` : ''}</header>`;
  }
  function renderSearch() {
    const q = state.query;
    pageContent.innerHTML = `${pageTitle('SEARCH MUSIC', q ? `Results for “${q}”` : 'What sounds good?', q ? 'Audio tracks that you can stream directly in Ausic.' : 'Search songs, artists, remixes, instrumental tracks, and moods.')}
      ${!q ? `<section class="section-block"><div class="section-heading"><div><h2>Browse by mood</h2><p>Choose a sound to get started.</p></div></div>${renderQuickCards()}</section><div class="hint-box"><b>Search tip:</b> Add an artist name or terms like “official audio”, “live”, or “instrumental” to narrow your results.</div>` : `<div class="results-toolbar"><div class="filter-pills"><button class="filter-pill active" data-search-query="${escapeHTML(q)}">All results</button><button class="filter-pill" data-search-query="${escapeHTML(q + ' official audio')}">Official audio</button><button class="filter-pill" data-search-query="${escapeHTML(q + ' live')}">Live</button><button class="filter-pill" data-search-query="${escapeHTML(q + ' instrumental')}">Instrumental</button></div><span class="result-count">${state.busy ? '<span class="spinner"></span> Searching' : `${state.results.length} results`}</span></div><div id="search-results">${state.busy ? renderSkeletons(8) : state.searchError ? renderSearchError(state.searchError) : renderCards(state.results, 'No matching music found.')}</div>`}`;
    state.currentCollection = state.results;
    state.currentCollectionName = 'Search results';
  }
  function renderSearchError(message) {
    return `<div class="empty-state"><span class="empty-icon">⌕</span><b>Music search could not finish</b><p>${escapeHTML(message)}</p><button class="hero-primary" data-action="retry-search">Try again</button></div>`;
  }
  function renderExplore() {
    pageContent.innerHTML = `${pageTitle('EXPLORE', 'Follow the feeling.', 'Browse real audio streams by genre, mood, and artist — no videos.')}
      <section class="section-block"><div class="section-heading"><div><h2>Browse moods & genres</h2><p>Tap a card to load real search results.</p></div></div>${renderQuickCards()}</section>
      <section class="section-block"><div class="section-heading"><div><h2>Try a search</h2><p>Start with a phrase or a specific artist.</p></div></div><div class="filter-pills"><button class="filter-pill" data-query="top songs ${YEAR}">Top songs</button><button class="filter-pill" data-query="new music ${YEAR}">New music</button><button class="filter-pill" data-query="acoustic covers popular songs">Acoustic covers</button><button class="filter-pill" data-query="movie soundtracks">Soundtracks</button><button class="filter-pill" data-query="ambient study music">Ambient</button><button class="filter-pill" data-query="Pakistani indie music">Pakistani indie</button></div></section>
      <section class="section-block"><div class="wide-banner"><div class="banner-symbol">♫</div><div><h3>Your local collection belongs here too</h3><p>Import MP3, FLAC, WAV, OGG, M4A and other audio formats supported by your browser. Imported files stay in this browser's offline library.</p></div><button class="hero-primary" data-action="import-audio">Import files</button></div></section>`;
  }
  function renderSongRows(tracks, context = 'library') {
    if (!tracks.length) return `<div class="empty-state"><span class="empty-icon">♫</span><b>Nothing here just yet</b><p>Search and play a track, like a song or import a file to build your library.</p><button class="hero-primary" data-action="go-search">Find music</button></div>`;
    state.currentCollection = tracks;
    state.currentCollectionName = context;
    return `<div class="song-list">${tracks.map((raw, i) => {
      const t = normalizeTrack(raw); const current = state.currentTrack && keyOf(state.currentTrack) === keyOf(t);
      return `<div class="song-row ${current ? 'is-current' : ''}" data-track-key="${escapeHTML(keyOf(t))}"><span class="row-number">${current && state.isPlaying ? '♫' : String(i+1).padStart(2,'0')}</span>${t.thumbnail ? `<img class="row-art" src="${escapeHTML(t.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="row-art track-art-placeholder">♫</div>`}<div class="row-title"><b>${escapeHTML(t.title)}</b><small>${escapeHTML(t.artist)}${t.type === 'local' ? ' · Local audio' : ''}</small></div><div class="row-album">${t.type === 'local' ? 'On this device' : 'Audius audio'}</div><span class="row-time">${current && state.isPlaying ? 'Playing' : ''}</span><div class="row-actions"><button class="row-action ${isLiked(t) ? 'liked' : ''}" data-action="like" data-key="${escapeHTML(keyOf(t))}" aria-label="Like song">${isLiked(t) ? '♥' : '♡'}</button>${t.type === 'local' ? `<button class="row-action" data-action="delete-local" data-key="${escapeHTML(keyOf(t))}" aria-label="Remove local file">×</button>` : `<button class="row-action" data-action="track-menu" data-key="${escapeHTML(keyOf(t))}" aria-label="More options">•••</button>`}</div></div>`;
    }).join('')}</div>`;
  }
  function renderLiked() {
    const tracks = state.liked.map(byKey).filter(Boolean);
    pageContent.innerHTML = `${pageTitle('YOUR LIBRARY', 'Liked songs', `${tracks.length} saved ${tracks.length === 1 ? 'track' : 'tracks'} on this device.`)}<div class="wide-banner"><div class="banner-symbol">♥</div><div><h3>Your personal favorites</h3><p>Like any result or local song to keep it here. This list is saved in this browser.</p></div>${tracks.length ? '<button class="hero-primary" data-action="play-collection">▶ Play all</button>' : ''}</div>${renderSongRows(tracks, 'Liked songs')}`;
  }
  function renderHistory() {
    const tracks = state.history.slice();
    pageContent.innerHTML = `${pageTitle('YOUR LISTENING', 'Recently played', 'Your recent listening history stays on this device.')}${tracks.length ? `<div class="section-heading"><span class="result-count">${tracks.length} recent tracks</span><button class="text-btn" data-action="clear-history">Clear history</button></div>` : ''}${renderSongRows(tracks, 'Recently played')}`;
  }
  function renderLocal() {
    pageContent.innerHTML = `${pageTitle('YOUR LIBRARY', 'Local music', `${state.localTracks.length} audio ${state.localTracks.length === 1 ? 'file' : 'files'} stored for this browser.`)}
      <div class="local-import-zone"><div class="local-import-icon">⇧</div><div><h3>Bring your own music</h3><p>Import audio files already on your device. Ausic stores them in this browser so you can listen offline after they are imported.</p></div><button class="hero-primary" data-action="import-audio">＋ Import files</button></div>
      <div class="hint-box"><b>Good to know:</b> Local audio files stay in this browser's storage. Clearing site data may remove them, so keep your original files backed up.</div>${renderSongRows(state.localTracks, 'Local music')}`;
  }
  function renderPlaylists() {
    pageContent.innerHTML = `${pageTitle('YOUR LIBRARY', 'Your playlists', 'Make a collection for every mood, moment or journey.')}<div class="wide-banner"><div class="banner-symbol">▤</div><div><h3>Build a soundtrack for it</h3><p>Add streamed audio tracks or local music to your own playlists.</p></div><button class="hero-primary" data-action="create-playlist">＋ New playlist</button></div>
      ${state.playlists.length ? `<div class="playlist-list">${state.playlists.map(p => {
        const images = p.tracks.filter(t => t.thumbnail).slice(0,4);
        const tiles = Array.from({length:4},(_,i)=> images[i] ? `<div class="cover-tile"><img src="${escapeHTML(images[i].thumbnail)}" loading="lazy" alt=""></div>` : '<div class="cover-tile"></div>').join('');
        return `<article class="playlist-card"><button class="playlist-cover" data-action="open-playlist" data-id="${escapeHTML(p.id)}" aria-label="Open ${escapeHTML(p.name)}">${tiles}</button><div class="playlist-card-copy"><b>${escapeHTML(p.name)}</b><small>${p.tracks.length} ${p.tracks.length === 1 ? 'track' : 'tracks'}</small><div class="playlist-card-actions"><button data-action="open-playlist" data-id="${escapeHTML(p.id)}">Open playlist ↗</button><button data-action="delete-playlist" data-id="${escapeHTML(p.id)}">Delete</button></div></div></article>`;
      }).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">▤</span><b>Your first playlist is one click away</b><p>Create a playlist and add tracks from search results or your local library.</p><button class="hero-primary" data-action="create-playlist">＋ Create playlist</button></div>`}`;
  }
  function renderPlaylist(id) {
    const p = state.playlists.find(x => x.id === id);
    if (!p) return navigate('playlists');
    pageContent.innerHTML = `${pageTitle('PLAYLIST', p.name, `${p.tracks.length} tracks · Saved on this device`)}<div class="wide-banner"><div class="banner-symbol">▤</div><div><h3>${escapeHTML(p.name)}</h3><p>Only you can see this playlist in this browser. Add tracks from any result's options menu.</p></div><button class="hero-primary" data-action="play-playlist" data-id="${escapeHTML(p.id)}">▶ Play all</button></div><div class="section-heading"><span class="result-count">Track list</span><button class="text-btn" data-action="rename-playlist" data-id="${escapeHTML(p.id)}">Rename</button></div>${renderSongRows(p.tracks, `Playlist: ${p.name}`)}
      ${p.tracks.length ? `<div style="margin-top:12px;text-align:right"><button class="text-btn" data-action="clear-playlist" data-id="${escapeHTML(p.id)}">Remove all tracks</button></div>` : ''}`;
  }
  function setActiveNav(page) {
    $$('[data-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
  }
  function navigate(page, options = {}) {
    if (!['home','search','explore','liked','history','local','playlists'].includes(page)) page = 'home';
    state.lastView = state.page;
    state.page = page;
    if (!options.keepHash) history.replaceState({page}, '', `#${page}`);
    setActiveNav(page);
    if (page === 'home') renderHome();
    else if (page === 'search') renderSearch();
    else if (page === 'explore') renderExplore();
    else if (page === 'liked') renderLiked();
    else if (page === 'history') renderHistory();
    else if (page === 'local') renderLocal();
    else if (page === 'playlists') renderPlaylists();
    pageContent.focus({preventScroll:true});
  }
  async function fetchStatus() {
    const statusEl = $('#api-status');
    statusEl.className = 'api-status';
    statusEl.innerHTML = '<span class="status-dot"></span><span>Connecting to Audius…</span>';
    try {
      await loadTrending();
      if (!state.searchError) {
        statusEl.className = 'api-status connected';
        statusEl.innerHTML = '<span class="status-dot"></span><span>Audius catalog ready</span>';
      }
    } catch {
      statusEl.className = 'api-status not-connected';
      statusEl.innerHTML = '<span class="status-dot"></span><span>Catalog unavailable</span>';
    }
  }
  async function searchMusic(query, options = {}) {
    const q = String(query || '').trim().slice(0,120);
    if (!q) return;
    state.query = q;
    $('#search-input').value = q;
    state.searchError = '';
    state.busy = true;
    if (!options.background) {
      navigate('search');
      renderSearch();
    } else {
      const slot = $('#home-results');
      if (slot) slot.innerHTML = renderSkeletons(4);
    }
    try {
      const data = await getAudius('/tracks/search', { query: q, limit: 40, offset: 0 });
      state.results = (Array.isArray(data.data) ? data.data : []).map(mapAudiusTrack).filter(Boolean).map(normalizeTrack);
      state.searchError = '';
      state.currentCollection = state.results;
      state.currentCollectionName = options.background ? 'Explore music' : 'Search results';
      const statusEl = $('#api-status');
      if (statusEl) { statusEl.className = 'api-status connected'; statusEl.innerHTML = '<span class="status-dot"></span><span>Audius catalog ready</span>'; }
      state.busy = false;
      if (!options.background) renderSearch();
      else if (state.page === 'home') renderHome();
      if (!state.results.length) toast('No results came back for that search. Try another phrase.');
    } catch (err) {
      state.results = [];
      state.searchError = err.message || 'Search failed.';
      state.busy = false;
      if (!options.background) renderSearch();
      else if (state.page === 'home') {
        const slot = $('#home-results');
        if (slot) slot.innerHTML = renderSearchError(state.searchError);
      }
      toast(state.searchError, 'error', 4800);
    }
  }
  async function loadTrending() {
    try {
      const data = await getAudius('/tracks/trending', { time: 'week', limit: 40 });
      state.results = (Array.isArray(data.data) ? data.data : []).map(mapAudiusTrack).filter(Boolean).map(normalizeTrack);
      state.currentCollection = state.results;
      state.currentCollectionName = 'Trending audio';
      state.searchError = '';
      if (state.page === 'home') renderHome();
      if (!state.results.length && state.page === 'home') searchMusic('chill instrumental', {background:true, saveQuery:false});
    } catch (error) {
      state.searchError = error.message || 'Audio catalog is unavailable.';
      const statusEl = $('#api-status');
      if (statusEl) { statusEl.className = 'api-status not-connected'; statusEl.innerHTML = '<span class="status-dot"></span><span>Catalog unavailable</span>'; }
      if (state.page === 'home') {
        const slot = $('#home-results');
        if (slot) slot.innerHTML = renderSearchError(state.searchError);
      }
    }
  }
  async function playTrack(rawTrack, options = {}) {
    if (!rawTrack) return;
    const track = normalizeTrack(rawTrack);
    state.currentTrack = track;
    remember(track);
    state.lyrics = null;
    state.lyricTokens = [];
    document.body.classList.add('has-track');
    if (track.type === 'local') await playLocalTrack(track);
    else await playCatalogTrack(track);
    updateTrackUI();
    if (options.addHistory !== false) {
      state.history = [track, ...state.history.filter(t => keyOf(t) !== keyOf(track))].slice(0,60);
      persist();
    }
    renderPanelTab();
    if (['history','liked','local'].includes(state.page)) navigate(state.page, {keepHash:true});
    updatePlaybackButton();
    updateSourceLabel(track.type === 'local' ? 'Local audio file' : 'Audius audio stream');
  }
  async function playCatalogTrack(track) {
    try {
      audio.pause();
      if (state.localObjectUrl) { URL.revokeObjectURL(state.localObjectUrl); state.localObjectUrl = null; }
      audio.src = audiusEndpoint(`/tracks/${encodeURIComponent(track.id)}/stream`);
      audio.volume = state.volume / 100;
      audio.load();
      await audio.play();
      state.isPlaying = true;
      updateSourceLabel('Streaming audio');
    } catch (err) {
      state.isPlaying = false;
      updatePlaybackButton();
      toast(err?.message || 'This track could not start. Try another audio track.', 'error', 4800);
    }
  }
  async function playLocalTrack(track) {
    try {
      const record = await dbGet(track.id);
      if (!record?.blob) throw new Error('That audio file is no longer in this browser. Import it again.');
      audio.pause();
      if (state.localObjectUrl) URL.revokeObjectURL(state.localObjectUrl);
      state.localObjectUrl = URL.createObjectURL(record.blob);
      audio.src = state.localObjectUrl;
      audio.volume = state.volume / 100;
      await audio.play();
      state.isPlaying = true;
      updateSourceLabel('Local audio file');
    } catch (err) {
      state.isPlaying = false;
      toast(err.message || 'Could not play this audio file.', 'error', 4500);
    }
  }

  function updateTrackUI() {
    const t = state.currentTrack;
    const title = t?.title || 'Nothing playing yet';
    const artist = t?.artist || 'Pick a song to begin';
    $('#now-title').textContent = title;
    $('#now-artist').textContent = artist;
    $('#bottom-title').textContent = title;
    $('#bottom-artist').textContent = artist;
    const artwork = t?.thumbnail || '';
    $('#now-art').innerHTML = artwork ? `<img src="${escapeHTML(artwork)}" alt="" referrerpolicy="no-referrer">` : '<span>♫</span>';
    const stage = $('#stage-art');
    if (stage) { stage.innerHTML = artwork ? `<img src="${escapeHTML(artwork)}" alt="Album artwork" referrerpolicy="no-referrer">` : '<span>♫</span>'; stage.classList.toggle('has-art', Boolean(artwork)); }
    const audioStage = $('#audio-stage');
    if (audioStage) audioStage.classList.toggle('is-playing', Boolean(state.isPlaying));
    $('#bottom-art').innerHTML = artwork ? `<img src="${escapeHTML(artwork)}" alt="" referrerpolicy="no-referrer">` : '<span>♫</span>';
    $('#now-like').classList.toggle('liked', Boolean(t && isLiked(t)));
    $('#bottom-like').classList.toggle('liked', Boolean(t && isLiked(t)));
    $('#now-like').textContent = t && isLiked(t) ? '♥' : '♡';
    $('#bottom-like').textContent = t && isLiked(t) ? '♥' : '♡';
    $('#source-label').textContent = t ? (t.type === 'local' ? 'Local audio file' : 'Audius audio stream') : 'Ready to play';
    updateQueueCount();
  }
  function updateSourceLabel(label) { $('#source-label').textContent = label; }
  function updatePlaybackButton() {
    $('#play-pause-btn').textContent = state.isPlaying ? 'Ⅱ' : '▶';
    $('#play-pause-btn').setAttribute('aria-label', state.isPlaying ? 'Pause playback' : 'Play playback');
    $('#play-pause-btn').classList.toggle('is-playing', state.isPlaying);
    const expandedPlay = $('#expanded-play');
    if (expandedPlay) {
      expandedPlay.textContent = state.isPlaying ? 'Ⅱ' : '▶';
      expandedPlay.setAttribute('aria-label', state.isPlaying ? 'Pause playback' : 'Play playback');
    }
  }
  function togglePlayback() {
    if (!state.currentTrack) { toast('Pick a song or import an audio file first.'); return; }
    if (!audio.src) { playTrack(state.currentTrack); return; }
    if (audio.paused) audio.play().then(() => { state.isPlaying = true; updatePlaybackButton(); }).catch(() => toast('Could not resume this audio stream.', 'error'));
    else audio.pause();
  }
  function playCurrentCollection(index) {
    if (!state.currentCollection?.length) { toast('There are no tracks to play here yet.'); return; }
    const items = state.currentCollection.filter(Boolean).map(normalizeTrack);
    const selectedIndex = Math.max(0, Math.min(index || 0, items.length - 1));
    state.queue = items.slice(selectedIndex);
    state.queueIndex = 0;
    persist();
    playTrack(state.queue[0], {fromQueue:true});
    renderPanelTab();
  }
  function playNext(ended = false) {
    if (state.repeat === 'one' && ended && state.currentTrack) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    if (!state.queue.length) {
      if (state.repeat === 'one' && state.currentTrack) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
      state.isPlaying = false; updatePlaybackButton(); return;
    }
    if (state.shuffle && state.queue.length > 1) {
      let next = state.queueIndex;
      while (next === state.queueIndex) next = Math.floor(Math.random() * state.queue.length);
      state.queueIndex = next;
    } else if (state.queueIndex < state.queue.length - 1) {
      state.queueIndex += 1;
    } else if (state.repeat === 'all' || (!ended && state.queue.length === 1)) {
      state.queueIndex = 0;
    } else {
      state.isPlaying = false; updatePlaybackButton(); return;
    }
    const nextTrack = state.queue[state.queueIndex];
    playTrack(nextTrack, {fromQueue:true});
    renderPanelTab();
  }
  function playPrevious() {
    if (getCurrentTime() > 4) { audio.currentTime = 0; return; }
    if (state.queue.length && state.queueIndex > 0) {
      state.queueIndex -= 1;
      playTrack(state.queue[state.queueIndex], {fromQueue:true});
      renderPanelTab();
      return;
    }
    const previous = state.history.find((track, index) => index > 0 && keyOf(track) !== keyOf(state.currentTrack));
    if (previous) { state.queue = [previous]; state.queueIndex = 0; playTrack(previous, {fromQueue:true}); }
  }
  function getCurrentTime() { return audio.currentTime || 0; }
  function getDuration() { return Number.isFinite(audio.duration) ? audio.duration : (Number(state.currentTrack?.duration) || 0); }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds); const hours = Math.floor(s/3600); const mins = Math.floor((s%3600)/60); const secs = s%60;
    return hours ? `${hours}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}` : `${mins}:${String(secs).padStart(2,'0')}`;
  }
  function paintRange(input) {
    if (!input) return;
    const max = Number(input.max) || 100; const min = Number(input.min) || 0; const value = Number(input.value) || 0;
    input.style.setProperty('--range-fill', `${Math.max(0,Math.min(100,((value-min)/(max-min||1))*100))}%`);
  }
  function updateProgress() {
    const current = getCurrentTime(); const duration = getDuration();
    $('#current-time').textContent = formatTime(current);
    $('#total-time').textContent = formatTime(duration);
    const seek = $('#seek-slider');
    if (!seek.matches(':active') && duration > 0) seek.value = String(Math.round(current / duration * 1000));
    paintRange(seek);
    const expandedSeek = $('#expanded-seek');
    if (expandedSeek) {
      if (!expandedSeek.matches(':active') && duration > 0) expandedSeek.value = String(Math.round(current / duration * 1000));
      $('#expanded-current-time').textContent = formatTime(current);
      $('#expanded-total-time').textContent = formatTime(duration);
      paintRange(expandedSeek);
    }
    updateSyncedLyrics(current);
  }
  function startProgressLoop() {
    if (state.progressInterval) clearInterval(state.progressInterval);
    state.progressInterval = setInterval(updateProgress, 450);
  }
  function toggleLike(track = state.currentTrack) {
    if (!track) { toast('Play a song first to add it to your likes.'); return; }
    const key = keyOf(track);
    if (state.liked.includes(key)) state.liked = state.liked.filter(x => x !== key);
    else { state.liked.unshift(key); remember(track); }
    state.liked = [...new Set(state.liked)].slice(0,500);
    $('#liked-count').textContent = String(state.liked.length);
    persist(); updateTrackUI();
    if (state.page === 'liked') renderLiked();
    else if (state.page === 'home') {
      // Update any visible heart controls without replacing the current page.
      $$(`[data-key="${CSS.escape(key)}"][data-action="like"]`).forEach(b => { b.classList.toggle('liked', isLiked(track)); b.textContent = isLiked(track) ? '♥' : '♡'; });
    }
    toast(isLiked(track) ? 'Added to Liked songs.' : 'Removed from Liked songs.', 'success', 1700);
  }
  function updateQueueCount() { $('#queue-count').textContent = String(state.queue.length); }
  function renderQueue() {
    const list = state.queue;
    if (!list.length) return `<div class="empty-state compact"><span class="empty-icon">♫</span><b>Your queue is waiting</b><p>Play a song or add tracks to your queue.</p></div>`;
    return `<div class="queue-list">${list.map((t,i) => `<div class="queue-row ${i === state.queueIndex ? 'current' : ''}" data-action="play-queue-item" data-index="${i}">${t.thumbnail ? `<img class="queue-art" src="${escapeHTML(t.thumbnail)}" alt="" loading="lazy">` : '<div class="queue-art track-art-placeholder">♫</div>'}<div class="queue-copy"><b>${escapeHTML(t.title)}</b><small>${escapeHTML(t.artist)}${i === state.queueIndex ? ' · Next up' : ''}</small></div><button class="queue-remove" data-action="remove-queue" data-index="${i}" aria-label="Remove from queue">×</button></div>`).join('')}</div>`;
  }
  async function loadLyrics() {
    const track = state.currentTrack;
    if (!track) { state.lyrics = null; renderLyrics(); return; }
    if (state.lyricsTrackId === keyOf(track) && state.lyrics) { renderLyrics(); return; }
    state.lyricsTrackId = keyOf(track); state.lyrics = {loading:true}; renderLyrics();
    try {
      const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
      let res = await fetch(`https://lrclib.net/api/get?${params}`, { headers: { 'Accept': 'application/json' } });
      let data;
      if (res.status === 404) {
        const searchRes = await fetch(`https://lrclib.net/api/search?${params}`, { headers: { 'Accept': 'application/json' } });
        const matches = await searchRes.json().catch(() => []);
        data = Array.isArray(matches) ? (matches.find(item => item.syncedLyrics || item.plainLyrics) || matches[0]) : null;
        if (!searchRes.ok || !data) throw new Error('No lyrics were found for this track.');
      } else {
        data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Lyrics are unavailable right now.');
      }
      if (!data || (!data.plainLyrics && !data.syncedLyrics)) throw new Error('No lyrics were found for this track.');
      state.lyrics = data;
      state.lyricTokens = parseLRC(data.syncedLyrics || '');
    } catch (err) { state.lyrics = {error:err.message || 'Lyrics not found.'}; state.lyricTokens = []; }
    if (state.panelTab === 'lyrics') renderLyrics();
  }
  function parseLRC(text) {
    const out = [];
    for (const line of String(text).split(/\r?\n/)) {
      const matches = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
      const content = line.replace(/\[[^\]]+\]/g,'').trim();
      if (!content) continue;
      for (const m of matches) {
        const fraction = m[3] ? Number(`0.${m[3]}`) : 0;
        out.push({time:Number(m[1])*60 + Number(m[2]) + fraction, text:content});
      }
    }
    return out.sort((a,b)=>a.time-b.time);
  }
  function renderLyrics() {
    const target = $('#panel-tab-content');
    const data = state.lyrics;
    if (!state.currentTrack) { target.innerHTML = '<div class="lyrics-empty">Play a track first.<br>Lyrics will appear here when available.</div>'; return; }
    if (data?.loading) { target.innerHTML = '<div class="lyrics-empty"><span class="spinner"></span><br>Looking for lyrics…</div>'; return; }
    if (data?.error || (!data?.plainLyrics && !data?.syncedLyrics)) { target.innerHTML = `<div class="lyrics-empty">${escapeHTML(data?.error || 'No lyrics found for this track.')}<br><br>Lyrics availability depends on the lyrics catalog.</div>`; return; }
    if (state.lyricTokens.length) {
      target.innerHTML = `<div class="lyrics-box">${state.lyricTokens.map((line,i)=>`<div class="lyrics-line" data-lyric-index="${i}">${escapeHTML(line.text)}</div>`).join('')}</div>`;
      updateSyncedLyrics(getCurrentTime());
    } else {
      target.innerHTML = `<div class="lyrics-box">${escapeHTML(data.plainLyrics).split('\n').map(line=>`<div class="lyrics-line">${line || '&nbsp;'}</div>`).join('')}</div>`;
    }
  }
  function updateSyncedLyrics(time) {
    if (state.panelTab !== 'lyrics' || !state.lyricTokens.length) return;
    let active = -1;
    for (let i=0;i<state.lyricTokens.length;i++) { if (state.lyricTokens[i].time <= time) active=i; else break; }
    const lines = $$('.lyrics-line[data-lyric-index]');
    if (!lines.length) return;
    lines.forEach((el,i)=>el.classList.toggle('active',i===active));
    if (active >= 0) {
      const box = $('.lyrics-box');
      const line = lines[active];
      if (box && line && !line.matches(':hover')) {
        const boxRect = box.getBoundingClientRect(); const lineRect = line.getBoundingClientRect();
        if (lineRect.top < boxRect.top + 20 || lineRect.bottom > boxRect.bottom - 20) line.scrollIntoView({block:'center',behavior:'smooth'});
      }
    }
  }
  function renderPanelTab() {
    $$('.panel-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.panelTab === state.panelTab));
    if (state.panelTab === 'queue') $('#panel-tab-content').innerHTML = renderQueue();
    else if (state.panelTab === 'lyrics') { if (!state.lyrics && state.currentTrack) loadLyrics(); else renderLyrics(); }
    else if (state.panelTab === 'about') {
      const t = state.currentTrack;
      $('#panel-tab-content').innerHTML = t ? `<div class="info-grid"><div class="info-line"><small>Title</small><b>${escapeHTML(t.title)}</b></div><div class="info-line"><small>${t.type === 'local' ? 'Source file' : 'Artist'}</small><b>${escapeHTML(t.type === 'local' ? (t.filename || t.title) : t.artist)}</b></div><div class="info-line"><small>Source</small><b>${t.type === 'local' ? 'Local audio on this device' : 'Audius audio stream'}</b></div>${t.publishedAt ? `<div class="info-line"><small>Published</small><b>${escapeHTML(new Date(t.publishedAt).toLocaleDateString())}</b></div>` : ''}${t.description ? `<div class="info-line"><small>Description</small><b>${escapeHTML(t.description.slice(0,420))}</b></div>` : ''}</div>` : '<div class="lyrics-empty">Track details appear when you play something.</div>';
    }
  }
  function openModal(html) {
    modalCard.innerHTML = html;
    modalBackdrop.hidden = false;
    const first = $('input:not([type="hidden"]),button,select', modalCard);
    if (first) setTimeout(() => first.focus(), 20);
  }
  function closeModal() { modalBackdrop.hidden = true; modalCard.innerHTML = ''; }
  function openCreatePlaylist() {
    openModal(`<div class="modal-head"><div><h2 id="modal-title">Create a playlist</h2><p>Give your collection a name. You can add tracks any time.</p></div><button class="circle-btn" data-action="close-modal" aria-label="Close">×</button></div><form class="modal-form" id="create-playlist-form"><label class="field-label">Playlist name<input class="field-control" name="playlistName" maxlength="70" placeholder="e.g. Late night drive" required autocomplete="off"></label><label class="field-label">Description (optional)<input class="field-control" name="playlistDescription" maxlength="140" placeholder="What does this playlist feel like?"></label><div class="modal-actions"><button type="button" class="modal-secondary" data-action="close-modal">Cancel</button><button type="submit" class="modal-primary">Create playlist</button></div></form>`);
  }
  function openTrackMenu(track) {
    if (!track) return;
    const t = normalizeTrack(track);
    openModal(`<div class="modal-head"><div><h2 id="modal-title">Track options</h2><p>${escapeHTML(t.title)} · ${escapeHTML(t.artist)}</p></div><button class="circle-btn" data-action="close-modal" aria-label="Close">×</button></div><div class="modal-form"><button class="filter-pill" style="text-align:left;padding:12px" data-action="modal-play" data-key="${escapeHTML(keyOf(t))}">▶ &nbsp; Play now</button><button class="filter-pill" style="text-align:left;padding:12px" data-action="modal-queue" data-key="${escapeHTML(keyOf(t))}">＋ &nbsp; Add to queue</button><button class="filter-pill" style="text-align:left;padding:12px" data-action="modal-like" data-key="${escapeHTML(keyOf(t))}">${isLiked(t) ? '♥ Remove from liked songs' : '♡ Add to liked songs'}</button><button class="filter-pill" style="text-align:left;padding:12px" data-action="modal-add-playlist" data-key="${escapeHTML(keyOf(t))}">▤ &nbsp; Add to playlist</button>${t.type === 'local' ? `<button class="filter-pill" style="text-align:left;padding:12px" data-action="delete-local" data-key="${escapeHTML(keyOf(t))}">× &nbsp; Remove from local library</button>` : ''}${t.type !== 'local' && t.permalink ? `<a class="filter-pill" style="text-align:left;padding:12px;display:block" href="${escapeHTML(t.permalink)}" target="_blank" rel="noopener noreferrer">↗ &nbsp; Open track page</a>` : ''}<div class="modal-actions"><button type="button" class="modal-secondary" data-action="close-modal">Done</button></div></div>`);
  }
  function openAddToPlaylist(track) {
    if (!state.playlists.length) {
      closeModal();
      openModal(`<div class="modal-head"><div><h2 id="modal-title">Create your first playlist</h2><p>You need a playlist before adding tracks.</p></div><button class="circle-btn" data-action="close-modal" aria-label="Close">×</button></div><form class="modal-form" id="create-and-add-form" data-key="${escapeHTML(keyOf(track))}"><label class="field-label">Playlist name<input class="field-control" name="playlistName" maxlength="70" placeholder="e.g. My favorites" required></label><div class="modal-actions"><button type="button" class="modal-secondary" data-action="close-modal">Cancel</button><button type="submit" class="modal-primary">Create & add track</button></div></form>`);
      return;
    }
    openModal(`<div class="modal-head"><div><h2 id="modal-title">Add to playlist</h2><p>${escapeHTML(track.title)}</p></div><button class="circle-btn" data-action="close-modal" aria-label="Close">×</button></div><form class="modal-form" id="add-playlist-form" data-key="${escapeHTML(keyOf(track))}"><label class="field-label">Choose a playlist<select class="field-control" name="playlistId" required>${state.playlists.map(p=>`<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}</select></label><div class="modal-actions"><button type="button" class="modal-secondary" data-action="close-modal">Cancel</button><button type="submit" class="modal-primary">Add track</button></div></form>`);
  }
  function addTrackToPlaylist(track, playlistId) {
    const playlist = state.playlists.find(p => p.id === playlistId);
    if (!playlist || !track) return;
    if (playlist.tracks.some(t => keyOf(t) === keyOf(track))) { toast('This track is already in that playlist.'); return; }
    playlist.tracks.push(normalizeTrack(track));
    persist(); renderSidebarPlaylists();
    if (state.page === 'playlists') renderPlaylists();
    toast(`Added to ${playlist.name}.`, 'success');
  }
  function renderSidebarPlaylists() {
    $('#sidebar-playlists').innerHTML = state.playlists.slice(0,8).map(p=>`<button class="sidebar-playlist" data-action="open-playlist" data-id="${escapeHTML(p.id)}"><span class="playlist-glyph">♫</span><span>${escapeHTML(p.name)}</span></button>`).join('') || '<div style="padding:2px 12px 8px;color:var(--faint);font-size:10px;line-height:1.5">Your playlists will show here.</div>';
  }
  async function importAudioFiles(files) {
    const allowed = [...files].filter(file => file.type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|opus|wav|flac|aiff|wma)$/i.test(file.name));
    if (!allowed.length) { toast('Choose audio files such as MP3, M4A, FLAC, WAV or OGG.', 'error'); return; }
    let count = 0;
    for (const file of allowed) {
      try {
        const id = crypto.randomUUID();
        await dbPut({id, blob:file, filename:file.name, mime:file.type || 'audio/*', size:file.size, addedAt:Date.now()});
        const title = file.name.replace(/\.[^.]+$/, '').replace(/[._]+/g,' ').trim() || file.name;
        const track = normalizeTrack({id,type:'local',title,artist:'Local file',thumbnail:'',filename:file.name,description:`${(file.size/1048576).toFixed(1)} MB`});
        state.localTracks.unshift(track); count++;
      } catch (err) {
        console.warn(err); toast(`Could not import ${file.name}. Browser storage may be full.`, 'error', 4500);
      }
    }
    const seen = new Set(); state.localTracks = state.localTracks.filter(t => !seen.has(t.id) && seen.add(t.id));
    persist(); $('#liked-count').textContent = String(state.liked.length); renderSidebarPlaylists();
    if (state.page === 'local') renderLocal(); else if (state.page === 'home') renderHome();
    if (count) toast(`Imported ${count} ${count === 1 ? 'audio file' : 'audio files'} to your local library.`, 'success', 3600);
  }
  function deleteLocalTrack(track) {
    if (!track || track.type !== 'local') return;
    if (!confirm(`Remove “${track.title}” from Ausic's local library? This does not delete your original file.`)) return;
    dbDelete(track.id).catch(console.warn);
    state.localTracks = state.localTracks.filter(t => t.id !== track.id);
    state.liked = state.liked.filter(k => k !== keyOf(track));
    state.history = state.history.filter(t => keyOf(t) !== keyOf(track));
    state.playlists.forEach(p => p.tracks = p.tracks.filter(t => keyOf(t) !== keyOf(track)));
    if (keyOf(state.currentTrack) === keyOf(track)) { audio.pause(); state.currentTrack = null; state.isPlaying = false; updateTrackUI(); }
    persist(); renderLocal(); toast('Removed from Ausic. Your original file is unchanged.');
  }
  function openSettings() {
    openModal(`<div class="modal-head"><div><h2 id="modal-title">Ausic preferences</h2><p>Your personal audio setup.</p></div><button class="circle-btn" data-action="close-modal" aria-label="Close">×</button></div>
      <div class="setting-row"><div class="setting-copy"><b>Appearance</b><small>Switch between dark and light themes.</small></div><button class="modal-secondary" data-action="modal-theme">${state.theme === 'dark' ? 'Dark theme' : 'Light theme'} · Toggle</button></div>
      <div class="setting-row"><div class="setting-copy"><b>Sleep timer</b><small>Stop playback automatically after a set time.</small></div><select class="field-control" id="sleep-select" style="max-width:135px"><option value="0">Off</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></div>
      <div class="setting-row"><div class="setting-copy"><b>Audio only</b><small>Ausic streams audio tracks and local music files. It does not embed video players.</small></div><span class="status-pill">Enabled</span></div>
      <div class="setting-row"><div class="setting-copy"><b>Export library backup</b><small>Save likes, playlists and listening history as a JSON file. Audio file contents are not included.</small></div><button class="modal-secondary" data-action="export-backup">Export</button></div>
      <div class="setting-row"><div class="setting-copy"><b>Clear listening data</b><small>Removes likes, history and playlists, but leaves imported audio files stored separately.</small></div><button class="modal-secondary" data-action="clear-data">Clear data</button></div>
      <div class="modal-actions"><button class="modal-primary" data-action="close-modal">Done</button></div>`);
    if (state.sleepTimer) $('#sleep-select').value = String(state.sleepTimer.minutes || 0);
  }
  function setSleepTimer(minutes) {
    if (state.sleepTimer?.id) clearTimeout(state.sleepTimer.id);
    state.sleepTimer = null;
    if (!minutes) { toast('Sleep timer turned off.'); return; }
    const id = setTimeout(() => { pausePlayback(); state.sleepTimer = null; toast('Sleep timer finished. Playback has stopped.', 'success', 4500); }, minutes*60*1000);
    state.sleepTimer = {id,minutes}; toast(`Sleep timer set for ${minutes} minutes.`, 'success');
  }
  function pausePlayback() {
    audio.pause();
    state.isPlaying = false; updatePlaybackButton();
  }
  function exportBackup() {
    const data = {version:2,exportedAt:new Date().toISOString(),liked:state.liked,history:state.history,playlists:state.playlists,theme:state.theme,shuffle:state.shuffle,repeat:state.repeat,volume:state.volume};
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=`ausic-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
    toast('Backup exported. Audio files are not part of the JSON backup.', 'success', 3600);
  }
  function clearData() {
    if (!confirm('Clear Ausic likes, history and playlists on this device? Imported audio files will remain.')) return;
    state.liked=[];state.history=[];state.playlists=[];state.queue=[];state.queueIndex=-1;persist();renderSidebarPlaylists();$('#liked-count').textContent='0';closeModal();navigate('home');toast('Listening data cleared.');
  }
  function updateQueueFromTrack(track) {
    state.queue = [...state.queue.filter(t => keyOf(t) !== keyOf(track)), normalizeTrack(track)];
    state.queueIndex = state.queue.length - 1;
    persist(); updateQueueCount();
    if (state.panelTab === 'queue') renderPanelTab();
    toast('Added to your queue.', 'success', 1500);
  }
  function findByKey(key) {
    return byKey(key) || state.results.find(t => keyOf(t) === key) || state.localTracks.find(t => keyOf(t) === key) || null;
  }
  async function removeQueueItem(index) {
    if (index < 0 || index >= state.queue.length) return;
    const removingCurrent = index === state.queueIndex;
    state.queue.splice(index,1);
    if (index < state.queueIndex) state.queueIndex--;
    if (!state.queue.length) state.queueIndex=-1;
    else if (removingCurrent) {
      state.queueIndex = Math.min(index, state.queue.length-1);
      await playTrack(state.queue[state.queueIndex], {fromQueue:true});
    }
    persist();renderPanelTab();updateQueueCount();
  }
  function onDocumentClick(event) {
    const card = event.target.closest('.track-card');
    if (card && !event.target.closest('button,a,[data-action]')) {
      const track = findByKey(card.dataset.trackKey);
      if (track) {
        const collection = state.currentCollection?.length ? state.currentCollection : state.results;
        const index = collection.findIndex(t => keyOf(t) === keyOf(track));
        if (index >= 0) playCurrentCollection(index); else { state.queue = [track]; state.queueIndex = 0; playTrack(track, {fromQueue:true}); }
      }
      return;
    }
    const songRow = event.target.closest('.song-row');
    if (songRow && !event.target.closest('button,a,[data-action]')) {
      const track = findByKey(songRow.dataset.trackKey);
      if (track) { state.queue = state.currentCollection.slice(); state.queueIndex = Math.max(0, state.queue.findIndex(t => keyOf(t) === keyOf(track))); playTrack(track, {fromQueue:true}); renderPanelTab(); }
      return;
    }
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) { navigate(pageButton.dataset.page); return; }
    const panelTab = event.target.closest('[data-panel-tab]');
    if (panelTab) { state.panelTab=panelTab.dataset.panelTab;renderPanelTab();if(state.panelTab==='lyrics')loadLyrics();return; }
    const queryButton = event.target.closest('[data-query]');
    if (queryButton) { searchMusic(queryButton.dataset.query); return; }
    const searchQueryButton = event.target.closest('[data-search-query]');
    if (searchQueryButton) { searchMusic(searchQueryButton.dataset.searchQuery);return; }
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    switch(action) {
      case 'go-search': navigate('search'); $('#search-input').focus(); break;
      case 'retry-search': if (state.query) searchMusic(state.query); else loadTrending(); break;
      case 'open-settings': openSettings(); break;
      case 'import-audio': $('#audio-file-input').click(); break;
      case 'create-playlist': openCreatePlaylist(); break;
      case 'play-card': {
        const track=findByKey(btn.dataset.key); if(!track)return;
        const collection=state.currentCollection?.length?state.currentCollection:state.results;
        const index=collection.findIndex(t=>keyOf(t)===keyOf(track));
        if(index>=0)playCurrentCollection(index); else {state.queue=[track];state.queueIndex=0;playTrack(track,{fromQueue:true});}
        state.panelTab='queue'; renderPanelTab();
        document.body.classList.add('show-player-panel');
        document.body.classList.add('has-track');
        break;
      }
      case 'track-menu': openTrackMenu(findByKey(btn.dataset.key)); break;
      case 'like': toggleLike(findByKey(btn.dataset.key)); break;
      case 'modal-play': { const t=findByKey(btn.dataset.key); closeModal(); if(t){state.queue=[t,...state.queue.filter(x=>keyOf(x)!==keyOf(t))];state.queueIndex=0;playTrack(t,{fromQueue:true});} break; }
      case 'modal-queue': { const t=findByKey(btn.dataset.key); closeModal();if(t)updateQueueFromTrack(t);break; }
      case 'modal-like': { const t=findByKey(btn.dataset.key);closeModal();if(t)toggleLike(t);break; }
      case 'modal-add-playlist': { const t=findByKey(btn.dataset.key);if(t)openAddToPlaylist(t);break; }
      case 'close-modal': closeModal(); break;
      case 'modal-theme': state.theme=state.theme==='dark'?'light':'dark';applyTheme();persist();openSettings();break;
      case 'export-backup': exportBackup();break;
      case 'clear-data': clearData();break;
      case 'play-collection': playCurrentCollection(0);break;
      case 'play-playlist': {const p=state.playlists.find(x=>x.id===btn.dataset.id);if(p?.tracks.length){state.queue=p.tracks.slice();state.queueIndex=0;playTrack(state.queue[0],{fromQueue:true});renderPanelTab();}else toast('This playlist is empty. Add some tracks first.');break;}
      case 'open-playlist': renderPlaylist(btn.dataset.id);state.page='playlists';history.replaceState({page:'playlists'},'','#playlists');setActiveNav('playlists');break;
      case 'delete-playlist': {const p=state.playlists.find(x=>x.id===btn.dataset.id);if(p&&confirm(`Delete playlist “${p.name}”?`)){state.playlists=state.playlists.filter(x=>x.id!==p.id);persist();renderSidebarPlaylists();renderPlaylists();toast('Playlist deleted.');}break;}
      case 'rename-playlist': {const p=state.playlists.find(x=>x.id===btn.dataset.id);if(!p)return;const name=prompt('New playlist name:',p.name);if(name?.trim()){p.name=name.trim().slice(0,70);persist();renderSidebarPlaylists();renderPlaylist(p.id);toast('Playlist renamed.','success');}break;}
      case 'clear-playlist': {const p=state.playlists.find(x=>x.id===btn.dataset.id);if(p&&confirm(`Remove all tracks from “${p.name}”?`)){p.tracks=[];persist();renderPlaylist(p.id);toast('Playlist cleared.');}break;}
      case 'clear-history': if(confirm('Clear your recent listening history?')){state.history=[];persist();renderHistory();toast('History cleared.');}break;
      case 'play-queue-item': {const i=Number(btn.dataset.index);if(state.queue[i]){state.queueIndex=i;playTrack(state.queue[i],{fromQueue:true});renderPanelTab();}break;}
      case 'remove-queue': removeQueueItem(Number(btn.dataset.index));break;
      case 'sleep-timer': openModal(`<div class="modal-head"><div><h2 id="modal-title">Sleep timer</h2><p>Playback will pause automatically when the timer ends.</p></div><button class="circle-btn" data-action="close-modal">×</button></div><label class="field-label">Stop after<select class="field-control" id="sleep-select"><option value="0">Off</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label><div class="modal-actions"><button class="modal-secondary" data-action="close-modal">Cancel</button><button class="modal-primary" data-action="apply-sleep">Set timer</button></div>`);if(state.sleepTimer)$('#sleep-select').value=String(state.sleepTimer.minutes);break;
      case 'apply-sleep': {const min=Number($('#sleep-select')?.value||0);setSleepTimer(min);closeModal();break;}
      case 'play-now-track': {const t=findByKey(btn.dataset.key);if(t){state.queue=[t];state.queueIndex=0;playTrack(t,{fromQueue:true});}break;}
      case 'delete-local': deleteLocalTrack(findByKey(btn.dataset.key));break;
      default: break;
    }
  }
  function onModalSubmit(event) {
    const form = event.target;
    if (form.id === 'create-playlist-form') {
      event.preventDefault(); const name=String(new FormData(form).get('playlistName')||'').trim();
      if(!name)return;
      const playlist={id:crypto.randomUUID(),name:name.slice(0,70),description:String(new FormData(form).get('playlistDescription')||'').trim().slice(0,140),tracks:[]};
      state.playlists.unshift(playlist);persist();renderSidebarPlaylists();closeModal();navigate('playlists');toast('Playlist created.','success');
    } else if (form.id === 'create-and-add-form') {
      event.preventDefault();const name=String(new FormData(form).get('playlistName')||'').trim();const track=findByKey(form.dataset.key);if(!name||!track)return;
      const p={id:crypto.randomUUID(),name:name.slice(0,70),tracks:[normalizeTrack(track)]};state.playlists.unshift(p);persist();renderSidebarPlaylists();closeModal();toast(`Created ${p.name} and added the track.`,'success');if(state.page==='playlists')renderPlaylists();
    } else if (form.id === 'add-playlist-form') {
      event.preventDefault();const playlistId=String(new FormData(form).get('playlistId')||'');const track=findByKey(form.dataset.key);closeModal();if(track)addTrackToPlaylist(track,playlistId);
    }
  }
  function setupControls() {
    document.addEventListener('click',onDocumentClick);
    pageContent.addEventListener('click', event => {
      const card = event.target.closest('.track-card[data-track-key]');
      if (!card || event.target.closest('button,a,input')) return;
      const track = findByKey(card.dataset.trackKey);
      if (!track) return;
      const collection = state.currentCollection?.length ? state.currentCollection : state.results;
      const index = collection.findIndex(item => keyOf(item) === keyOf(track));
      if (index >= 0) playCurrentCollection(index);
      else { state.queue = [track]; state.queueIndex = 0; playTrack(track, {fromQueue:true}); }
      state.panelTab = 'queue';
      renderPanelTab();
      document.body.classList.add('show-player-panel','has-track');
    });
    $('#expanded-play').addEventListener('click', () => $('#play-pause-btn').click());
    $('#expanded-previous').addEventListener('click', () => $('#previous-btn').click());
    $('#expanded-next').addEventListener('click', () => $('#next-btn').click());
    $('#expanded-shuffle').addEventListener('click', () => $('#shuffle-btn').click());
    $('#expanded-repeat').addEventListener('click', () => $('#repeat-btn').click());
    $('#expanded-seek').addEventListener('input', event => {
      $('#seek-slider').value = event.target.value;
      $('#seek-slider').dispatchEvent(new Event('input', {bubbles:true}));
    });
    modalCard.addEventListener('submit',onModalSubmit);
    $('#search-form').addEventListener('submit',e=>{e.preventDefault();searchMusic($('#search-input').value);});
    $('#search-input').addEventListener('keydown',e=>{if(e.key==='Escape'){e.target.value='';state.query='';navigate('search');}});
    $('#new-playlist-side').addEventListener('click',openCreatePlaylist);
    $('#open-settings').addEventListener('click',openSettings);
    $('#preferences-top').addEventListener('click',openSettings);
    $('#theme-toggle').addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();persist();});
    $('#import-audio-top').addEventListener('click',()=>$('#audio-file-input').click());
    $('#audio-file-input').addEventListener('change',async e=>{await importAudioFiles(e.target.files||[]);e.target.value='';});
    $('#play-pause-btn').addEventListener('click',togglePlayback);
    $('#next-btn').addEventListener('click',()=>playNext(false));
    $('#previous-btn').addEventListener('click',playPrevious);
    $('#shuffle-btn').addEventListener('click',()=>{state.shuffle=!state.shuffle;$('#shuffle-btn').classList.toggle('active',state.shuffle);persist();toast(state.shuffle?'Shuffle enabled.':'Shuffle disabled.', 'success',1400);});
    $('#repeat-btn').addEventListener('click',()=>{state.repeat=state.repeat==='off'?'all':state.repeat==='all'?'one':'off';$('#repeat-btn').classList.toggle('active',state.repeat!=='off');$('#repeat-btn').title=`Repeat: ${state.repeat}`;persist();toast(`Repeat: ${state.repeat}.`, 'success',1400);});
    $('#seek-slider').addEventListener('input',e=>{paintRange(e.target);const duration=getDuration();if(!duration)return;const target=duration*Number(e.target.value)/1000;audio.currentTime=target;});
    $('#volume-slider').addEventListener('input',e=>{state.volume=Number(e.target.value);paintRange(e.target);audio.volume=state.volume/100;$('#volume-btn').textContent=state.volume===0?'◖×':'◖))';persist();});
    $('#volume-btn').addEventListener('click',()=>{state.volume=state.volume===0?75:0;$('#volume-slider').value=String(state.volume);paintRange($('#volume-slider'));audio.volume=state.volume/100;$('#volume-btn').textContent=state.volume===0?'◖×':'◖))';persist();});
    $('#now-like').addEventListener('click',()=>toggleLike());$('#bottom-like').addEventListener('click',()=>toggleLike());
    $('#open-queue-btn').addEventListener('click',()=>{state.panelTab='queue';renderPanelTab();document.body.classList.add('show-player-panel');if(state.currentTrack)document.body.classList.add('has-track');$('#player-panel').scrollTo({top:0,behavior:'smooth'});});
    $('#expand-player-btn').addEventListener('click',()=>{document.body.classList.toggle('show-player-panel');if(state.currentTrack)document.body.classList.add('has-track');$('#player-panel').scrollTo({top:0,behavior:'smooth'});});
    // Minimize is handled in capture phase so no overlay/card handler can swallow the tap.
    const minimizePlayer = event => {
      event.preventDefault();
      event.stopPropagation();
      document.body.classList.remove('show-player-panel', 'show-player-mobile');
      const closeButton = $('#close-player-panel');
      if (closeButton) closeButton.blur();
    };
    $('#close-player-panel').addEventListener('click', minimizePlayer, true);
    // Fallback for mobile browsers where a layered element receives the tap target.
    document.addEventListener('click', event => {
      const closeButton = event.target.closest('#close-player-panel');
      if (closeButton) minimizePlayer(event);
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') document.body.classList.remove('show-player-panel','show-player-mobile');
    });
    $('.bottom-track').addEventListener('click',e=>{if(e.target.closest('button'))return;document.body.classList.add('show-player-panel');state.panelTab='queue';renderPanelTab();$('#player-panel').scrollTo({top:0,behavior:'smooth'});});
    $('#sleep-timer-btn').addEventListener('click',()=>document.querySelector('[data-action="sleep-timer"]')?.click() || openSleepFallback());
    $('#go-back').addEventListener('click',()=>{if(state.page==='search'&&state.lastView!=='search')navigate(state.lastView);else navigate('home');});
    $('#go-forward').addEventListener('click',()=>navigate('search'));
    modalBackdrop.addEventListener('click',e=>{if(e.target===modalBackdrop)closeModal();});
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&!modalBackdrop.hidden){closeModal();return;}
      const target=e.target; if(target.matches('input,textarea,select,[contenteditable="true"]') || target.closest('button,a,[role="button"]'))return;
      if(e.code==='Space'){e.preventDefault();togglePlayback();}
      if(e.key==='ArrowRight'&&state.currentTrack){const t=Math.min(getDuration(),getCurrentTime()+5);audio.currentTime=t;}
      if(e.key==='ArrowLeft'&&state.currentTrack){const t=Math.max(0,getCurrentTime()-5);audio.currentTime=t;}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search-input').focus();}
    });
    audio.addEventListener('play',()=>{state.isPlaying=true;updatePlaybackButton();updateSourceLabel(state.currentTrack?.type === 'local' ? 'Local audio file' : 'Audius audio stream'); const stage=$('#audio-stage'); if(stage)stage.classList.add('is-playing');});
    audio.addEventListener('pause',()=>{state.isPlaying=false;updatePlaybackButton(); const stage=$('#audio-stage'); if(stage)stage.classList.remove('is-playing');});
    audio.addEventListener('ended',()=>{state.isPlaying=false;playNext(true);});
    audio.addEventListener('timeupdate',updateProgress);
    audio.addEventListener('loadedmetadata',updateProgress);
    audio.addEventListener('error',()=>{ if (state.currentTrack && state.isPlaying) { state.isPlaying=false; updatePlaybackButton(); toast('Audio could not be streamed. Try another track or check your connection.', 'error', 4500); } });
    window.addEventListener('popstate',()=>navigate(location.hash.slice(1)||'home',{keepHash:true}));
    $('#repeat-btn').classList.toggle('active',state.repeat!=='off');$('#shuffle-btn').classList.toggle('active',state.shuffle);
  }
  function openSleepFallback() {
    openModal(`<div class="modal-head"><div><h2 id="modal-title">Sleep timer</h2><p>Stop playback automatically.</p></div><button class="circle-btn" data-action="close-modal">×</button></div><label class="field-label">Stop after<select class="field-control" id="sleep-select"><option value="0">Off</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label><div class="modal-actions"><button class="modal-primary" data-action="apply-sleep">Set timer</button></div>`);
  }
  function setupServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      const scriptUrl = new URL('sw.js', document.baseURI);
      const scopePath = new URL('./', document.baseURI).pathname;
      navigator.serviceWorker.register(scriptUrl, {scope: scopePath}).catch(err=>console.debug('Service worker skipped:',err));
    }
  }
  async function restoreLocalLibrary() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (!Array.isArray(saved.localTracks)) return;
    } catch {}
  }
  async function init() {
    readStored();
    setupControls();
    $('#liked-count').textContent=String(state.liked.length);
    renderSidebarPlaylists();
    $('#volume-slider').value=String(state.volume);paintRange($('#volume-slider'));
    renderHome();
    renderPanelTab();
    setupServiceWorker();
    await fetchStatus();
    if (location.hash && location.hash.length>1) navigate(location.hash.slice(1),{keepHash:true});
    if (state.currentTrack) { updateTrackUI();document.body.classList.add('has-track'); }
    updatePlaybackButton();
  }
  init().catch(err=>{console.error(err);pageContent.innerHTML='<div class="empty-state"><b>Ausic could not start</b><p>Refresh the page and check the README setup steps.</p></div>';});
})();
