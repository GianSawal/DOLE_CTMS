/**
 * Local Video Playlist & Directory Utility
 * 
 * Supports playing local video files or folder links sequentially in a continuous loop:
 * - When one video ends, it auto-advances to the next video in the folder.
 * - Loops indefinitely with 0 server storage used.
 */

const DB_NAME = 'dole_ctms_video_playlist_db';
const DB_VERSION = 5;
const STORE_NAME = 'videos';
const META_STORE = 'meta';

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
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
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
 * Native folder picker using File System Access API (window.showDirectoryPicker).
 * Prompts user to select an entire folder once, and reads all video files automatically.
 */
export async function pickFolderNative() {
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      if (!dirHandle) return null;

      const fileList = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          try {
            const f = await entry.getFile();
            fileList.push(f);
          } catch (e) {
            console.warn('Could not read file from folder:', entry.name, e);
          }
        }
      }

      return {
        files: fileList,
        folderName: dirHandle.name,
        dirHandle,
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        return null; // User cancelled
      }
      console.warn('showDirectoryPicker unavailable, falling back:', err);
    }
  }
  return null;
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
export async function savePlaylistToIndexedDB(files, folderName = '', dirHandle = null) {
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

  // Persist files and folder metadata into IndexedDB for reload persistence
  try {
    const db = await openDb();
    const storesToUse = [STORE_NAME];
    if (db.objectStoreNames.contains(META_STORE)) {
      storesToUse.push(META_STORE);
    }
    const tx = db.transaction(storesToUse, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const metaStore = storesToUse.includes(META_STORE) ? tx.objectStore(META_STORE) : null;

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

    if (metaStore && folderName) {
      metaStore.put(folderName, 'folder_name');
    }
    if (metaStore && dirHandle) {
      metaStore.put(dirHandle, 'active_folder_handle');
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    try {
      localStorage.setItem('ctms_tv_has_local_folder', 'true');
      localStorage.setItem('ctms_tv_has_local_video', 'true');
      if (sorted[0]?.name) {
        localStorage.setItem('ctms_tv_local_video_name', sorted[0].name);
      }
    } catch {}
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

    // 1. Try reading from dirHandle if saved and permission is granted
    if (db.objectStoreNames.contains(META_STORE)) {
      try {
        const metaTx = db.transaction(META_STORE, 'readonly');
        const metaStore = metaTx.objectStore(META_STORE);
        const dirHandle = await new Promise((resolve) => {
          const req = metaStore.get('active_folder_handle');
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });

        if (dirHandle && typeof dirHandle.queryPermission === 'function') {
          const perm = await dirHandle.queryPermission({ mode: 'read' });
          if (perm === 'granted') {
            const files = [];
            for await (const entry of dirHandle.values()) {
              if (entry.kind === 'file') {
                try {
                  const f = await entry.getFile();
                  files.push(f);
                } catch {}
              }
            }
            const sorted = filterAndSortVideoFiles(files);
            if (sorted.length > 0) {
              return sorted.map((file, i) => ({
                id: i,
                name: file.name,
                size: file.size,
                type: file.type || 'video/mp4',
                url: URL.createObjectURL(file),
              }));
            }
          }
        }
      } catch (e) {
        console.debug('dirHandle load note:', e);
      }
    }

    // 2. Fallback: read stored blobs from STORE_NAME
    if (db.objectStoreNames.contains(STORE_NAME)) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);

      const records = await new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });

      if (records && records.length > 0) {
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
                  type: r.type || 'video/mp4',
                  url,
                });
              }
            } catch (e) {
              console.warn('Error creating ObjectURL for record:', r.name, e);
            }
          }
        }

        if (validItems.length > 0) {
          return validItems;
        }
      }
    }

    return [];
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
    const storesToClear = [];
    if (db.objectStoreNames.contains(STORE_NAME)) storesToClear.push(STORE_NAME);
    if (db.objectStoreNames.contains(META_STORE)) storesToClear.push(META_STORE);

    if (storesToClear.length > 0) {
      const tx = db.transaction(storesToClear, 'readwrite');
      storesToClear.forEach(s => tx.objectStore(s).clear());
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
    }

    try {
      localStorage.removeItem('ctms_tv_has_local_folder');
      localStorage.removeItem('ctms_tv_has_local_video');
      localStorage.removeItem('ctms_tv_local_video_name');
    } catch {}
  } catch (err) {
    console.debug('IndexedDB playlist clear note:', err);
  }
}
