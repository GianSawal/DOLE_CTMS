/**
 * Local Video Playlist & Directory Utility
 * 
 * Supports playing local video files or folder links sequentially in a continuous loop:
 * - When one video ends, it auto-advances to the next video in the folder.
 * - Loops indefinitely with 0 server storage used.
 */

const DB_NAME = 'dole_ctms_video_playlist_db';
const DB_VERSION = 1;
const STORE_NAME = 'videos';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported in this browser.'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Filter and sort video files (natural numeric ordering e.g. 1.mp4, 2.mp4, 10.mp4)
 */
export function filterAndSortVideoFiles(files) {
  if (!files || !files.length) return [];
  const list = Array.from(files);

  const videoExtensionsRegex = /\.(mp4|webm|ogg|mov|mkv|avi|m4v|wmv|flv|ts|3gp|m4p|mpg|mpeg)$/i;

  const videoFiles = list.filter((f) => {
    if (!f || !f.name) return false;
    // Exclude hidden files or AppleDouble files
    if (f.name.startsWith('.') || f.name.startsWith('._')) return false;

    const isVideoType = Boolean(f.type && f.type.toLowerCase().startsWith('video/'));
    const isVideoExt = videoExtensionsRegex.test(f.name);
    return isVideoType || isVideoExt;
  });

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  videoFiles.sort((a, b) => collator.compare(a.name, b.name));

  return videoFiles;
}

/**
 * Parse an HTTP directory / folder link or multiple video links
 */
export async function parseFolderLink(folderUrl) {
  if (!folderUrl || typeof folderUrl !== 'string') return [];
  const trimmed = folderUrl.trim();
  if (!trimmed) return [];

  // 1. Try querying backend folder-videos endpoint (resolves server paths, CORS-free HTTP directories, etc.)
  try {
    const res = await fetch(`/api/public/folder-videos/?folder=${encodeURIComponent(trimmed)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.videos && data.videos.length > 0) {
        return data.videos.map((v, i) => ({
          id: i,
          name: v.name || `Video ${i + 1}`,
          url: v.url,
        }));
      }
    }
  } catch (err) {
    console.debug('Backend folder-videos check:', err);
  }

  // 2. Client-side parsing for multiple URLs separated by newlines, commas, or semicolons
  const lines = trimmed.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean);
  if (lines.length > 1) {
    return lines.map((url, i) => ({
      id: i,
      name: url.split('/').pop().split('?')[0] || `Video ${i + 1}`,
      url,
    }));
  }

  // 3. Client-side fallback for direct HTTP/HTTPS directory listing
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const res = await fetch(trimmed);
      if (res.ok) {
        const text = await res.text();
        // Check if JSON list
        try {
          const json = JSON.parse(text);
          if (Array.isArray(json)) {
            return json.map((item, i) => {
              const url = typeof item === 'string' ? item : (item.url || item.path || '');
              return {
                id: i,
                name: typeof item === 'string' ? item.split('/').pop() : (item.name || `Video ${i + 1}`),
                url: url.startsWith('http') || url.startsWith('/') ? url : `${trimmed.replace(/\/$/, '')}/${url}`,
              };
            });
          }
        } catch {}

        // Parse HTML directory index (e.g. Nginx autoindex, Apache directory)
        const regex = /href=["']([^"']+\.(?:mp4|webm|ogg|mov|mkv|m4v|wmv|flv|ts|3gp|mpg|mpeg))["']/gi;
        const matches = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
          const href = match[1];
          if (!href.startsWith('?') && !href.startsWith('/..')) {
            const fullUrl = href.startsWith('http') || href.startsWith('/')
              ? href
              : `${trimmed.replace(/\/$/, '')}/${href}`;
            matches.push({
              id: matches.length,
              name: decodeURIComponent(href.split('/').pop().split('?')[0]),
              url: fullUrl,
            });
          }
        }
        if (matches.length > 0) {
          const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
          matches.sort((a, b) => collator.compare(a.name, b.name));
          return matches;
        }
      }
    } catch (err) {
      console.debug('Client-side directory fetch notice:', err);
    }
  }

  // Fallback: single video link
  return [{
    id: 0,
    name: trimmed.split('/').pop().split('?')[0] || 'ARTA Awareness Video',
    url: trimmed,
  }];
}

/**
 * Saves a list of File objects to IndexedDB and returns working ObjectURL playlist items
 */
export async function savePlaylistToIndexedDB(files) {
  const sorted = filterAndSortVideoFiles(files);
  if (!sorted.length) return [];

  // Generate working ObjectURLs immediately for instant playback with 0 server storage
  const playlistItems = sorted.map((file, i) => ({
    id: i,
    name: file.name,
    size: file.size,
    type: file.type || 'video/mp4',
    url: URL.createObjectURL(file),
  }));

  // Persist files into IndexedDB for reload persistence
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Queue clear and all put requests synchronously in the active transaction
    store.clear();
    for (let i = 0; i < sorted.length; i++) {
      const file = sorted[i];
      store.put({
        id: i,
        name: file.name,
        size: file.size,
        type: file.type || 'video/mp4',
        blob: file,
        order: i,
      });
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB playlist storage note (in-memory ObjectURLs active):', err);
  }

  return playlistItems;
}

/**
 * Loads saved playlist records from IndexedDB
 */
export async function loadPlaylistFromIndexedDB() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const records = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    if (!records || !records.length) return [];
    records.sort((a, b) => a.order - b.order);

    const validItems = [];
    for (const r of records) {
      if (r && r.blob) {
        try {
          const url = URL.createObjectURL(r.blob);
          if (url) {
            validItems.push({
              id: r.id,
              name: r.name,
              size: r.size,
              url,
            });
          }
        } catch (e) {
          console.warn('Error creating ObjectURL for record:', r.name, e);
        }
      }
    }

    return validItems;
  } catch (err) {
    console.debug('IndexedDB playlist load note:', err);
    return [];
  }
}

/**
 * Clears the stored playlist from IndexedDB
 */
export async function clearPlaylistFromIndexedDB() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  } catch (err) {
    console.debug('IndexedDB playlist clear note:', err);
  }
}
