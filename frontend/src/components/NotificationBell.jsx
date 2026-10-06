import React, { useState, useEffect, useRef, useCallback } from 'react';
import { staffApi } from '../api/staff';
import { useAuth } from '../context/AuthContext';

function playNotificationChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Friendly chime: D5 (587.33 Hz) -> A5 (880 Hz)
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (err) {
    // Audio autoplay might be blocked before first interaction
  }
}

export default function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [latestToast, setLatestToast] = useState(null);

  const seenIdsRef = useRef(new Set());
  const initialLoadRef = useRef(true);
  const dropdownRef = useRef(null);

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
          playNotificationChime();

          // Dispatch real-time event so StaffQueue automatically re-fetches
          window.dispatchEvent(new CustomEvent('ctms:new-assignment', { detail: newest }));

          // Auto-hide toast after 7 seconds
          setTimeout(() => {
            setLatestToast(curr => (curr?.id === newest.id ? null : curr));
          }, 7000);
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
    // If not already on /staff/queue, or to trigger focus
    window.dispatchEvent(new CustomEvent('ctms:new-assignment', { detail: notif }));
  };

  if (!user) return null;

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      {/* Toast Notification Banner (Floating Top Right Alert) */}
      {latestToast && (
        <div
          style={{
            position: 'fixed',
            top: '70px',
            right: '20px',
            zIndex: 99999,
            backgroundColor: '#ffffff',
            border: '2px solid var(--dole-blue)',
            borderRadius: '10px',
            boxShadow: '0 12px 30px rgba(3, 5, 186, 0.22), 0 4px 10px rgba(0, 0, 0, 0.08)',
            padding: '1rem 1.15rem',
            width: '340px',
            maxWidth: 'calc(100vw - 32px)',
            animation: 'fadeIn 0.2s ease-out',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
        >
          <div
            style={{
              fontSize: '1.4rem',
              backgroundColor: 'rgba(3, 5, 186, 0.08)',
              borderRadius: '8px',
              padding: '0.4rem',
              lineHeight: 1,
            }}
          >
            🔔
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.88rem', color: 'var(--dole-blue)' }}>
                {latestToast.title}
              </strong>
              <button
                type="button"
                onClick={() => setLatestToast(null)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  fontSize: '0.9rem',
                  padding: 0,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#1e293b', marginTop: '0.25rem', fontWeight: 600 }}>
              Queue #{latestToast.queue_no}
              {latestToast.service_name && (
                <span style={{ color: '#475569', fontWeight: 400 }}> · {latestToast.service_name}</span>
              )}
            </div>
            <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.2rem' }}>
              Assigned: {latestToast.assigned_at_formatted || 'Just now'}
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => {
                  setLatestToast(null);
                  handleNotificationClick(latestToast);
                }}
                className="btn btn-primary btn-xs"
                style={{ fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.55rem' }}
              >
                View in Queue →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bell Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'relative',
          border: '1px solid #cbd5e1',
          backgroundColor: isOpen ? '#eff6ff' : '#ffffff',
          borderRadius: '8px',
          padding: '0.42rem 0.65rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: unreadCount > 0 ? 'var(--dole-blue)' : '#475569',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.15s ease',
        }}
        title={`Notifications (${unreadCount} unread)`}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>

        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-5px',
              right: '-5px',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              fontSize: '0.68rem',
              fontWeight: 800,
              minWidth: '18px',
              height: '18px',
              borderRadius: '9px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              boxShadow: '0 2px 4px rgba(220, 38, 38, 0.35)',
              border: '2px solid #ffffff',
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
            width: '360px',
            maxWidth: 'calc(100vw - 24px)',
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #cbd5e1',
            boxShadow: '0 12px 28px -4px rgba(0, 0, 0, 0.18), 0 4px 10px rgba(0, 0, 0, 0.08)',
            zIndex: 10000,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>Notifications</strong>
              {unreadCount > 0 && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    backgroundColor: '#eff6ff',
                    color: 'var(--dole-blue)',
                    border: '1px solid #bfdbfe',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '10px',
                  }}
                >
                  {unreadCount} new
                </span>
              )}
            </div>

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
                ✓ Mark all as read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: '340px', overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.35rem' }}>🔕</div>
                No notifications yet.
                <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: '0.2rem' }}>
                  You'll be alerted when clients are assigned to your queue.
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
                      width: '8px',
                      height: '8px',
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
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          backgroundColor: 'rgba(3, 5, 186, 0.08)',
                          color: 'var(--dole-blue)',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '4px',
                        }}
                      >
                        #{notif.queue_no}
                      </span>
                      <strong style={{ fontSize: '0.84rem', color: '#0f172a' }}>
                        {notif.title}
                      </strong>
                    </div>
                    {notif.service_name && (
                      <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '0.2rem' }}>
                        Service: <strong>{notif.service_name}</strong>
                      </div>
                    )}
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.25rem' }}>
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
