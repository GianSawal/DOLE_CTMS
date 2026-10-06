import React, { useState, useEffect, useRef, useCallback } from 'react';
import { staffApi } from '../api/staff';
import { useAuth } from '../context/AuthContext';

// Shared AudioContext instance unlocked by user interaction
let sharedAudioCtx = null;

function getAudioContext() {
  if (!sharedAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      sharedAudioCtx = new AudioContextClass();
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

// Automatically unlock audio context on first user click or keypress
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('click', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
}

/**
 * High-loudness, crisp acoustic counter chime (two-tone attention chime).
 * Engineered with dual oscillators (fundamental triangle + high harmonic sine)
 * and an audio compressor to ensure maximum perceived volume without clipping.
 */
export function playNotificationChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Master volume - High gain (0.85) for loud, crystal-clear projection
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, now);
    masterGain.connect(ctx.destination);

    // Dynamics compressor to maximize loudness and prevent speaker crackle
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-14, now);
    compressor.knee.setValueAtTime(8, now);
    compressor.ratio.setValueAtTime(8, now);
    compressor.attack.setValueAtTime(0.002, now);
    compressor.release.setValueAtTime(0.25, now);
    compressor.connect(masterGain);

    // Two-tone punchy chime sequence: Note 1 (E5 659.25Hz) -> Note 2 (A5 880Hz / C6 1046.5Hz)
    const notes = [
      { time: now, freq: 659.25, dur: 0.35, vol: 0.85 },
      { time: now + 0.16, freq: 1046.5, dur: 0.70, vol: 0.95 },
    ];

    notes.forEach(({ time, freq, dur, vol }) => {
      // 1. Fundamental body tone (triangle wave for fullness and acoustic warmth)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(freq, time);

      gain1.gain.setValueAtTime(0.0001, time);
      gain1.gain.linearRampToValueAtTime(vol, time + 0.015);
      gain1.gain.exponentialRampToValueAtTime(0.0001, time + dur);

      osc1.connect(gain1);
      gain1.connect(compressor);
      osc1.start(time);
      osc1.stop(time + dur);

      // 2. High harmonic crystal overtone (sine wave 1 octave above for piercing presence)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2, time);

      gain2.gain.setValueAtTime(0.0001, time);
      gain2.gain.linearRampToValueAtTime(vol * 0.55, time + 0.012);
      gain2.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.75);

      osc2.connect(gain2);
      gain2.connect(compressor);
      osc2.start(time);
      osc2.stop(time + dur);
    });
  } catch (err) {
    // Autoplay blocked before user interaction
  }
}

export default function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [latestToast, setLatestToast] = useState(null);
  const [isRinging, setIsRinging] = useState(false);

  const seenIdsRef = useRef(new Set());
  const initialLoadRef = useRef(true);
  const dropdownRef = useRef(null);

  // Request browser desktop notification permission on user action
  const requestBrowserNotificationPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {}
      }
    }
  };

  const showDesktopNotification = (notif) => {
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`DOLE CTMS: Queue #${notif.queue_no}`, {
          body: notif.message || `New client assigned: Queue #${notif.queue_no} (${notif.service_name})`,
          icon: '/favicon.ico',
          tag: `ctms-${notif.id}`,
        });
      }
    } catch {}
  };

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const data = await staffApi.getNotifications();
      const list = Array.isArray(data?.results) ? data.results : [];
      const unread = typeof data?.unread_count === 'number' ? data.unread_count : 0;

      setNotifications(list);
      setUnreadCount(unread);

      // Detect brand new notifications arriving after initial mount
      if (initialLoadRef.current) {
        list.forEach(n => seenIdsRef.current.add(n.id));
        initialLoadRef.current = false;
      } else {
        const brandNew = list.filter(n => !seenIdsRef.current.has(n.id) && !n.is_read);
        if (brandNew.length > 0) {
          brandNew.forEach(n => seenIdsRef.current.add(n.id));
          const newest = brandNew[0];
          setLatestToast(newest);

          // Play loud, crisp chime
          playNotificationChime();

          // Trigger ringing animation on the bell icon
          setIsRinging(true);
          setTimeout(() => setIsRinging(false), 2400);

          // Show native desktop notification if allowed
          showDesktopNotification(newest);

          // Dispatch real-time event so StaffQueue automatically re-fetches and flashes
          window.dispatchEvent(new CustomEvent('ctms:new-assignment', { detail: newest }));

          // Auto-hide toast after 10 seconds
          setTimeout(() => {
            setLatestToast(curr => (curr?.id === newest.id ? null : curr));
          }, 10000);
        }
      }
    } catch {
      // Ignore network errors during poll
    }
  }, [user]);

  // Polling every 3 seconds for real-time responsiveness
  useEffect(() => {
    if (!user) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 3000);
    return () => clearInterval(interval);
  }, [fetchNotifications, user]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleMarkAllRead = async () => {
    try {
      await staffApi.markAllNotificationsRead();
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch {}
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.is_read) {
      try {
        await staffApi.markNotificationRead(notif.id);
        setUnreadCount(prev => Math.max(0, prev - 1));
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
      } catch {}
    }
    setIsOpen(false);
    window.dispatchEvent(new CustomEvent('ctms:new-assignment', { detail: notif }));
  };

  const handleBellButtonClick = () => {
    requestBrowserNotificationPermission();
    setIsOpen(!isOpen);
  };

  if (!user) return null;

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      {/* Component Styles for Animations */}
      <style>{`
        @keyframes slideInBounceAlert {
          0% {
            transform: translateY(-40px) scale(0.92);
            opacity: 0;
          }
          65% {
            transform: translateY(6px) scale(1.02);
            opacity: 1;
          }
          100% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }

        @keyframes alertGlowPulse {
          0%, 100% {
            box-shadow: 0 16px 40px rgba(3, 5, 186, 0.30), 0 0 0 0 rgba(3, 5, 186, 0.45);
          }
          50% {
            box-shadow: 0 20px 50px rgba(3, 5, 186, 0.45), 0 0 0 10px rgba(3, 5, 186, 0.15);
          }
        }

        @keyframes liveBadgeDot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.6; }
        }

        @keyframes bellRingKeyframe {
          0% { transform: rotate(0); }
          15% { transform: rotate(18deg); }
          30% { transform: rotate(-18deg); }
          45% { transform: rotate(14deg); }
          60% { transform: rotate(-14deg); }
          75% { transform: rotate(8deg); }
          100% { transform: rotate(0); }
        }

        @keyframes badgeRadarPing {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.7);
          }
          50% {
            transform: scale(1.12);
            box-shadow: 0 0 0 7px rgba(220, 38, 38, 0);
          }
        }

        @keyframes toastShimmerBar {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      {/* Floating High-Noticeability Toast Alert Banner */}
      {latestToast && (
        <div
          style={{
            position: 'fixed',
            top: '75px',
            right: '24px',
            zIndex: 999999,
            backgroundColor: '#ffffff',
            borderRadius: '14px',
            border: '2.5px solid var(--dole-blue)',
            width: '420px',
            maxWidth: 'calc(100vw - 32px)',
            animation: 'slideInBounceAlert 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275), alertGlowPulse 2.5s infinite',
            overflow: 'hidden',
          }}
        >
          {/* Animated Vibrant Top Gradient Bar */}
          <div
            style={{
              height: '5px',
              background: 'linear-gradient(90deg, #0305ba, #f59e0b, #ef4444, #0305ba)',
              backgroundSize: '200% 200%',
              animation: 'toastShimmerBar 2.5s ease infinite',
            }}
          />

          <div style={{ padding: '1.15rem 1.25rem' }}>
            {/* Header: Live Badge + Close */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                backgroundColor: 'rgba(3, 5, 186, 0.08)',
                border: '1px solid rgba(3, 5, 186, 0.25)',
                padding: '0.22rem 0.65rem',
                borderRadius: '20px',
              }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: '#dc2626',
                    display: 'inline-block',
                    animation: 'liveBadgeDot 1s infinite ease-in-out',
                  }}
                />
                <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--dole-blue)', letterSpacing: '0.04em' }}>
                  NEW CLIENT IN YOUR QUEUE
                </span>
              </div>

              <button
                type="button"
                onClick={() => setLatestToast(null)}
                style={{
                  border: 'none',
                  background: '#f1f5f9',
                  borderRadius: '50%',
                  width: '26px',
                  height: '26px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#64748b',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  transition: 'background-color 0.15s ease',
                }}
                title="Dismiss"
              >
                ✕
              </button>
            </div>

            {/* Main Content: Big Queue Badge + Details */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', marginTop: '0.35rem' }}>
              <div style={{
                backgroundColor: 'var(--dole-blue)',
                color: '#ffffff',
                borderRadius: '10px',
                padding: '0.5rem 0.85rem',
                textAlign: 'center',
                minWidth: '85px',
                boxShadow: '0 4px 12px rgba(3, 5, 186, 0.35)',
                flexShrink: 0,
              }}>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85, fontWeight: 700 }}>
                  QUEUE
                </div>
                <div className="mono" style={{ fontSize: '1.65rem', fontWeight: 900, lineHeight: 1.1 }}>
                  {latestToast.queue_no}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>
                  {latestToast.service_name || 'Assigned Client'}
                </h4>
                {latestToast.client_name && (
                  <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '0.2rem' }}>
                    Client: <strong style={{ color: '#1e293b' }}>{latestToast.client_name}</strong>
                  </div>
                )}
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span>🕒 Assigned:</span>
                  <strong>{latestToast.assigned_at_formatted || 'Just now'}</strong>
                </div>
              </div>
            </div>

            {/* Action Buttons: View in Queue + Replay Sound */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              marginTop: '1rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid #f1f5f9',
            }}>
              <button
                type="button"
                onClick={() => playNotificationChime()}
                className="btn btn-outline btn-xs"
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  color: '#475569',
                }}
                title="Replay notification chime"
              >
                <span>🔊 Replay Sound</span>
              </button>

              <div style={{ display: 'flex', gap: '0.45rem' }}>
                <button
                  type="button"
                  onClick={() => setLatestToast(null)}
                  className="btn btn-ghost btn-xs"
                  style={{ fontSize: '0.74rem', color: '#64748b' }}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLatestToast(null);
                    handleNotificationClick(latestToast);
                  }}
                  className="btn btn-primary btn-sm"
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    padding: '0.3rem 0.85rem',
                    borderRadius: '7px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <span>📢 View in Queue →</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bell Button (With Ringing Animation & Radar Pulse Badge) */}
      <button
        type="button"
        onClick={handleBellButtonClick}
        style={{
          position: 'relative',
          border: unreadCount > 0 ? '1.5px solid var(--dole-blue)' : '1px solid #cbd5e1',
          backgroundColor: isOpen ? '#eff6ff' : unreadCount > 0 ? 'rgba(3, 5, 186, 0.04)' : '#ffffff',
          borderRadius: '8px',
          padding: '0.45rem 0.68rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: unreadCount > 0 ? 'var(--dole-blue)' : '#475569',
          boxShadow: unreadCount > 0 ? '0 2px 6px rgba(3, 5, 186, 0.15)' : '0 1px 2px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.15s ease',
        }}
        title={`Notifications (${unreadCount} unread)`}
      >
        <span
          style={{
            display: 'inline-block',
            animation: isRinging ? 'bellRingKeyframe 0.6s ease 3' : 'none',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
        </span>

        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-6px',
              right: '-6px',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              fontSize: '0.70rem',
              fontWeight: 800,
              minWidth: '20px',
              height: '20px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              border: '2px solid #ffffff',
              animation: 'badgeRadarPing 2s infinite ease-in-out',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '380px',
            maxWidth: 'calc(100vw - 24px)',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #cbd5e1',
            boxShadow: '0 14px 34px -4px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.08)',
            zIndex: 10000,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '0.85rem 1rem',
              backgroundColor: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <strong style={{ fontSize: '0.92rem', color: '#0f172a' }}>Notifications</strong>
              {unreadCount > 0 && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    backgroundColor: '#eff6ff',
                    color: 'var(--dole-blue)',
                    border: '1px solid #bfdbfe',
                    padding: '0.12rem 0.45rem',
                    borderRadius: '10px',
                  }}
                >
                  {unreadCount} new
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => playNotificationChime()}
                className="btn btn-outline btn-xs"
                style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.15rem 0.45rem' }}
                title="Test sound volume"
              >
                🔊 Test Chime
              </button>

              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--dole-blue)',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  ✓ Mark read
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '2.25rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                <div style={{ fontSize: '1.75rem', marginBottom: '0.4rem' }}>🔕</div>
                No notifications yet.
                <div style={{ fontSize: '0.76rem', color: '#cbd5e1', marginTop: '0.2rem' }}>
                  You will hear a loud chime whenever a client is assigned to your queue.
                </div>
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  style={{
                    padding: '0.85rem 1rem',
                    borderBottom: '1px solid #f1f5f9',
                    backgroundColor: notif.is_read ? '#ffffff' : '#f0f9ff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    transition: 'background-color 0.12s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = notif.is_read ? '#f8fafc' : '#e0f2fe';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = notif.is_read ? '#ffffff' : '#f0f9ff';
                  }}
                >
                  <div
                    style={{
                      width: '9px',
                      height: '9px',
                      borderRadius: '50%',
                      backgroundColor: notif.is_read ? 'transparent' : 'var(--dole-blue)',
                      marginTop: '0.45rem',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span
                        className="mono"
                        style={{
                          fontSize: '0.84rem',
                          fontWeight: 800,
                          backgroundColor: 'rgba(3, 5, 186, 0.08)',
                          color: 'var(--dole-blue)',
                          padding: '0.12rem 0.45rem',
                          borderRadius: '4px',
                        }}
                      >
                        #{notif.queue_no}
                      </span>
                      <strong style={{ fontSize: '0.86rem', color: '#0f172a' }}>
                        {notif.title}
                      </strong>
                    </div>
                    {notif.service_name && (
                      <div style={{ fontSize: '0.80rem', color: '#475569', marginTop: '0.22rem' }}>
                        Service: <strong>{notif.service_name}</strong>
                      </div>
                    )}
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                      🕒 {notif.assigned_at_formatted || notif.created_at_formatted}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
