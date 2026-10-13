import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { publicApi } from '../../api/public';
import { translations } from '../../locales/translations';
import {
  playAirportChime,
  announceNowServing,
  cancelAllAnnouncements,
  getAudioContext,
  unlockAudioContext,
  isAudioUnlocked,
  CHIME_BROADCAST_CHANNEL,
  ANNOUNCEMENT_START_EVENT,
  ANNOUNCEMENT_END_EVENT,
} from '../../utils/airportChime';
import { parseVideoEmbedUrl } from '../../components/ArtaVideoModal';
import {
  parseFolderLink,
  savePlaylistToIndexedDB,
  loadPlaylistFromIndexedDB,
  clearPlaylistFromIndexedDB,
  pickFolderNative,
} from '../../utils/localVideoPlaylist';

// Now Serving: a grid of cards. As an office adds windows the grid gains columns and
// the type shrinks, so every window stays visible and readable.
function windowCardSizing(count) {
  if (count <= 1) return { cols: 1, queueFont: '6.5rem', nameFont: '1.9rem', detailFont: '1.05rem', pad: '1.25rem 1.6rem', gap: '1rem' };
  if (count <= 2) return { cols: 1, queueFont: '4.5rem', nameFont: '1.5rem', detailFont: '1rem', pad: '1rem 1.35rem', gap: '0.9rem' };
  if (count <= 4) return { cols: 2, queueFont: '3.5rem', nameFont: '1.3rem', detailFont: '0.9rem', pad: '0.9rem 1.15rem', gap: '0.8rem' };
  if (count <= 6) return { cols: 2, queueFont: '2.75rem', nameFont: '1.1rem', detailFont: '0.82rem', pad: '0.65rem 0.95rem', gap: '0.65rem' };
  if (count <= 9) return { cols: 2, queueFont: '2.1rem', nameFont: '0.95rem', detailFont: '0.72rem', pad: '0.5rem 0.8rem', gap: '0.5rem', compact: true };
  return { cols: 3, queueFont: '1.6rem', nameFont: '0.82rem', detailFont: '0.65rem', pad: '0.35rem 0.65rem', gap: '0.4rem', compact: true };
}

export default function DisplayBoard() {
  const { officeId } = useParams();
  // Secret key from the TV link on the Check-in QR page; unlocks the current check-in code.
  const [searchParams] = useSearchParams();
  const displayKey = searchParams.get('key') || '';
  const [lang, setLang] = useState('en');
  const t = translations[lang];
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const [displayData, setDisplayData] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('ctms_display_sound_enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('ctms_display_theme') || 'dark';
  });

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('ctms_display_theme', nextTheme);
  };

  const DEFAULT_ARTA_VIDEO = '';

  const sanitizeVideoUrl = (url) => {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (
      trimmed.includes('7uK7f0E4g2w') ||
      trimmed.includes('2e6i5GjD4iY') ||
      trimmed.includes('D0EpyUudmkU') ||
      trimmed.includes('mgpg54pyWio')
    ) {
      return '';
    }
    return trimmed;
  };

  const isLight = theme === 'light';
  const [audioUnlocked, setAudioUnlocked] = useState(() => isAudioUnlocked());
  // ARTA video is linked locally by staff on the TV display — not fetched from server
  const [artaVideoUrl, setArtaVideoUrl] = useState('');

  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderInputVal, setFolderInputVal] = useState('');
  const [folderStatusMessage, setFolderStatusMessage] = useState('');
  const [folderStatusType, setFolderStatusType] = useState('info'); // 'info', 'success', 'error'
  const [activeFolderName, setActiveFolderName] = useState(() => {
    return localStorage.getItem(`ctms_tv_folder_name_${officeId}`) || localStorage.getItem('ctms_tv_folder_name') || '';
  });
  const [isLocalPlaylistLoading, setIsLocalPlaylistLoading] = useState(() => {
    try {
      return (
        localStorage.getItem(`ctms_tv_has_local_folder_${officeId}`) === 'true' ||
        localStorage.getItem(`ctms_tv_has_local_video_${officeId}`) === 'true' ||
        localStorage.getItem('ctms_tv_has_local_folder') === 'true' ||
        localStorage.getItem('ctms_tv_has_local_video') === 'true'
      );
    } catch {
      return false;
    }
  });
  const folderFileInputRef = useRef(null);
  const singleFileInputRef = useRef(null);
  const videoRef = useRef(null);
  const isUserPausedRef = useRef(false);
  const isLocalPlaylistActiveRef = useRef(false);
  const iframeRef = useRef(null);
  const defaultVideoVolumeRef = useRef(0.75);
  const isDuckingRef = useRef(false);
  const duckIntervalRef = useRef(null);

  const isFolderLike = (url) => {
    if (!url) return false;
    const t = url.trim();
    return t.includes(',') || t.includes('\n') || t.includes(';') || t.endsWith('/') || !/\.[a-zA-Z0-9]{2,5}($|\?)/.test(t);
  };

  const currentVideoItem = playlist.length > 0 ? (playlist[currentIndex] || playlist[0]) : null;
  const currentVideoUrl = useMemo(() => {
    if (currentVideoItem?.url) {
      return currentVideoItem.url;
    }
    // If local videos are still loading from IndexedDB, do not render a fallback URL yet
    if (isLocalPlaylistLoading) {
      return null;
    }
    // If custom artaVideoUrl is present (e.g. backend uploaded file /media/arta_videos/xxx.mp4 or custom URL)
    if (artaVideoUrl && !isFolderLike(artaVideoUrl)) {
      return sanitizeVideoUrl(artaVideoUrl);
    }
    // Check localStorage cache as fallback
    try {
      const cached = localStorage.getItem(`ctms_arta_video_${officeId}`) || localStorage.getItem('ctms_arta_video');
      if (cached) {
        const parsed = JSON.parse(cached);
        const active = parsed.isActive !== false && parsed.is_active !== false;
        const url = active ? (parsed.videoUrl || parsed.url) : null;
        if (url && !isFolderLike(url)) return sanitizeVideoUrl(url);
      }
    } catch { }

    // Only if local loading is finished and no uploaded or local video exists
    return '';
  }, [currentVideoItem, isLocalPlaylistLoading, artaVideoUrl, officeId]);

  const artaEmbed = useMemo(() => {
    return currentVideoUrl ? parseVideoEmbedUrl(currentVideoUrl) : null;
  }, [currentVideoUrl]);

  const prevServingRef = useRef([]);
  const lastCalledRef = useRef(null);
  const isInitialLoadRef = useRef(true);

  // Audio ducking functions: smoothly tone down video when queue call begins
  const duckAudio = (targetVolume = 0.08, durationMs = 300) => {
    if (!videoRef.current) return;
    isDuckingRef.current = true;
    if (duckIntervalRef.current) clearInterval(duckIntervalRef.current);
    const video = videoRef.current;
    const startVol = video.volume;
    const steps = 10;
    const stepTime = durationMs / steps;
    const volStep = (startVol - targetVolume) / steps;
    let step = 0;

    duckIntervalRef.current = setInterval(() => {
      step++;
      const newVol = Math.max(0, startVol - volStep * step);
      if (video) video.volume = Math.max(0, Math.min(1, newVol));
      if (step >= steps) {
        clearInterval(duckIntervalRef.current);
        if (video) video.volume = targetVolume;
      }
    }, stepTime);
  };

  // Restore video volume when announcement finishes
  const restoreAudio = (targetVolume = defaultVideoVolumeRef.current, durationMs = 500) => {
    if (!videoRef.current) return;
    if (duckIntervalRef.current) clearInterval(duckIntervalRef.current);
    const video = videoRef.current;
    const startVol = video.volume;
    const steps = 10;
    const stepTime = durationMs / steps;
    const volStep = (targetVolume - startVol) / steps;
    let step = 0;

    duckIntervalRef.current = setInterval(() => {
      step++;
      const newVol = Math.min(1, startVol + volStep * step);
      if (video) video.volume = Math.max(0, Math.min(1, newVol));
      if (step >= steps) {
        clearInterval(duckIntervalRef.current);
        if (video) video.volume = targetVolume;
        isDuckingRef.current = false;
      }
    }, stepTime);
  };

  const handleDuckStart = () => {
    duckAudio(0.08, 250);
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setVolume', args: [10] }),
          '*'
        );
      } catch { }
    }
  };

  const handleDuckEnd = () => {
    restoreAudio(defaultVideoVolumeRef.current, 400);
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setVolume', args: [80] }),
          '*'
        );
      } catch { }
    }
  };

  // Global listener for first user interaction (touch, click, key) to unlock Web Audio API & TTS
  useEffect(() => {
    const handleUnlock = (e) => {
      const isVideoTarget = e?.target?.closest?.('video') || e?.target?.tagName === 'VIDEO';

      unlockAudioContext().then(unlocked => {
        if (unlocked) {
          setAudioUnlocked(true);
          if (videoRef.current) {
            videoRef.current.muted = false;
            videoRef.current.volume = isDuckingRef.current ? 0.08 : defaultVideoVolumeRef.current;
            if (!isUserPausedRef.current && !isVideoTarget && videoRef.current.paused) {
              videoRef.current.play().catch(() => { });
            }
          }
        }
      });
    };

    window.addEventListener('click', handleUnlock);
    window.addEventListener('touchstart', handleUnlock);
    window.addEventListener('keydown', handleUnlock);

    return () => {
      window.removeEventListener('click', handleUnlock);
      window.removeEventListener('touchstart', handleUnlock);
      window.removeEventListener('keydown', handleUnlock);
    };
  }, []);

  // Listen for announcement lifecycle events for audio ducking
  useEffect(() => {
    window.addEventListener(ANNOUNCEMENT_START_EVENT, handleDuckStart);
    window.addEventListener(ANNOUNCEMENT_END_EVENT, handleDuckEnd);

    return () => {
      window.removeEventListener(ANNOUNCEMENT_START_EVENT, handleDuckStart);
      window.removeEventListener(ANNOUNCEMENT_END_EVENT, handleDuckEnd);
      if (duckIntervalRef.current) clearInterval(duckIntervalRef.current);
    };
  }, []);

  // Ensure webkitdirectory property is set on the DOM node for full browser compatibility
  useEffect(() => {
    if (folderFileInputRef.current) {
      folderFileInputRef.current.setAttribute('webkitdirectory', '');
      folderFileInputRef.current.setAttribute('directory', '');
      folderFileInputRef.current.webkitdirectory = true;
    }
  }, []);

  // Auto-play trigger whenever direct video src changes
  useEffect(() => {
    if (videoRef.current && artaEmbed && artaEmbed.type === 'direct') {
      const v = videoRef.current;
      v.volume = isDuckingRef.current ? 0.08 : defaultVideoVolumeRef.current;
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          if (!isUserPausedRef.current) {
            v.muted = true;
            v.play().catch(() => { });
          }
        });
      }
    }
  }, [artaEmbed?.url]);

  // Load playlist: 1. IndexedDB local folder videos, 2. localStorage folder link, 3. backend artaVideoUrl
  useEffect(() => {
    let isMounted = true;
    async function initPlaylist() {
      // 1. Check local IndexedDB folder videos
      try {
        const dbItems = await loadPlaylistFromIndexedDB();
        if (isMounted && dbItems && dbItems.length > 0) {
          isLocalPlaylistActiveRef.current = true;
          setPlaylist(dbItems);
          setCurrentIndex(0);
          setIsLocalPlaylistLoading(false);
          return;
        }
      } catch (err) {
        console.warn('Error reading stored video playlist:', err);
      }

      if (isMounted) {
        setIsLocalPlaylistLoading(false);
      }

      // If active in-memory local folder playlist is already loaded, don't overwrite with backend polling
      if (isLocalPlaylistActiveRef.current) return;

      // 2. Check locally saved folder link on this TV display
      let savedTvLink = localStorage.getItem(`ctms_tv_folder_link_${officeId}`) || localStorage.getItem('ctms_tv_folder_link');
      if (savedTvLink && (savedTvLink.includes('7uK7f0E4g2w') || savedTvLink.includes('2e6i5GjD4iY') || savedTvLink.includes('D0EpyUudmkU'))) {
        localStorage.removeItem(`ctms_tv_folder_link_${officeId}`);
        localStorage.removeItem('ctms_tv_folder_link');
        savedTvLink = null;
      }

      // 3. Use only locally saved folder link (no server video fallback)
      const candidateUrl = savedTvLink || '';

      const targetUrl = candidateUrl ? sanitizeVideoUrl(candidateUrl) : '';
      if (!targetUrl) {
        if (isMounted) {
          setPlaylist([]);
          setCurrentIndex(0);
        }
        return;
      }

      const ytEmbed = parseVideoEmbedUrl(targetUrl);
      if (ytEmbed && ytEmbed.type === 'youtube') {
        if (isMounted) {
          setPlaylist([{ id: 0, url: ytEmbed.url, name: "ARTA Citizen's Charter", isYouTube: true }]);
          setCurrentIndex(0);
        }
        return;
      }

      if (isFolderLike(targetUrl)) {
        const items = await parseFolderLink(targetUrl);
        if (isMounted) {
          if (items && items.length > 0) {
            setPlaylist(items);
            setCurrentIndex(0);
            return;
          }
        }
      }

      if (isMounted) {
        const fileName = targetUrl.split('/').pop().split('?')[0] || "ARTA Awareness Video";
        setPlaylist([{ id: 0, url: targetUrl, name: fileName, isYouTube: false }]);
        setCurrentIndex(0);
      }
    }

    initPlaylist();
    return () => { isMounted = false; };
  }, [officeId, artaVideoUrl]);

  // Process selected folder files (auto-plays immediately and saves to IndexedDB)
  const processSelectedFolderFiles = async (files, folderName = '', dirHandle = null) => {
    if (!files || !files.length) return;

    setFolderStatusMessage('Scanning video files...');
    setFolderStatusType('info');

    try {
      const saved = await savePlaylistToIndexedDB(files, folderName, dirHandle);
      if (saved && saved.length > 0) {
        isUserPausedRef.current = false;
        isLocalPlaylistActiveRef.current = true;
        setPlaylist(saved);
        setCurrentIndex(0);
        setActiveFolderName(folderName || 'Selected Videos');
        localStorage.setItem(`ctms_tv_has_local_folder_${officeId}`, 'true');
        localStorage.setItem(`ctms_tv_has_local_video_${officeId}`, 'true');
        localStorage.setItem('ctms_tv_has_local_folder', 'true');
        localStorage.setItem('ctms_tv_has_local_video', 'true');
        if (folderName) {
          localStorage.setItem(`ctms_tv_folder_name_${officeId}`, folderName);
          localStorage.setItem('ctms_tv_folder_name', folderName);
        }
        localStorage.removeItem(`ctms_tv_folder_link_${officeId}`);
        localStorage.removeItem('ctms_tv_folder_link');
        setIsLocalPlaylistLoading(false);

        // Auto-close modal immediately
        setShowFolderModal(false);
        setFolderStatusMessage('');

        // Trigger instant playback
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.currentTime = 0;
            const p = videoRef.current.play();
            if (p !== undefined) {
              p.catch(() => {
                if (videoRef.current) {
                  videoRef.current.muted = true;
                  videoRef.current.play().catch(() => { });
                }
              });
            }
          }
        }, 100);

      } else {
        setFolderStatusMessage('No supported video files (.mp4, .webm, .mkv, .avi, .mov, etc.) found in the selection.');
        setFolderStatusType('error');
      }
    } catch (err) {
      console.error('Failed to process local video files:', err);
      setFolderStatusMessage('Error loading files. Please try selecting the files or folder again.');
      setFolderStatusType('error');
    }
  };

  const handleSelectFileClick = () => {
    if (singleFileInputRef.current) {
      singleFileInputRef.current.click();
    }
  };

  const handleSingleFilesSelected = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) {
      if (e.target) e.target.value = '';
      return;
    }
    const label = files.length === 1 ? files[0].name : `${files.length} Videos`;
    await processSelectedFolderFiles(files, label);
    if (e.target) e.target.value = '';
  };

  // Open native folder picker or fallback to webkitdirectory input
  const handleSelectFolderClick = async () => {
    // 1. Try modern File System Access API (showDirectoryPicker)
    // Opens the actual Windows "Select Folder" dialog directly!
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        setFolderStatusMessage('Opening folder picker...');
        setFolderStatusType('info');
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        if (dirHandle) {
          const fileList = [];
          for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
              try {
                const f = await entry.getFile();
                fileList.push(f);
              } catch (e) {
                console.warn('Could not read file:', entry.name, e);
              }
            }
          }
          await processSelectedFolderFiles(fileList, dirHandle.name, dirHandle);
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          setFolderStatusMessage('');
          return;
        }
        console.warn('Native folder picker fallback:', err);
      }
    }

    // 2. Fallback to input with webkitdirectory
    if (folderFileInputRef.current) {
      folderFileInputRef.current.click();
    }
  };

  // Handle files selected via file input
  const handleFolderFilesSelected = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) {
      if (e.target) e.target.value = '';
      return;
    }
    const detectedFolderName = files[0]?.webkitRelativePath
      ? files[0].webkitRelativePath.split('/')[0]
      : '';
    await processSelectedFolderFiles(files, detectedFolderName);
    if (e.target) e.target.value = '';
  };

  // Handle saving custom folder link or multiple URLs
  const handleSaveCustomFolderLink = async (e) => {
    e?.preventDefault?.();
    const trimmed = folderInputVal.trim();
    if (!trimmed) return;

    const isLocalDrivePath = /^[a-zA-Z]:[\\\/]/.test(trimmed) || trimmed.startsWith('file://');

    setFolderStatusMessage('Connecting to folder...');
    setFolderStatusType('info');

    try {
      const ytEmbed = parseVideoEmbedUrl(trimmed);
      if (ytEmbed && ytEmbed.type === 'youtube') {
        localStorage.setItem(`ctms_tv_folder_link_${officeId}`, trimmed);
        await clearPlaylistFromIndexedDB();
        isLocalPlaylistActiveRef.current = false;
        isUserPausedRef.current = false;
        setPlaylist([{ id: 0, url: ytEmbed.url, name: "ARTA Video", isYouTube: true }]);
        setCurrentIndex(0);
        setShowFolderModal(false);
        setFolderStatusMessage('');
        return;
      }

      const items = await parseFolderLink(trimmed);
      if (items && items.length > 0) {
        localStorage.setItem(`ctms_tv_folder_link_${officeId}`, trimmed);
        await clearPlaylistFromIndexedDB();
        isLocalPlaylistActiveRef.current = true;
        isUserPausedRef.current = false;
        setPlaylist(items);
        setCurrentIndex(0);
        setShowFolderModal(false);
        setFolderStatusMessage('');
      } else if (isLocalDrivePath) {
        setFolderStatusMessage('Local computer drive paths (e.g. C:\\...) cannot be opened directly by browser security. Please click "Choose Video Folder..." above to choose your folder directly.');
        setFolderStatusType('error');
      } else {
        localStorage.setItem(`ctms_tv_folder_link_${officeId}`, trimmed);
        await clearPlaylistFromIndexedDB();
        isLocalPlaylistActiveRef.current = false;
        isUserPausedRef.current = false;
        setPlaylist([{ id: 0, url: trimmed, isYouTube: false }]);
        setCurrentIndex(0);
        setShowFolderModal(false);
        setFolderStatusMessage('');
      }
    } catch (err) {
      console.error('Failed to parse folder link:', err);
      setFolderStatusMessage('Failed to connect to folder link.');
      setFolderStatusType('error');
    }
  };

  // Reset to default ARTA YouTube video
  const handleResetToDefaultVideo = async () => {
    isLocalPlaylistActiveRef.current = false;
    localStorage.removeItem(`ctms_tv_has_local_folder_${officeId}`);
    localStorage.removeItem(`ctms_tv_has_local_video_${officeId}`);
    localStorage.removeItem('ctms_tv_has_local_folder');
    localStorage.removeItem('ctms_tv_has_local_video');
    localStorage.removeItem(`ctms_tv_folder_name_${officeId}`);
    localStorage.removeItem('ctms_tv_folder_name');
    localStorage.removeItem(`ctms_tv_folder_link_${officeId}`);
    localStorage.removeItem('ctms_tv_folder_link');
    localStorage.removeItem(`ctms_arta_video_${officeId}`);
    localStorage.removeItem('ctms_arta_video');
    await clearPlaylistFromIndexedDB();
    setActiveFolderName('');
    setArtaVideoUrl('');
    setPlaylist([]);
    setCurrentIndex(0);
    setShowFolderModal(false);
    setFolderStatusMessage('');
  };

  // Auto-advance to next video in folder when current video finishes
  const handleVideoEnded = () => {
    if (playlist && playlist.length > 1) {
      isUserPausedRef.current = false;
      setCurrentIndex((prev) => (prev + 1) % playlist.length);
    }
  };

  const handleVideoCanPlay = (e) => {
    const video = e.target;
    if (isUserPausedRef.current) return;
    video.volume = isDuckingRef.current ? 0.08 : defaultVideoVolumeRef.current;
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        if (!isUserPausedRef.current) {
          video.muted = true;
          video.play().catch(() => { });
        }
      });
    }
  };

  const handleToggleSound = async () => {
    const nextState = !soundEnabled;
    setSoundEnabled(nextState);
    localStorage.setItem('ctms_display_sound_enabled', String(nextState));
    if (nextState) {
      await unlockAudioContext();
      setAudioUnlocked(true);
      const firstServing = displayData?.serving?.[0];
      announceNowServing({
        queueNo: firstServing?.queue_no || displayData?.next?.[0] || '042',
        counter: firstServing?.counter || 'Window 1',
        personnel: firstServing?.assigned_personnel || '',
        lang: langRef.current,
        bypassDedupe: true,
      });
    } else {
      cancelAllAnnouncements();
    }
  };

  const processedCallIdsRef = useRef(new Set());

  useEffect(() => {
    let isMounted = true;

    async function fetchDisplay() {
      try {
        const data = await publicApi.getDisplayBoard(officeId, displayKey);
        if (!isMounted) return;

        // Only a call newer than anything already announced triggers the chime.
        // When a client is marked Done or removed, the board falls back to an older
        // client; that must not be announced again.
        const callTime = (s) => (s?.called_at ? Date.parse(s.called_at) : 0);
        const serving = data.serving || [];
        const newestCall = serving.reduce((max, s) => Math.max(max, callTime(s)), 0);

        if (isInitialLoadRef.current) {
          lastCalledRef.current = newestCall;
          isInitialLoadRef.current = false;
        } else {
          const fresh = serving
            .filter(s => callTime(s) > (lastCalledRef.current || 0))
            .sort((x, y) => callTime(y) - callTime(x))[0];
          if (fresh && soundEnabled) {
            announceNowServing({
              queueNo: fresh.queue_no,
              counter: fresh.counter,
              personnel: fresh.assigned_personnel,
              lang: langRef.current,
            });
          }
          lastCalledRef.current = Math.max(lastCalledRef.current || 0, newestCall);
        }
        prevServingRef.current = serving;

        // ARTA video is linked locally — do not use server arta_video_url
        setDisplayData(data);
        setError('');
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Error fetching display data.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchDisplay();
    // Fast polling: 2500ms
    const interval = setInterval(fetchDisplay, 2500);

    // Cross-tab broadcast listener for instant 0ms chime and voice announcement
    let bc = null;
    let videoBc = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(CHIME_BROADCAST_CHANNEL);
        bc.onmessage = (event) => {
          if (!isMounted) return;
          if (event.data?.type === 'QUEUE_CALLED') {
            if (event.data?.callId) {
              processedCallIdsRef.current.add(event.data.callId);
            }
            if (!event.data.officeId || String(event.data.officeId) === String(officeId)) {
              if (soundEnabled) {
                announceNowServing({
                  queueNo: event.data.queueNo,
                  counter: event.data.counter,
                  personnel: event.data.personnel,
                  lang: langRef.current,
                });
              }
              // Immediately fetch updated display data
              fetchDisplay();
            }
          }
        };

        videoBc = new BroadcastChannel('ctms_arta_video_channel');
        videoBc.onmessage = (event) => {
          if (!isMounted) return;
          if (event.data?.type === 'ARTA_VIDEO_UPDATED') {
            // ARTA video is linked locally — ignore server video updates
            fetchDisplay();
          }
        };
      }
    } catch { }

    // Storage fallback for cross-tab sync
    const handleStorage = (e) => {
      if (!isMounted) return;
      if (e.key === 'dole_last_queue_call' && e.newValue) {
        try {
          const item = JSON.parse(e.newValue);
          if (item.callId && processedCallIdsRef.current.has(item.callId)) {
            return;
          }
          if (item.callId) {
            processedCallIdsRef.current.add(item.callId);
          }
          if (!item.officeId || String(item.officeId) === String(officeId)) {
            if (soundEnabled) {
              announceNowServing({
                queueNo: item.queueNo,
                counter: item.counter,
                personnel: item.personnel,
                lang: langRef.current,
              });
            }
            fetchDisplay();
          }
        } catch { }
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      isMounted = false;
      clearInterval(interval);
      cancelAllAnnouncements();
      if (bc) {
        try { bc.close(); } catch { }
      }
      if (videoBc) {
        try { videoBc.close(); } catch { }
      }
      window.removeEventListener('storage', handleStorage);
    };
  }, [officeId, displayKey, soundEnabled]);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: isLight ? '#e5e9f0' : '#0f172a', color: isLight ? '#0f172a' : '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ fontSize: '2rem' }}>Loading Display Board...</h1>
      </div>
    );
  }

  const windows = displayData?.windows || [];
  const nextNumbers = displayData?.next || [];
  const waitingCount = displayData?.waiting_count ?? nextNumbers.length;

  const themeStyles = {
    pageBg: isLight ? '#e5e9f0' : '#0a0f1d',
    pageColor: isLight ? '#0f172a' : '#ffffff',
    headerBorder: isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.1)',
    subTitleColor: isLight ? '#9a3412' : 'var(--dole-gold)',
    titleColor: isLight ? '#0f172a' : '#ffffff',
    sectionTitleColor: isLight ? '#1e3a8a' : 'var(--dole-gold)',
    cardBg: isLight ? '#f8fafc' : '#161e31',
    cardBorder: isLight ? '2px solid #3b82f6' : '2px solid rgba(3, 5, 186, 0.6)',
    cardShadow: isLight ? '0 4px 16px rgba(0, 0, 0, 0.06)' : '0 8px 24px rgba(0, 0, 0, 0.5)',
    counterLabel: isLight ? '#475569' : '#94a3b8',
    queueNoColor: isLight ? '#1e3a8a' : 'var(--dole-gold)',
    queueNoShadow: 'none',
    personnelBadgeBg: isLight ? 'rgba(217, 119, 6, 0.12)' : 'rgba(217, 119, 6, 0.22)',
    personnelBadgeBorder: isLight ? '2px solid rgba(217, 119, 6, 0.6)' : '2px solid rgba(255, 198, 3, 0.75)',
    personnelText: isLight ? '#92400e' : '#fef08a',
    personnelName: isLight ? '#1e3a8a' : '#ffffff',
    serviceBoxBg: isLight ? 'rgba(30, 58, 138, 0.05)' : 'rgba(255, 255, 255, 0.04)',
    serviceBoxBorder: isLight ? '1px solid rgba(30, 58, 138, 0.15)' : '1px solid rgba(255, 255, 255, 0.08)',
    serviceNameColor: isLight ? '#0f172a' : '#f8fafc',
    serviceDescColor: isLight ? '#475569' : '#94a3b8',
    emptyServingBg: isLight ? '#edf2f7' : '#161e31',
    emptyServingBorder: isLight ? '1px dashed rgba(0, 0, 0, 0.15)' : '1px dashed rgba(255, 255, 255, 0.15)',
    emptyServingColor: isLight ? '#64748b' : '#64748b',
    rightSectionBg: isLight ? '#f8fafc' : '#111827',
    rightSectionBorder: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.1)',
    rightSectionShadow: isLight ? '0 4px 16px rgba(0, 0, 0, 0.05)' : 'none',
    nextTitleColor: isLight ? '#1e3a8a' : '#93c5fd',
    nextTitleBorder: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.1)',
    nextItemBg: isLight ? '#edf2f7' : '#1e293b',
    nextItemNumber: isLight ? '#0f172a' : '#ffffff',
    nextItemBorder: isLight ? '1px solid #cbd5e1' : 'none',
    footerBorder: isLight ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.1)',
    footerColor: '#64748b',
    btnColor: isLight ? '#1e293b' : '#ffffff',
    btnBorder: isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.2)',
  };

  const cardSizing = windowCardSizing(windows.length);

  const nowServingTitle = (
          <div style={{
            fontSize: '1.25rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: themeStyles.sectionTitleColor,
          }}>
            {t.display_title}
          </div>
  );

  // Now Serving: one card per window, filling the column as a grid
  const windowCards = windows.length === 0 ? (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      background: themeStyles.emptyServingBg,
      border: themeStyles.emptyServingBorder,
      borderRadius: '16px',
      color: themeStyles.emptyServingColor,
      fontSize: '1.4rem',
      padding: '2rem',
    }}>
      {t.no_active_serving}
    </div>
  ) : (
    <div style={{
      flex: '1 1 0',
      minHeight: 0,
      display: 'grid',
      gridTemplateColumns: `repeat(${cardSizing.cols}, minmax(0, 1fr))`,
      gridAutoRows: 'minmax(0, 1fr)',
      gap: cardSizing.gap,
    }}>
      {windows.map(w => {
        const clients = w.clients || (w.current ? [w.current] : []);
        const cur = clients[0] || null;
        const isFresh = cur && cur.called_at && cur.called_at === displayData?.latest_called_at;
        const single = cur && clients.length === 1 && !cur.reassigned;
        const accent = cur?.is_priority ? (isLight ? '#d97706' : 'var(--dole-gold)') : (isLight ? '#1e40af' : '#3b82f6');
        const numberColor = (c) => (c.is_priority ? (isLight ? '#b45309' : 'var(--dole-gold)') : themeStyles.queueNoColor);
        const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
        return (
          <div key={w.id} style={{
            background: themeStyles.cardBg,
            border: cur ? themeStyles.cardBorder : themeStyles.emptyServingBorder,
            borderTop: cur ? `6px solid ${accent}` : themeStyles.emptyServingBorder,
            boxShadow: isFresh ? `0 0 0 4px ${isLight ? 'rgba(217,119,6,0.35)' : 'rgba(255,198,3,0.45)'}` : themeStyles.cardShadow,
            borderRadius: '16px',
            padding: cardSizing.pad,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: cardSizing.compact ? '0.15rem' : '0.35rem',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
            opacity: cur ? 1 : 0.75,
            transition: 'box-shadow 0.3s ease',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
              <span style={{ fontSize: cardSizing.nameFont, fontWeight: 900, color: themeStyles.titleColor, textTransform: 'uppercase', letterSpacing: '0.03em', lineHeight: 1.1, ...ellipsis }}>
                {w.name}
              </span>
              {cur?.is_priority && single && !cardSizing.compact && (
                <span style={{
                  flexShrink: 0,
                  fontSize: `calc(${cardSizing.detailFont} * 0.85)`,
                  fontWeight: 800,
                  padding: '0.15rem 0.6rem',
                  borderRadius: '9999px',
                  background: themeStyles.personnelBadgeBg,
                  border: themeStyles.personnelBadgeBorder,
                  color: themeStyles.personnelText,
                }}>PRIORITY</span>
              )}
            </div>

            {single ? (
              <>
                <span className="mono" style={{ fontSize: cardSizing.queueFont, fontWeight: 900, lineHeight: 1, color: numberColor(cur) }}>
                  {cur.queue_no}
                </span>
                {cur.personnel && (
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: `calc(${cardSizing.detailFont} + 0.1rem)`, fontWeight: 700, color: themeStyles.personnelName, ...ellipsis }}>
                      {cur.personnel}
                    </span>
                    <span style={{
                      fontSize: `calc(${cardSizing.detailFont} * 0.75)`,
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: themeStyles.counterLabel,
                      ...ellipsis,
                    }}>
                      {lang === 'fil' ? 'Tumutulong na Opisyal' : 'Assisting Officer'}
                    </span>
                  </span>
                )}
                {!cardSizing.compact && (
                  <span style={{ fontSize: cardSizing.detailFont, fontWeight: 600, color: themeStyles.serviceDescColor, ...ellipsis }}>
                    {cur.service_name}
                  </span>
                )}
              </>
            ) : cur ? (
              // Several clients at this window (e.g. reassigned ones): one line each
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minHeight: 0 }}>
                {clients.map(c => (
                  <div key={c.id} style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(0, 1fr)',
                    gap: '0.6rem',
                    alignItems: 'center',
                    background: themeStyles.serviceBoxBg,
                    border: themeStyles.serviceBoxBorder,
                    borderLeft: `4px solid ${c.reassigned ? (isLight ? '#d97706' : 'var(--dole-gold)') : (isLight ? '#1e40af' : '#3b82f6')}`,
                    borderRadius: '10px',
                    padding: '0.35rem 0.6rem',
                  }}>
                    <span className="mono" style={{ fontSize: `min(${cardSizing.queueFont}, 2.2rem)`, fontWeight: 900, lineHeight: 1, color: numberColor(c) }}>
                      {c.queue_no}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: '0.1rem' }}>
                      {c.reassigned ? (
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em', color: themeStyles.personnelText, ...ellipsis }}>
                          {lang === 'fil' ? 'INILIPAT KAY' : 'REASSIGNED TO'} {c.personnel}
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: themeStyles.personnelName, ...ellipsis }}>
                          {c.personnel}{c.is_priority ? ' · PRIORITY' : ''}
                        </span>
                      )}
                      {!cardSizing.compact && (
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: themeStyles.serviceNameColor, ...ellipsis }}>
                          {c.service_name}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <span style={{ fontSize: `min(${cardSizing.queueFont}, 2.3rem)`, fontWeight: 800, lineHeight: 1, color: themeStyles.emptyServingColor }}>—</span>
                <span style={{ fontSize: cardSizing.detailFont, color: themeStyles.emptyServingColor, ...ellipsis }}>
                  {w.personnel_name ? `${w.personnel_name} · Available` : 'Idle'}
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  const upcomingQueue = (
        <section style={{
          backgroundColor: themeStyles.rightSectionBg,
          borderRadius: '16px',
          border: themeStyles.rightSectionBorder,
          boxShadow: themeStyles.rightSectionShadow,
          padding: '1.25rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          overflow: 'hidden',
          minHeight: 0,
          flex: '1 1 0',
        }}>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            flex: '1 1 0',
            minHeight: 0,
          }}>
            <div style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: themeStyles.nextTitleColor,
              marginBottom: '0.75rem',
              borderBottom: themeStyles.nextTitleBorder,
              paddingBottom: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span>{t.next_numbers}</span>
              {waitingCount > 0 && (
                <span style={{ fontSize: '0.85rem', color: isLight ? '#64748b' : '#94a3b8', fontWeight: 600 }}>
                  {waitingCount} in line
                </span>
              )}
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.65rem', overflowY: 'auto', paddingRight: '4px' }}>
              {nextNumbers.length > 0 ? (
                nextNumbers.map((num, idx) => (
                  <div key={num} style={{
                    backgroundColor: themeStyles.nextItemBg,
                    border: themeStyles.nextItemBorder,
                    borderRadius: '10px',
                    padding: '0.75rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderLeft: num.startsWith('P-') ? (isLight ? '5px solid #d97706' : '5px solid var(--dole-gold)') : (isLight ? '5px solid #1e40af' : '5px solid #3b82f6'),
                  }}>
                    <span style={{ fontSize: '1rem', color: isLight ? '#64748b' : '#94a3b8', fontWeight: 600 }}>
                      #{idx + 1}
                    </span>
                    <span className="mono" style={{ fontSize: '1.85rem', fontWeight: 800, color: num.startsWith('P-') ? (isLight ? '#b45309' : 'var(--dole-gold)') : themeStyles.nextItemNumber }}>
                      {num}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', color: themeStyles.emptyServingColor, marginTop: '1.5rem', fontSize: '1.1rem' }}>
                  {t.waiting_empty}
                </div>
              )}
            </div>
          </div>

        </section>
  );

  // ARTA video: the largest 16:9 player that fits its area
  const artaVideoPanel = (
          <div style={{
            backgroundColor: '#0b1120',
            borderRadius: '14px',
            border: '1px solid rgba(217, 119, 6, 0.45)',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.5)',
            padding: '0.85rem',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.5rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              paddingBottom: '0.4rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🎥</span>
                <span style={{
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--dole-gold)',
                }}>
                  ARTA · Citizen's Charter
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <button
                  type="button"
                  onClick={() => setShowFolderModal(true)}
                  title="Configure Local Video Folder or Link for ARTA Display"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '9999px',
                    color: '#93c5fd',
                    padding: '0.15rem 0.6rem',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <span>🎬</span>
                  <span>{playlist.length > 0 ? (activeFolderName || 'Video Options') : 'Choose Video'}</span>
                </button>
                <span style={{
                  fontSize: '0.7rem',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(217, 119, 6, 0.25)',
                  color: '#fef08a',
                  fontWeight: 700,
                  border: '1px solid rgba(255, 198, 3, 0.4)',
                }}>
                  R.A. 11032
                </span>
              </div>
            </div>

            {/* Video Player: the largest 16:9 box that fits the space, centered */}
            <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              position: 'relative',
              height: '100%',
              aspectRatio: '16 / 9',
              maxWidth: '100%',
              backgroundColor: '#000000',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              {isLocalPlaylistLoading ? (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#0b1120',
                  color: '#94a3b8',
                  gap: '0.65rem',
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    border: '3px solid rgba(59, 130, 246, 0.2)',
                    borderTop: '3px solid #3b82f6',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Loading Video...</span>
                </div>
              ) : artaEmbed ? (
                artaEmbed.type === 'youtube' || artaEmbed.type === 'embed' ? (
                  <iframe
                    ref={iframeRef}
                    key={artaEmbed.url}
                    src={artaEmbed.url}
                    title="ARTA Awareness Video"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      border: 'none',
                    }}
                  />
                ) : (
                  <video
                    ref={videoRef}
                    key={artaEmbed.url}
                    src={artaEmbed.url}
                    autoPlay
                    loop={playlist.length <= 1}
                    playsInline
                    controls
                    muted={!audioUnlocked}
                    onPlay={() => {
                      isUserPausedRef.current = false;
                    }}
                    onPause={(e) => {
                      if (!e.target.ended) {
                        isUserPausedRef.current = true;
                      }
                    }}
                    onCanPlay={handleVideoCanPlay}
                    onEnded={playlist.length > 1 ? handleVideoEnded : undefined}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                    }}
                  />
                )
              ) : (
                <div
                  onClick={handleSelectFileClick}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: '1.25rem',
                    textAlign: 'center',
                    backgroundColor: '#0b1120',
                  }}
                >
                  <span style={{ fontSize: '2.5rem', marginBottom: '0.4rem' }}>🎬</span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--dole-gold)', marginBottom: '0.25rem' }}>
                    Click to Upload or Select ARTA Video
                  </span>
                  <span style={{ fontSize: '0.76rem', color: '#cbd5e1', maxWidth: '320px', lineHeight: 1.35, marginBottom: '0.75rem' }}>
                    Choose a video file (.mp4, .webm, .mov) or folder to play on this screen.
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectFileClick();
                      }}
                      style={{
                        backgroundColor: '#10b981',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.4rem 0.85rem',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      🎬 Choose File...
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectFolderClick();
                      }}
                      style={{
                        backgroundColor: '#2563eb',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.4rem 0.85rem',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      📂 Choose Folder...
                    </button>
                  </div>
                </div>
              )}
            </div>
            </div>

            <div style={{
              marginTop: '0.4rem',
              fontSize: '0.72rem',
              color: '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                {playlist.length > 1
                  ? `Video ${currentIndex + 1}/${playlist.length}: ${currentVideoItem?.name || 'Local Video'}`
                  : (currentVideoItem?.name || (artaEmbed ? "ARTA Video" : "No Video Uploaded"))}
              </span>
              <span style={{ color: artaEmbed ? '#10b981' : '#64748b', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: artaEmbed ? '#10b981' : '#475569' }} />
                {artaEmbed ? (playlist.length > 1 ? `Looping (${playlist.length})` : 'Playing') : 'Idle'}
              </span>
            </div>
          </div>
  );

  return (
    <div style={{
      height: '100vh',
      overflow: 'hidden',
      backgroundColor: themeStyles.pageBg,
      color: themeStyles.pageColor,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-ui)',
      padding: '1.5rem 2rem',
      transition: 'background-color 0.2s ease, color 0.2s ease',
    }}>
      {/* Autoplay Audio Unlock Notice */}
      {soundEnabled && !audioUnlocked && (
        <div
          onClick={async () => {
            await unlockAudioContext();
            setAudioUnlocked(true);
            const firstServing = displayData?.serving?.[0];
            announceNowServing({
              queueNo: firstServing?.queue_no || displayData?.next?.[0] || '042',
              counter: firstServing?.counter || 'Window 1',
              personnel: firstServing?.assigned_personnel || 'Officer on Duty',
              lang: langRef.current,
              bypassDedupe: true,
            });
          }}
          style={{
            backgroundColor: isLight ? '#fef3c7' : 'rgba(217, 119, 6, 0.95)',
            color: isLight ? '#92400e' : '#ffffff',
            padding: '0.65rem 1.5rem',
            borderRadius: '8px',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            boxShadow: isLight ? '0 2px 8px rgba(0, 0, 0, 0.06)' : '0 4px 15px rgba(217, 119, 6, 0.35)',
            border: isLight ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600 }}>
            <span style={{ fontSize: '1.25rem' }}>🔔</span>
            <span>Airport Chime & Voice Announcer is ON: Tap or click anywhere on this screen to activate audio playback for this display.</span>
          </div>
          <button
            className="btn btn-sm"
            style={{ backgroundColor: isLight ? '#f59e0b' : '#ffffff', color: isLight ? '#ffffff' : '#b45309', fontWeight: 800, border: 'none', minWidth: '120px' }}
          >
            Activate Sound
          </button>
        </div>
      )}

      {/* Top Banner */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `2px solid ${themeStyles.headerBorder}`,
        paddingBottom: '1.25rem',
        marginBottom: '2rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <img
            src="/dolelogo.png"
            alt="DOLE Official Seal"
            style={{ width: '76px', height: '76px', objectFit: 'contain', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.3))' }}
          />
          <div>
            <div style={{
              fontSize: '1rem',
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: themeStyles.subTitleColor,
            }}>
              Republic of the Philippines · DOLE
            </div>
            <h1 style={{ fontSize: '2.25rem', fontWeight: 900, margin: 0, letterSpacing: '-0.02em', color: themeStyles.titleColor }}>
              {displayData?.office?.name}
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Current check-in code (changes hourly): clients type it into the check-in form to prove they're here */}
          {displayData?.check_in_code && (
            <div
              aria-label={`Check-in code ${displayData.check_in_code.split('').join(' ')}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '0.4rem 1.25rem',
                marginRight: '0.75rem',
                borderRadius: '12px',
                border: isLight ? '2px solid #1e3a8a' : '2px solid var(--dole-gold)',
                backgroundColor: isLight ? '#ffffff' : 'rgba(255, 198, 3, 0.08)',
              }}
            >
              <span style={{
                fontSize: '0.85rem',
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: themeStyles.subTitleColor,
              }}>
                Check-in Code
              </span>
              <span style={{
                fontSize: '2.6rem',
                fontWeight: 900,
                lineHeight: 1.05,
                letterSpacing: '0.18em',
                fontVariantNumeric: 'tabular-nums',
                color: themeStyles.queueNoColor,
              }}>
                {displayData.check_in_code}
              </span>
            </div>
          )}

          {/* Light / Dark Mode Toggle Button */}
          <button
            onClick={toggleTheme}
            className="btn btn-outline btn-sm"
            style={{
              color: themeStyles.btnColor,
              borderColor: themeStyles.btnBorder,
              backgroundColor: isLight ? '#ffffff' : 'rgba(255, 255, 255, 0.08)',
              boxShadow: isLight ? '0 1px 3px rgba(0, 0, 0, 0.05)' : 'none',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
            title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            <span>{isLight ? '🌙' : '☀️'}</span>
            <span>{isLight ? 'Dark Mode' : 'Light Mode'}</span>
          </button>

          <button
            onClick={handleToggleSound}
            className="btn btn-outline btn-sm"
            style={{
              color: soundEnabled ? (isLight ? '#92400e' : '#ffffff') : themeStyles.btnColor,
              borderColor: soundEnabled ? (isLight ? '#d97706' : 'var(--dole-gold)') : themeStyles.btnBorder,
              backgroundColor: soundEnabled ? (isLight ? '#fef3c7' : 'rgba(217, 119, 6, 0.25)') : (isLight ? '#ffffff' : 'transparent'),
              boxShadow: isLight ? '0 1px 3px rgba(0, 0, 0, 0.05)' : 'none',
              fontWeight: 600,
            }}
            title={soundEnabled ? 'Click to mute airport chime & voice' : 'Click to enable airport announcement chime & voice'}
          >
            {soundEnabled ? '🔔 Chime & Voice ON' : '🔕 Sound OFF'}
          </button>
          {soundEnabled && (
            <button
              onClick={async () => {
                await unlockAudioContext();
                setAudioUnlocked(true);
                const firstServing = displayData?.serving?.[0];
                announceNowServing({
                  queueNo: firstServing?.queue_no || displayData?.next?.[0] || '042',
                  counter: firstServing?.counter || 'Window 1',
                  personnel: firstServing?.assigned_personnel || 'Officer on Duty',
                  lang: langRef.current,
                  bypassDedupe: true,
                });
              }}
              className="btn btn-outline btn-sm"
              style={{
                color: isLight ? '#92400e' : 'var(--dole-gold)',
                borderColor: isLight ? '#d97706' : 'rgba(217, 119, 6, 0.5)',
                backgroundColor: isLight ? '#fef3c7' : 'rgba(0, 0, 0, 0.3)',
                boxShadow: isLight ? '0 1px 3px rgba(0, 0, 0, 0.05)' : 'none',
                padding: '0.25rem 0.6rem',
                fontSize: '0.75rem',
              }}
              title="Test airport chime and voice announcement on speakers"
            >
              ▶ Test Chime & Voice
            </button>
          )}
          <button
            onClick={() => setLang(lang === 'en' ? 'fil' : 'en')}
            className="btn btn-outline btn-sm"
            style={{
              color: themeStyles.btnColor,
              borderColor: themeStyles.btnBorder,
              backgroundColor: isLight ? '#ffffff' : 'transparent',
              boxShadow: isLight ? '0 1px 3px rgba(0, 0, 0, 0.05)' : 'none',
            }}
          >
            🌐 {lang === 'en' ? 'Filipino' : 'English'}
          </button>
          <button
            onClick={toggleFullScreen}
            className="btn btn-outline btn-sm"
            style={{
              color: themeStyles.btnColor,
              borderColor: themeStyles.btnBorder,
              backgroundColor: isLight ? '#ffffff' : 'transparent',
              boxShadow: isLight ? '0 1px 3px rgba(0, 0, 0, 0.05)' : 'none',
            }}
          >
            ⛶ Fullscreen
          </button>
        </div>
      </header>

      {/* Three equal full-height columns: upcoming queue, ARTA video, now serving */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 0.65fr) minmax(0, 1.2fr) minmax(340px, 1.2fr)',
        gap: '1.5rem',
      }}>
        {upcomingQueue}
        {artaVideoPanel}
        <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, gap: '0.6rem' }}>
          {nowServingTitle}
          {windowCards}
        </section>
      </div>

      <footer style={{
        marginTop: '1.5rem',
        paddingTop: '1rem',
        borderTop: themeStyles.footerBorder,
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '0.85rem',
        color: themeStyles.footerColor,
      }}>
        <span>DOLE Client Transaction Monitoring System (CTMS)</span>
        <span>Display updates automatically every few seconds</span>
      </footer>

      {/* Hidden File Input for Single/Multiple Video File Selection */}
      <input
        ref={singleFileInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.ogg,.mov,.mkv,.avi"
        multiple
        onChange={handleSingleFilesSelected}
        style={{ display: 'none' }}
      />

      {/* Hidden File Input for Whole Local Folder Selection */}
      <input
        ref={folderFileInputRef}
        type="file"
        webkitdirectory="true"
        directory="true"
        multiple
        onChange={handleFolderFilesSelected}
        style={{ display: 'none' }}
      />

      {/* Local Video Folder Configuration Modal */}
      {showFolderModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          padding: '1rem',
        }}>
          <div style={{
            backgroundColor: '#111827',
            border: '1px solid rgba(217, 119, 6, 0.5)',
            borderRadius: '16px',
            padding: '1.75rem',
            maxWidth: '520px',
            width: '100%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
            color: '#ffffff',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--dole-gold)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>📁</span> Local Video Folder Configuration
              </h3>
              <button
                type="button"
                onClick={() => setShowFolderModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.25rem', lineHeight: 1.4 }}>
              Play videos sequentially in a continuous loop with <strong>0 server storage used</strong>.
            </p>

            {/* Option A: Select Local Video File(s) or Folder */}
            <div
              style={{
                backgroundColor: '#1e293b',
                border: '2px dashed #3b82f6',
                borderRadius: '12px',
                padding: '1.25rem 1rem',
                textAlign: 'center',
                marginBottom: '1rem',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ fontSize: '2.2rem', marginBottom: '0.25rem' }}>🎬 / 📁</div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: '#60a5fa', marginBottom: '0.25rem' }}>
                Select Video File or Folder
              </div>
              <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '0.85rem', maxWidth: '420px', margin: '0 auto 0.85rem auto', lineHeight: 1.4 }}>
                Choose a video file (.mp4, .webm, .mov) or an entire folder on this computer. Selected video will play automatically and persist across page reloads with <strong>0 server storage used</strong>.
              </div>
              <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleSelectFileClick}
                  style={{
                    backgroundColor: '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.65rem 1.15rem',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.4)',
                  }}
                >
                  <span>🎬</span> Choose Video File...
                </button>
                <button
                  type="button"
                  onClick={handleSelectFolderClick}
                  style={{
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.65rem 1.15rem',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)',
                  }}
                >
                  <span>📂</span> Choose Video Folder...
                </button>
              </div>
            </div>

            {/* Folder / File Loading Feedback Status */}
            {folderStatusMessage && (
              <div style={{
                marginBottom: '1rem',
                padding: '0.65rem 0.9rem',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 600,
                backgroundColor: folderStatusType === 'error'
                  ? 'rgba(239, 68, 68, 0.15)'
                  : (folderStatusType === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)'),
                color: folderStatusType === 'error'
                  ? '#fca5a5'
                  : (folderStatusType === 'success' ? '#6ee7b7' : '#93c5fd'),
                border: `1px solid ${folderStatusType === 'error' ? '#ef4444' : (folderStatusType === 'success' ? '#10b981' : '#3b82f6')}`,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}>
                <span>{folderStatusType === 'error' ? '⚠️' : (folderStatusType === 'success' ? '✅' : 'ℹ️')}</span>
                <span>{folderStatusMessage}</span>
              </div>
            )}

            {/* Option B: Enter Folder Link or URLs */}
            <form onSubmit={handleSaveCustomFolderLink} style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.4rem' }}>
                Or Enter Folder Link / URLs:
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={folderInputVal}
                  onChange={(e) => setFolderInputVal(e.target.value)}
                  placeholder="e.g. http://10.6.50.38/videos/ or C:\Videos or URL"
                  style={{
                    flex: 1,
                    backgroundColor: '#0b1120',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px',
                    padding: '0.6rem 0.85rem',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                  }}
                />
                <button
                  type="submit"
                  style={{
                    backgroundColor: 'var(--dole-gold)',
                    color: '#000000',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.6rem 1rem',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Play Link
                </button>
              </div>
            </form>

            {/* Footer controls: default ARTA video or Clear */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <button
                type="button"
                onClick={handleResetToDefaultVideo}
                style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Clear Active Video
              </button>
              <button
                type="button"
                onClick={() => setShowFolderModal(false)}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#cbd5e1',
                  borderRadius: '6px',
                  padding: '0.35rem 0.85rem',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
