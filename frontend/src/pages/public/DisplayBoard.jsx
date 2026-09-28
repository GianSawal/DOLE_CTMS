import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { publicApi } from '../../api/public';
import { translations } from '../../locales/translations';
import {
  playAirportChime,
  announceNowServing,
  getAudioContext,
  unlockAudioContext,
  isAudioUnlocked,
  CHIME_BROADCAST_CHANNEL,
  ANNOUNCEMENT_START_EVENT,
  ANNOUNCEMENT_END_EVENT,
} from '../../utils/airportChime';
import { parseVideoEmbedUrl } from '../../components/ArtaVideoModal';
import {
  savePlaylistToIndexedDB,
  loadPlaylistFromIndexedDB,
  clearPlaylistFromIndexedDB,
} from '../../utils/localVideoPlaylist';

const fallbackServiceDescriptions = {
  sena: 'Conciliation-mediation of labor issues, disputes, and worker grievances.',
  aep: 'Employment permit processing for foreign nationals.',
  tupad: 'Emergency community employment assistance for displaced workers.',
  livelihood: 'Grants and enterprise development support for self-employment.',
  dilp: 'Grants and enterprise development support for self-employment.',
  spes: 'Youth employment assistance during academic breaks.',
  '1020': 'Registration of establishments under OSH standards.',
  cshp: 'Construction safety and health program evaluation & approval.',
  inspection: 'Compliance verification for general labor standards.',
  child: 'Working child permit processing under child labor laws.',
  contractor: 'Contractor & subcontractor registration under D.O. 174.',
};

function getFallbackDesc(serviceName) {
  if (!serviceName) return '';
  const s = serviceName.toLowerCase();
  for (const [key, desc] of Object.entries(fallbackServiceDescriptions)) {
    if (s.includes(key)) return desc;
  }
  return 'Frontline public service, inquiry assistance, and document processing.';
}

export default function DisplayBoard() {
  const { officeId } = useParams();
  const [lang, setLang] = useState('en');
  const t = translations[lang];
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const [displayData, setDisplayData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Audio chime & speech enabled state
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('ctms_display_sound_enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [audioUnlocked, setAudioUnlocked] = useState(() => isAudioUnlocked());

  // Server-configured video URL (YouTube, MP4)
  const [artaVideoUrl, setArtaVideoUrl] = useState(() => {
    try {
      const cached = localStorage.getItem(`ctms_arta_video_${officeId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.isActive !== false ? (parsed.videoUrl || parsed.url || '') : '';
      }
    } catch {}
    return '';
  });

  // Local folder video playlist state (0 server storage, plays completely locally)
  const [localPlaylist, setLocalPlaylist] = useState([]);
  const [currentPlaylistIndex, setCurrentPlaylistIndex] = useState(0);
  const folderInputRef = useRef(null);
  const filesInputRef = useRef(null);

  // Video element and audio ducking state
  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const [videoVolume, setVideoVolume] = useState(() => {
    const saved = localStorage.getItem('ctms_tv_video_volume');
    return saved !== null ? parseFloat(saved) : 0.7;
  });
  const [videoMuted, setVideoMuted] = useState(() => {
    const saved = localStorage.getItem('ctms_tv_video_muted');
    return saved !== null ? saved === 'true' : false;
  });
  const [isDucking, setIsDucking] = useState(false);
  const duckIntervalRef = useRef(null);

  const prevServingRef = useRef([]);
  const lastCalledRef = useRef(null);
  const isInitialLoadRef = useRef(true);

  // Smooth audio ducking: tone down video volume during announcements
  const handleDuckStart = () => {
    setIsDucking(true);

    // If HTML5 video is playing
    if (videoRef.current) {
      if (duckIntervalRef.current) clearInterval(duckIntervalRef.current);
      const target = 0.08; // Faint background murmur
      const current = videoRef.current.volume;
      const step = Math.max(0.02, (current - target) / 4);
      let count = 0;
      duckIntervalRef.current = setInterval(() => {
        count++;
        if (!videoRef.current) {
          clearInterval(duckIntervalRef.current);
          return;
        }
        if (count >= 5 || videoRef.current.volume <= target + 0.03) {
          videoRef.current.volume = target;
          clearInterval(duckIntervalRef.current);
        } else {
          videoRef.current.volume = Math.max(target, videoRef.current.volume - step);
        }
      }, 20);
    }

    // If YouTube iframe is playing, send postMessage setVolume command
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setVolume', args: [8] }),
          '*'
        );
      } catch {}
    }
  };

  // Restore video volume after announcement concludes
  const handleDuckEnd = () => {
    setIsDucking(false);

    if (videoRef.current) {
      if (duckIntervalRef.current) clearInterval(duckIntervalRef.current);
      const target = videoMuted ? 0 : videoVolume;
      const current = videoRef.current.volume;
      const step = Math.max(0.02, (target - current) / 6);
      let count = 0;
      duckIntervalRef.current = setInterval(() => {
        count++;
        if (!videoRef.current) {
          clearInterval(duckIntervalRef.current);
          return;
        }
        if (count >= 7 || videoRef.current.volume >= target - 0.03) {
          videoRef.current.volume = target;
          clearInterval(duckIntervalRef.current);
        } else {
          videoRef.current.volume = Math.min(target, videoRef.current.volume + step);
        }
      }, 25);
    }

    // Restore YouTube iframe volume
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'setVolume', args: [videoMuted ? 0 : Math.round(videoVolume * 100)] }),
          '*'
        );
      } catch {}
    }
  };

  // Global listener for first user interaction (touch, click, key) to unlock Web Audio API & TTS
  useEffect(() => {
    const handleUnlock = () => {
      unlockAudioContext().then(unlocked => {
        if (unlocked) {
          setAudioUnlocked(true);
          if (videoRef.current && !videoMuted) {
            videoRef.current.muted = false;
            videoRef.current.volume = isDucking ? 0.08 : videoVolume;
            videoRef.current.play().catch(() => {});
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
  }, [videoMuted, videoVolume, isDucking]);

  // Audio ducking lifecycle event listeners + Load saved local playlist
  useEffect(() => {
    window.addEventListener(ANNOUNCEMENT_START_EVENT, handleDuckStart);
    window.addEventListener(ANNOUNCEMENT_END_EVENT, handleDuckEnd);

    // Load any existing local folder video playlist from IndexedDB
    loadPlaylistFromIndexedDB().then((items) => {
      if (items && items.length > 0) {
        setLocalPlaylist(items);
        setCurrentPlaylistIndex(0);
      }
    });

    return () => {
      window.removeEventListener(ANNOUNCEMENT_START_EVENT, handleDuckStart);
      window.removeEventListener(ANNOUNCEMENT_END_EVENT, handleDuckEnd);
      if (duckIntervalRef.current) clearInterval(duckIntervalRef.current);
    };
  }, [videoVolume, videoMuted]);

  // Sync volume to video element whenever volume or mute state changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = videoMuted;
      videoRef.current.volume = isDucking ? 0.08 : (videoMuted ? 0 : videoVolume);
    }
  }, [videoVolume, videoMuted, isDucking]);

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
      });
    }
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVideoVolume(val);
    localStorage.setItem('ctms_tv_video_volume', String(val));
    if (val > 0 && videoMuted) {
      setVideoMuted(false);
      localStorage.setItem('ctms_tv_video_muted', 'false');
    }
    if (videoRef.current && !isDucking) {
      videoRef.current.volume = val;
    }
  };

  const handleToggleVideoMute = () => {
    const next = !videoMuted;
    setVideoMuted(next);
    localStorage.setItem('ctms_tv_video_muted', String(next));
    if (videoRef.current) {
      videoRef.current.muted = next;
      if (!next && !isDucking) {
        videoRef.current.volume = videoVolume;
      }
    }
  };

  // Local Folder Playlist Navigation & Event Handlers
  const handleVideoEnded = () => {
    if (localPlaylist && localPlaylist.length > 0) {
      // Auto-advance to next video in folder; loops back when reaching the end!
      setCurrentPlaylistIndex((prev) => (prev + 1) % localPlaylist.length);
    }
  };

  const handleNextVideo = () => {
    if (localPlaylist && localPlaylist.length > 0) {
      setCurrentPlaylistIndex((prev) => (prev + 1) % localPlaylist.length);
    }
  };

  const handlePrevVideo = () => {
    if (localPlaylist && localPlaylist.length > 0) {
      setCurrentPlaylistIndex((prev) => (prev - 1 + localPlaylist.length) % localPlaylist.length);
    }
  };

  const handleFolderSelect = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    const items = await savePlaylistToIndexedDB(files);
    if (items && items.length > 0) {
      setLocalPlaylist(items);
      setCurrentPlaylistIndex(0);
    }
  };

  const handleFilesSelect = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    const items = await savePlaylistToIndexedDB(files);
    if (items && items.length > 0) {
      setLocalPlaylist(items);
      setCurrentPlaylistIndex(0);
    }
  };

  const handleClearLocalPlaylist = async () => {
    await clearPlaylistFromIndexedDB();
    setLocalPlaylist([]);
    setCurrentPlaylistIndex(0);
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (filesInputRef.current) filesInputRef.current.value = '';
  };

  // Polling & BroadcastChannel sync
  useEffect(() => {
    let isMounted = true;

    async function fetchDisplay() {
      try {
        const data = await publicApi.getDisplayBoard(officeId);
        if (!isMounted) return;

        const currentLatestCall = data.latest_called_at || (data.serving?.[0]?.called_at) || null;

        if (isInitialLoadRef.current) {
          // Record baseline timestamp on initial mount without chiming
          lastCalledRef.current = currentLatestCall;
          prevServingRef.current = data.serving || [];
          isInitialLoadRef.current = false;
        } else {
          // Detect call, recall, or call-next:
          const callTimestampChanged = Boolean(
            currentLatestCall &&
            currentLatestCall !== lastCalledRef.current
          );

          // New queue number appeared in serving
          const prevNumbers = (prevServingRef.current || []).map(s => s.queue_no);
          const hasNewQueueNumber = data.serving?.some(s => !prevNumbers.includes(s.queue_no));

          if (callTimestampChanged || hasNewQueueNumber) {
            lastCalledRef.current = currentLatestCall;
            if (soundEnabled) {
              const qNo = data.latest_called_queue_no || data.serving?.[0]?.queue_no;
              const cnt = data.latest_called_counter || data.serving?.[0]?.counter;
              const psn = data.latest_called_personnel || data.serving?.[0]?.assigned_personnel;
              announceNowServing({
                queueNo: qNo,
                counter: cnt,
                personnel: psn,
                lang: langRef.current,
              });
            }
          }
          prevServingRef.current = data.serving || [];
        }

        if (data.arta_video_url !== undefined) {
          setArtaVideoUrl(data.arta_video_url || '');
        }
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
            if (!event.data.officeId || String(event.data.officeId) === String(officeId)) {
              if (soundEnabled) {
                announceNowServing({
                  queueNo: event.data.queueNo,
                  counter: event.data.counter,
                  personnel: event.data.personnel,
                  lang: langRef.current,
                });
              }
              fetchDisplay();
            }
          }
        };

        videoBc = new BroadcastChannel('ctms_arta_video_channel');
        videoBc.onmessage = (event) => {
          if (!isMounted) return;
          if (event.data?.type === 'ARTA_VIDEO_UPDATED') {
            if (!event.data.officeId || String(event.data.officeId) === String(officeId)) {
              const newUrl = event.data.is_active !== false ? (event.data.url || '') : '';
              setArtaVideoUrl(newUrl);
              fetchDisplay();
            }
          }
        };
      }
    } catch {}

    // Storage fallback for cross-tab sync
    const handleStorage = (e) => {
      if (!isMounted) return;
      if (e.key === 'dole_last_queue_call' && e.newValue) {
        try {
          const item = JSON.parse(e.newValue);
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
        } catch {}
      } else if (e.key === `ctms_arta_video_${officeId}` && e.newValue) {
        try {
          const item = JSON.parse(e.newValue);
          setArtaVideoUrl(item.is_active !== false ? (item.url || '') : '');
          fetchDisplay();
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      isMounted = false;
      clearInterval(interval);
      if (bc) {
        try { bc.close(); } catch {}
      }
      if (videoBc) {
        try { videoBc.close(); } catch {}
      }
      window.removeEventListener('storage', handleStorage);
    };
  }, [officeId, soundEnabled]);

  // Video source determination:
  // 1. Local folder playlist takes priority (plays 100% locally with 0 server storage used)
  // 2. Server ARTA video URL / uploaded file
  const hasLocalPlaylist = localPlaylist && localPlaylist.length > 0;
  const currentLocalVideo = hasLocalPlaylist ? localPlaylist[currentPlaylistIndex] : null;
  const artaEmbed = parseVideoEmbedUrl(artaVideoUrl);

  const hasAnyVideo = Boolean(hasLocalPlaylist || artaEmbed);

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0a0f1d',
      color: '#ffffff',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      padding: '1.25rem 2rem',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      boxSizing: 'border-box',
    }}>
      {/* Hidden Folder & Multi-File Inputs for Local Video Playlist */}
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory="true"
        directory="true"
        multiple
        onChange={handleFolderSelect}
        style={{ display: 'none' }}
      />
      <input
        ref={filesInputRef}
        type="file"
        accept="video/mp4,video/webm,video/ogg,video/quicktime,video/*"
        multiple
        onChange={handleFilesSelect}
        style={{ display: 'none' }}
      />

      {/* Top Header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '2px solid rgba(255, 255, 255, 0.1)',
        paddingBottom: '1rem',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        gap: '1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{
            width: '60px',
            height: '60px',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 900,
            color: 'var(--dole-blue)',
            fontSize: '1.5rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}>
            DOLE
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
              {displayData?.office?.name || 'Department of Labor and Employment'}
            </h1>
            <div style={{ color: '#94a3b8', fontSize: '0.95rem', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span>Client Transaction Monitoring & Public Queue Display</span>
              <span style={{ color: '#38bdf8' }}>&bull;</span>
              <span>{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Audio Chime & Speech Announcer Status Toggle */}
          <button
            onClick={handleToggleSound}
            className="btn btn-outline"
            title={soundEnabled ? 'Queue chime and voice calling is active' : 'Audio calling is muted'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: soundEnabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              borderColor: soundEnabled ? '#10b981' : '#ef4444',
              color: soundEnabled ? '#34d399' : '#f87171',
              padding: '0.5rem 1rem',
              fontSize: '0.9rem',
              borderRadius: '9999px',
              minHeight: '40px',
            }}
          >
            <span>{soundEnabled ? '🔔' : '🔕'}</span>
            <span style={{ fontWeight: 600 }}>{soundEnabled ? 'Chime Active' : 'Chime Off'}</span>
          </button>

          {/* Language Switcher */}
          <div style={{ display: 'flex', backgroundColor: '#1e293b', borderRadius: '8px', padding: '3px' }}>
            <button
              onClick={() => setLang('en')}
              style={{
                background: lang === 'en' ? 'var(--dole-blue)' : 'transparent',
                color: '#ffffff',
                border: 'none',
                padding: '0.35rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: lang === 'en' ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              EN
            </button>
            <button
              onClick={() => setLang('fil')}
              style={{
                background: lang === 'fil' ? 'var(--dole-blue)' : 'transparent',
                color: '#ffffff',
                border: 'none',
                padding: '0.35rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: lang === 'fil' ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              FIL
            </button>
          </div>
        </div>
      </header>

      {/* Main Grid: NOW SERVING (Left 65%) vs UPCOMING QUEUE & ARTA VIDEO (Right 35%) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.85fr) minmax(360px, 1.15fr)',
        gap: '1.5rem',
        flex: 1,
        minHeight: 0,
      }}>
        {/* Left Side: NOW SERVING COUNTERS */}
        <section style={{
          backgroundColor: '#111827',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '1.25rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>
          <div style={{
            fontSize: '1.4rem',
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--dole-gold)',
            marginBottom: '1rem',
            borderBottom: '2px solid rgba(255, 198, 3, 0.3)',
            paddingBottom: '0.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span>{t.now_serving}</span>
            <span style={{ fontSize: '0.9rem', color: '#94a3b8', fontWeight: 600 }}>
              {displayData?.serving?.length || 0} active counters
            </span>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: displayData?.serving?.length > 2 ? 'repeat(2, 1fr)' : '1fr',
            gap: '1rem',
            flex: 1,
            overflowY: 'auto',
          }}>
            {displayData?.serving?.length > 0 ? (
              displayData.serving.map((item, idx) => (
                <div key={idx} style={{
                  backgroundColor: '#1e293b',
                  borderRadius: '14px',
                  border: '2px solid #3b82f6',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{
                      fontSize: '1.3rem',
                      fontWeight: 800,
                      color: '#60a5fa',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      {item.counter}
                    </span>
                    {item.is_priority && (
                      <span style={{
                        backgroundColor: 'var(--dole-gold)',
                        color: '#000000',
                        fontSize: '0.8rem',
                        fontWeight: 900,
                        padding: '0.2rem 0.6rem',
                        borderRadius: '9999px',
                        letterSpacing: '0.05em',
                      }}>
                        PRIORITY
                      </span>
                    )}
                  </div>

                  <div style={{ textAlign: 'center', margin: '0.75rem 0' }}>
                    <div className="mono" style={{
                      fontSize: '4.2rem',
                      fontWeight: 900,
                      color: item.is_priority ? 'var(--dole-gold)' : '#ffffff',
                      lineHeight: 1,
                      letterSpacing: '0.04em',
                      textShadow: item.is_priority ? '0 0 20px rgba(255, 198, 3, 0.4)' : '0 0 20px rgba(59, 130, 246, 0.4)',
                    }}>
                      {item.queue_no}
                    </div>
                  </div>

                  {item.assigned_personnel && (
                    <div style={{
                      backgroundColor: 'rgba(59, 130, 246, 0.12)',
                      border: '1px solid rgba(59, 130, 246, 0.25)',
                      borderRadius: '8px',
                      padding: '0.5rem 0.75rem',
                      marginBottom: '0.65rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                    }}>
                      <span style={{ fontSize: '1rem' }}>👤</span>
                      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#93c5fd' }}>
                        Officer: <strong>{item.assigned_personnel}</strong>
                      </span>
                    </div>
                  )}

                  {item.service_name && (
                    <div style={{
                      padding: '0.6rem 1rem',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}>
                      <div style={{
                        fontSize: '1.1rem',
                        fontWeight: 700,
                        color: '#f8fafc',
                        letterSpacing: '-0.01em',
                        marginBottom: '0.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                      }}>
                        <span style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: '#3b82f6',
                          flexShrink: 0,
                        }} />
                        <span>{item.service_name}</span>
                      </div>
                      <div style={{
                        fontSize: '0.85rem',
                        color: '#94a3b8',
                        lineHeight: 1.35,
                        fontWeight: 400,
                      }}>
                        {item.service_description || getFallbackDesc(item.service_name)}
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div style={{
                gridColumn: '1 / -1',
                backgroundColor: '#161e31',
                borderRadius: '16px',
                border: '1px dashed rgba(255,255,255,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b',
                fontSize: '1.5rem',
                fontWeight: 600,
              }}>
                {t.no_active_serving}
              </div>
            )}
          </div>
        </section>

        {/* Right Side: NEXT IN LINE & VIDEO PLAYER */}
        <section style={{
          backgroundColor: '#111827',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '1.25rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          overflow: 'hidden',
        }}>
          {/* Top: Upcoming Queue (NEXT IN LINE) */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            flex: hasAnyVideo ? '1 1 auto' : '1',
            minHeight: 0,
            maxHeight: hasAnyVideo ? '280px' : 'none',
          }}>
            <div style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#93c5fd',
              marginBottom: '0.75rem',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              paddingBottom: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span>{t.next_numbers}</span>
              {displayData?.next?.length > 0 && (
                <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>
                  {displayData.next.length} in line
                </span>
              )}
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.65rem', overflowY: 'auto', paddingRight: '4px' }}>
              {displayData?.next?.length > 0 ? (
                displayData.next.map((num, idx) => (
                  <div key={idx} style={{
                    backgroundColor: '#1e293b',
                    borderRadius: '10px',
                    padding: '0.65rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderLeft: num.startsWith('P-') ? '5px solid var(--dole-gold)' : '5px solid #3b82f6',
                  }}>
                    <span style={{ fontSize: '0.95rem', color: '#94a3b8', fontWeight: 600 }}>
                      #{idx + 1}
                    </span>
                    <span className="mono" style={{ fontSize: '1.75rem', fontWeight: 800, color: num.startsWith('P-') ? 'var(--dole-gold)' : '#ffffff' }}>
                      {num}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', color: '#64748b', marginTop: '1.5rem', fontSize: '1.1rem' }}>
                  {t.waiting_empty}
                </div>
              )}
            </div>
          </div>

          {/* Video Section: Supports Local Folder Playlist (0 Server Storage) + Server Video + Audio Ducking */}
          <div style={{
            backgroundColor: '#0b1120',
            borderRadius: '14px',
            border: isDucking ? '1px solid #38bdf8' : '1px solid rgba(217, 119, 6, 0.45)',
            boxShadow: isDucking ? '0 0 15px rgba(56, 189, 248, 0.3)' : '0 6px 20px rgba(0, 0, 0, 0.5)',
            padding: '0.85rem',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            transition: 'border 0.2s ease, box-shadow 0.2s ease',
          }}>
            {/* Video Header: Title + Playlist Tag + Controls */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.45rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              paddingBottom: '0.4rem',
              gap: '0.5rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', overflow: 'hidden' }}>
                <span style={{ fontSize: '1.1rem' }}>🎥</span>
                <span style={{
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--dole-gold)',
                  whiteSpace: 'nowrap',
                }}>
                  ARTA · Citizen's Charter
                </span>
                {hasLocalPlaylist && (
                  <span style={{
                    fontSize: '0.68rem',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '9999px',
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    color: '#6ee7b7',
                    fontWeight: 700,
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    whiteSpace: 'nowrap',
                  }}>
                    📂 Local Folder ({currentPlaylistIndex + 1}/{localPlaylist.length})
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                {/* Folder Selector Button */}
                <button
                  type="button"
                  onClick={() => folderInputRef.current && folderInputRef.current.click()}
                  title="Select a local folder of videos to loop continuously (0 server storage used)"
                  style={{
                    backgroundColor: hasLocalPlaylist ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#ffffff',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '0.2rem 0.55rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <span>📁</span>
                  <span>{hasLocalPlaylist ? 'Change Folder' : 'Load Local Folder'}</span>
                </button>

                {hasLocalPlaylist && (
                  <button
                    type="button"
                    onClick={handleClearLocalPlaylist}
                    title="Clear local playlist and revert to default"
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#fca5a5',
                      fontSize: '0.72rem',
                      padding: '0.2rem 0.45rem',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Audio Ducking Notice Banner (Visible while client is being announced) */}
            {isDucking && (
              <div style={{
                backgroundColor: 'rgba(14, 165, 233, 0.2)',
                border: '1px solid #38bdf8',
                borderRadius: '6px',
                padding: '0.3rem 0.6rem',
                marginBottom: '0.45rem',
                fontSize: '0.74rem',
                color: '#bae6fd',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                animation: 'pulse 1.5s infinite',
                fontWeight: 600,
              }}>
                <span>🔉</span>
                <span>Video sound toned down — Client announcement in progress...</span>
              </div>
            )}

            {/* Video Player 16:9 */}
            <div style={{
              position: 'relative',
              width: '100%',
              paddingTop: '56.25%',
              backgroundColor: '#000000',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              {hasLocalPlaylist ? (
                <video
                  ref={videoRef}
                  key={currentLocalVideo?.url}
                  src={currentLocalVideo?.url}
                  autoPlay
                  playsInline
                  controls
                  onEnded={handleVideoEnded}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                />
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
                    loop
                    playsInline
                    controls
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
                  padding: '1rem',
                  textAlign: 'center',
                  color: '#64748b',
                }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>📁</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.35rem' }}>
                    Play Local Folder of Videos (0 Server Storage)
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', maxWidth: '320px', marginBottom: '0.75rem' }}>
                    Select a folder of MP4 videos on this PC. Videos will auto-advance and loop continuously without using network bandwidth!
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => folderInputRef.current && folderInputRef.current.click()}
                      className="btn btn-primary btn-sm"
                      style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
                    >
                      📂 Select Folder
                    </button>
                    <button
                      type="button"
                      onClick={() => filesInputRef.current && filesInputRef.current.click()}
                      className="btn btn-outline btn-sm"
                      style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
                    >
                      🎞️ Select Videos
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Video Footer: Playlist File Name + Volume Ducking Controls */}
            <div style={{
              marginTop: '0.45rem',
              fontSize: '0.74rem',
              color: '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}>
              {/* Left: Current Track info or Playlist Prev/Next */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', overflow: 'hidden' }}>
                {hasLocalPlaylist ? (
                  <>
                    <button
                      type="button"
                      onClick={handlePrevVideo}
                      title="Previous video"
                      style={{
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: '#ffffff',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        padding: '0.1rem 0.4rem',
                        fontSize: '0.72rem',
                      }}
                    >
                      ⏮
                    </button>
                    <button
                      type="button"
                      onClick={handleNextVideo}
                      title="Next video"
                      style={{
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: '#ffffff',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        padding: '0.1rem 0.4rem',
                        fontSize: '0.72rem',
                      }}
                    >
                      ⏭
                    </button>
                    <span style={{
                      color: '#f8fafc',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '180px',
                    }}>
                      {currentLocalVideo?.name}
                    </span>
                  </>
                ) : (
                  <span>Anti-Red Tape Authority awareness video</span>
                )}
              </div>

              {/* Right: Audio Volume Slider & Mute Toggle with Ducking Indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={handleToggleVideoMute}
                  title={videoMuted ? 'Unmute video' : 'Mute video'}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: videoMuted ? '#f87171' : '#38bdf8',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    padding: 0,
                  }}
                >
                  {videoMuted ? '🔇' : (isDucking ? '🔉' : '🔊')}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={videoMuted ? 0 : videoVolume}
                  onChange={handleVolumeChange}
                  title={`Video Volume: ${Math.round((videoMuted ? 0 : videoVolume) * 100)}%`}
                  style={{
                    width: '65px',
                    height: '4px',
                    cursor: 'pointer',
                    accentColor: isDucking ? '#38bdf8' : '#eab308',
                  }}
                />
                <span style={{ fontSize: '0.7rem', color: isDucking ? '#38bdf8' : '#94a3b8', minWidth: '32px' }}>
                  {isDucking ? '8%' : `${Math.round((videoMuted ? 0 : videoVolume) * 100)}%`}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer style={{
        marginTop: '1.25rem',
        paddingTop: '0.85rem',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '0.82rem',
        color: '#64748b',
      }}>
        <span>DOLE Client Transaction Monitoring System (CTMS)</span>
        <span>Display updates automatically &bull; Auto Audio Ducking Active</span>
      </footer>
    </div>
  );
}
