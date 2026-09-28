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
import { parseFolderLink } from '../../utils/localVideoPlaylist';

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
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('ctms_display_sound_enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [audioUnlocked, setAudioUnlocked] = useState(() => isAudioUnlocked());
  const [artaVideoUrl, setArtaVideoUrl] = useState(() => {
    try {
      const cached = localStorage.getItem(`ctms_arta_video_${officeId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.isActive !== false ? (parsed.videoUrl || '') : '';
      }
    } catch {}
    return '';
  });

  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const defaultVideoVolumeRef = useRef(0.75);
  const isDuckingRef = useRef(false);
  const duckIntervalRef = useRef(null);

  const currentVideoItem = playlist.length > 0 ? playlist[currentIndex] : null;
  const currentVideoUrl = currentVideoItem ? currentVideoItem.url : artaVideoUrl;
  const artaEmbed = parseVideoEmbedUrl(currentVideoUrl);

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
      } catch {}
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
      } catch {}
    }
  };

  // Global listener for first user interaction (touch, click, key) to unlock Web Audio API & TTS
  useEffect(() => {
    const handleUnlock = () => {
      unlockAudioContext().then(unlocked => {
        if (unlocked) {
          setAudioUnlocked(true);
          if (videoRef.current) {
            videoRef.current.muted = false;
            videoRef.current.volume = isDuckingRef.current ? 0.08 : defaultVideoVolumeRef.current;
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

  // Parse folder link or video URL whenever artaVideoUrl updates
  useEffect(() => {
    if (!artaVideoUrl) {
      setPlaylist([]);
      return;
    }

    let isMounted = true;
    async function loadVideos() {
      const ytEmbed = parseVideoEmbedUrl(artaVideoUrl);
      if (ytEmbed && ytEmbed.type === 'youtube') {
        if (isMounted) {
          setPlaylist([{ id: 0, url: ytEmbed.url, isYouTube: true }]);
          setCurrentIndex(0);
        }
        return;
      }

      const items = await parseFolderLink(artaVideoUrl);
      if (isMounted) {
        if (items && items.length > 0) {
          setPlaylist(items);
          setCurrentIndex(0);
        } else {
          setPlaylist([{ id: 0, url: artaVideoUrl, isYouTube: false }]);
          setCurrentIndex(0);
        }
      }
    }

    loadVideos();
    return () => { isMounted = false; };
  }, [artaVideoUrl]);

  // Auto-advance to next video in folder when current video finishes
  const handleVideoEnded = () => {
    if (playlist && playlist.length > 1) {
      setCurrentIndex((prev) => (prev + 1) % playlist.length);
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
      });
    }
  };

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
          // 1. latest_called_at changed (new timestamp from call, recall, or call next)
          const callTimestampChanged = Boolean(
            currentLatestCall &&
            currentLatestCall !== lastCalledRef.current
          );

          // 2. New queue number appeared in serving (e.g. from empty queue or status change)
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
              // Immediately fetch updated display data
              fetchDisplay();
            }
          }
        };

        videoBc = new BroadcastChannel('ctms_arta_video_channel');
        videoBc.onmessage = (event) => {
          if (!isMounted) return;
          if (event.data?.type === 'ARTA_VIDEO_UPDATED') {
            if (!event.data.officeId || String(event.data.officeId) === String(officeId)) {
              const newUrl = event.data.isActive !== false ? (event.data.videoUrl || '') : '';
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
          setArtaVideoUrl(item.isActive !== false ? (item.videoUrl || '') : '');
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

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ fontSize: '2rem' }}>Loading Display Board...</h1>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0a0f1d',
      color: '#ffffff',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-ui)',
      padding: '1.5rem 2rem',
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
            });
          }}
          style={{
            backgroundColor: 'rgba(217, 119, 6, 0.95)',
            color: '#ffffff',
            padding: '0.65rem 1.5rem',
            borderRadius: '8px',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            boxShadow: '0 4px 15px rgba(217, 119, 6, 0.35)',
            border: '1px solid rgba(255,255,255,0.2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600 }}>
            <span style={{ fontSize: '1.25rem' }}>🔔</span>
            <span>Airport Chime & Voice Announcer is ON: Tap or click anywhere on this screen to activate audio playback for this display.</span>
          </div>
          <button
            className="btn btn-sm"
            style={{ backgroundColor: '#ffffff', color: '#b45309', fontWeight: 800, border: 'none', minWidth: '120px' }}
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
        borderBottom: '2px solid rgba(255,255,255,0.1)',
        paddingBottom: '1.25rem',
        marginBottom: '2rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <img
            src="/dolelogo.png"
            alt="DOLE Official Seal"
            style={{ width: '76px', height: '76px', objectFit: 'contain', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.5))' }}
          />
          <div>
            <div style={{
              fontSize: '1rem',
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--dole-gold)',
            }}>
              Republic of the Philippines · DOLE
            </div>
            <h1 style={{ fontSize: '2.25rem', fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
              {displayData?.office?.name}
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={handleToggleSound}
            className="btn btn-outline btn-sm"
            style={{
              color: '#ffffff',
              borderColor: soundEnabled ? 'var(--dole-gold)' : 'rgba(255,255,255,0.2)',
              backgroundColor: soundEnabled ? 'rgba(217, 119, 6, 0.25)' : 'transparent',
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
                });
              }}
              className="btn btn-outline btn-sm"
              style={{
                color: 'var(--dole-gold)',
                borderColor: 'rgba(217, 119, 6, 0.5)',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
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
            style={{ color: '#ffffff', borderColor: 'rgba(255,255,255,0.2)' }}
          >
            🌐 {lang === 'en' ? 'Filipino' : 'English'}
          </button>
          <button
            onClick={toggleFullScreen}
            className="btn btn-outline btn-sm"
            style={{ color: '#ffffff', borderColor: 'rgba(255,255,255,0.2)' }}
          >
            ⛶ Fullscreen
          </button>
        </div>
      </header>

      {/* Main Grid: Serving Counters & Next Queue */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '2.2fr 1fr',
        gap: '2rem',
      }}>
        {/* Left Side: NOW SERVING */}
        <section style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{
            fontSize: '1.25rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--dole-gold)',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#10b981', animation: 'pulse 1.5s infinite' }} />
            {t.display_title}
          </div>

          <div style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: displayData?.serving?.length > 2 ? 'repeat(2, 1fr)' : '1fr',
            gap: '1.25rem',
          }}>
            {displayData?.serving?.length > 0 ? (
              displayData.serving.map((item, idx) => (
                <div key={idx} style={{
                  backgroundColor: '#161e31',
                  borderRadius: '16px',
                  border: '2px solid rgba(3, 5, 186, 0.6)',
                  padding: '1.75rem 1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}>
                  <div style={{
                    fontSize: '1.35rem',
                    fontWeight: 800,
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}>
                    {item.counter}
                  </div>
                  <div className="mono" style={{
                    fontSize: displayData?.serving?.length > 2 ? '4.25rem' : '5.25rem',
                    fontWeight: 900,
                    color: 'var(--dole-gold)',
                    letterSpacing: '-0.02em',
                    lineHeight: 1.1,
                    margin: '0.35rem 0',
                    textShadow: '0 0 30px rgba(255, 198, 3, 0.35)',
                  }}>
                    {item.queue_no}
                  </div>

                  {item.assigned_personnel ? (
                    <div style={{
                      marginTop: '0.4rem',
                      marginBottom: '0.65rem',
                      padding: '0.5rem 1.4rem',
                      backgroundColor: 'rgba(217, 119, 6, 0.22)',
                      border: '2px solid rgba(255, 198, 3, 0.75)',
                      borderRadius: '9999px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
                    }}>
                      <span style={{ fontSize: '1.25rem' }}>👤</span>
                      <span style={{ fontSize: '1.15rem', color: '#fef08a', fontWeight: 600 }}>
                        {t.please_look_for || (lang === 'fil' ? 'Mangyaring hanapin si' : 'Please look for')}:{' '}
                        <strong style={{ color: '#ffffff', fontWeight: 800, fontSize: '1.25rem', textDecoration: 'underline decoration-amber-400' }}>
                          {item.assigned_personnel}
                        </strong>
                      </span>
                    </div>
                  ) : null}

                  {item.service_name && (
                    <div style={{
                      marginTop: '0.65rem',
                      textAlign: 'center',
                      maxWidth: '92%',
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

        {/* Right Side: NEXT IN LINE & ARTA AWARENESS VIDEO */}
        <section style={{
          backgroundColor: '#111827',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '1.25rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          overflow: 'hidden',
        }}>
          {/* Top: Upcoming Queue (NEXT IN LINE) */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            flex: artaEmbed ? '1 1 auto' : '1',
            minHeight: 0,
            maxHeight: artaEmbed ? '320px' : 'none',
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
                    padding: '0.75rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderLeft: num.startsWith('P-') ? '5px solid var(--dole-gold)' : '5px solid #3b82f6',
                  }}>
                    <span style={{ fontSize: '1rem', color: '#94a3b8', fontWeight: 600 }}>
                      #{idx + 1}
                    </span>
                    <span className="mono" style={{ fontSize: '1.85rem', fontWeight: 800, color: num.startsWith('P-') ? 'var(--dole-gold)' : '#ffffff' }}>
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

          {/* Under Upcoming Queue: ARTA Citizen's Charter Video */}
          {artaEmbed ? (
            <div style={{
              backgroundColor: '#0b1120',
              borderRadius: '14px',
              border: '1px solid rgba(217, 119, 6, 0.45)',
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.5)',
              padding: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
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
                  <span style={{ fontSize: '1.1rem' }}>🎥</span>
                  <span style={{
                    fontSize: '0.85rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--dole-gold)',
                  }}>
                    ARTA · Citizen's Charter
                  </span>
                </div>
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
                {artaEmbed.type === 'youtube' || artaEmbed.type === 'embed' ? (
                  <iframe
                    ref={iframeRef}
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
                )}
              </div>

              <div style={{
                marginTop: '0.4rem',
                fontSize: '0.72rem',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span>Anti-Red Tape Authority awareness video</span>
                <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                  Playing
                </span>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <footer style={{
        marginTop: '1.5rem',
        paddingTop: '1rem',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '0.85rem',
        color: '#64748b',
      }}>
        <span>DOLE Client Transaction Monitoring System (CTMS)</span>
        <span>Display updates automatically every 5 seconds</span>
      </footer>
    </div>
  );
}
