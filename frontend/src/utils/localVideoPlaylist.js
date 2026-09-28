/**
 * Local Video Playlist & IndexedDB Persistence Utility
 * 
 * Allows TV displays to play a local directory of video files in continuous loop
 * without uploading to the server (0 server storage used, zero network latency).
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

  const videoFiles = list.filter((f) => {
    const isVideoType = f.type && f.type.startsWith('video/');
    const isVideoExt = /\.(mp4|webm|ogg|mov|mkv|avi|m4v)$/i.test(f.name);
    return isVideoType || isVideoExt;
  });

  // Natural alphabetical/numeric sort by filename
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  videoFiles.sort((a, b) => collator.compare(a.name, b.name));

  return videoFiles;
}

/**
 * Saves a list of File objects to IndexedDB
 */
export async function savePlaylistToIndexedDB(files) {
  try {
    const db = await openDb();
    const sorted = filterAndSortVideoFiles(files);
    if (!sorted.length) return [];

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Clear previous playlist first
    await new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = resolve;
      req.onerror = reject;
    });

    const savedItems = [];
    for (let i = 0; i < sorted.length; i++) {
      const file = sorted[i];
      const record = {
        id: i,
        name: file.name,
        size: file.size,
        type: file.type || 'video/mp4',
        blob: file, // Store File/Blob directly
        order: i,
      };
      store.put(record);
      savedItems.push({
        id: i,
        name: file.name,
        size: file.size,
        url: URL.createObjectURL(file),
      });
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });

    return savedItems;
  } catch (err) {
    console.debug('IndexedDB playlist save note:', err);
    // Fallback: return in-memory object URLs
    return filterAndSortVideoFiles(files).map((f, i) => ({
      id: i,
      name: f.name,
      size: f.size,
      url: URL.createObjectURL(f),
    }));
  }
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
      req.onerror = reject;
    });

    if (!records.length) return [];

    // Sort by original order
    records.sort((a, b) => a.order - b.order);

    return records.map((r) => ({
      id: r.id,
      name: r.name,
      size: r.size,
      url: URL.createObjectURL(r.blob),
    }));
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
    await new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = resolve;
      req.onerror = reject;
    });
  } catch (err) {
    console.debug('IndexedDB playlist clear note:', err);
  }
}
