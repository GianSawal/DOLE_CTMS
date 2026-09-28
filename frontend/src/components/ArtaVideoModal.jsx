import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import { staffApi } from '../api/staff';
import { useAuth } from '../context/AuthContext';

// Helper to convert any YouTube URL (standard, shortened, shorts, or embed) into an embeddable URL
export function parseVideoEmbedUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Match YouTube URLs
  const ytMatch = trimmed.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/i);
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1];
    return {
      type: 'youtube',
      url: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&controls=1&modestbranding=1&rel=0`,
      raw: trimmed,
      videoId,
    };
  }

  // Check if it's already an embed URL or iframe src
  if (trimmed.includes('/embed/')) {
    return {
      type: 'embed',
      url: trimmed,
      raw: trimmed,
    };
  }

  // Direct video file (.mp4, .webm, .ogg)
  if (/\.(mp4|webm|ogg)($|\?)/i.test(trimmed)) {
    return {
      type: 'direct',
      url: trimmed,
      raw: trimmed,
    };
  }

  // Default fallback to direct URL
  return {
    type: 'direct',
    url: trimmed,
    raw: trimmed,
  };
}

export default function ArtaVideoModal({ isOpen, onClose, defaultOfficeId }) {
  const { user } = useAuth();
  const [selectedOfficeId, setSelectedOfficeId] = useState(defaultOfficeId || '');
  const [videoUrl, setVideoUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Preset official ARTA and DOLE videos for convenient quick-fill
  const presets = [
    {
      label: 'ARTA Citizen’s Charter (RA 11032 Explainer)',
      url: 'https://www.youtube.com/watch?v=7uK7f0E4g2w',
    },
    {
      label: 'DOLE Ease of Doing Business & Public Service Standards',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    },
  ];

  // Set initial selected office from user's assigned offices
  useEffect(() => {
    if (defaultOfficeId) {
      setSelectedOfficeId(String(defaultOfficeId));
    } else if (user?.assigned_offices?.length > 0 && !selectedOfficeId) {
      setSelectedOfficeId(String(user.assigned_offices[0].id));
    }
  }, [defaultOfficeId, user, selectedOfficeId]);

  // Load existing ARTA video configuration for selected office
  useEffect(() => {
    if (!isOpen || !selectedOfficeId) return;

    let isMounted = true;
    setLoading(true);
    setMessage('');
    setError('');

    async function loadConfig() {
      try {
        const res = await staffApi.getDisplayVideo(selectedOfficeId);
        if (!isMounted) return;
        setVideoUrl(res.arta_video_url || '');
        setIsActive(res.is_active !== undefined ? res.is_active : true);
      } catch (err) {
        // Fallback to local storage if API is not yet loaded
        const cached = localStorage.getItem(`ctms_arta_video_${selectedOfficeId}`);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            setVideoUrl(parsed.url || '');
            setIsActive(parsed.is_active !== false);
          } catch {}
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadConfig();

    return () => {
      isMounted = false;
    };
  }, [isOpen, selectedOfficeId]);

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    if (!selectedOfficeId) {
      setError('Please select an office.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await staffApi.updateDisplayVideo(selectedOfficeId, videoUrl.trim(), isActive);

      // Cache locally and broadcast to open display tabs immediately
      const payload = {
        officeId: selectedOfficeId,
        url: videoUrl.trim(),
        is_active: isActive,
        updated_at: new Date().toISOString(),
      };
      localStorage.setItem(`ctms_arta_video_${selectedOfficeId}`, JSON.stringify(payload));
      localStorage.setItem('dole_last_arta_video_update', JSON.stringify(payload));

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('ctms_arta_video_channel');
          bc.postMessage({ type: 'ARTA_VIDEO_UPDATED', ...payload });
          bc.close();
        }
      } catch {}

      setMessage('ARTA video configuration saved successfully! It is now playing on the TV display board.');
    } catch (err) {
      setError(err.message || 'Failed to save ARTA video configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setVideoUrl('');
    setSaving(true);
    setError('');
    setMessage('');

    try {
      await staffApi.updateDisplayVideo(selectedOfficeId, '', false);
      localStorage.removeItem(`ctms_arta_video_${selectedOfficeId}`);
      localStorage.setItem('dole_last_arta_video_update', JSON.stringify({
        officeId: selectedOfficeId,
        url: '',
        is_active: false,
        updated_at: new Date().toISOString(),
      }));

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('ctms_arta_video_channel');
          bc.postMessage({ type: 'ARTA_VIDEO_UPDATED', officeId: selectedOfficeId, url: '', is_active: false });
          bc.close();
        }
      } catch {}

      setMessage('Video removed from TV display.');
    } catch (err) {
      setError(err.message || 'Failed to clear video.');
    } finally {
      setSaving(false);
    }
  };

  const parsed = parseVideoEmbedUrl(videoUrl);
  const displayUrl = selectedOfficeId ? `/display/office/${selectedOfficeId}` : '';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="🎥 Configure ARTA Video for TV Display">
      <div style={{ maxHeight: '78vh', overflowY: 'auto', paddingRight: '0.25rem' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1.25rem 0', lineHeight: 1.4 }}>
          Add an Anti-Red Tape Authority (ARTA) or Citizen's Charter awareness video under <strong>Republic Act No. 11032</strong>.
          The video loops continuously on the office TV display directly below the upcoming queue list.
        </p>

        {message && (
          <div style={{
            backgroundColor: '#ecfdf5',
            color: '#065f46',
            border: '1px solid #a7f3d0',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            fontSize: '0.88rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}>
            <span>✓ {message}</span>
            {displayUrl && (
              <a
                href={displayUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#047857', fontWeight: 700, textDecoration: 'underline', fontSize: '0.82rem' }}
              >
                ↗ View TV
              </a>
            )}
          </div>
        )}

        {error && (
          <div style={{
            backgroundColor: '#fef2f2',
            color: '#b91c1c',
            border: '1px solid #fecaca',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            fontSize: '0.88rem',
            fontWeight: 600,
          }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Office Selection */}
          {user?.assigned_offices?.length > 1 ? (
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                Target Office Display:
              </label>
              <select
                value={selectedOfficeId}
                onChange={(e) => setSelectedOfficeId(e.target.value)}
                style={{ width: '100%', minHeight: '42px', padding: '0.5rem' }}
              >
                {user.assigned_offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.code})
                  </option>
                ))}
              </select>
            </div>
          ) : user?.assigned_offices?.length === 1 ? (
            <div style={{
              backgroundColor: 'rgba(3, 5, 186, 0.05)',
              border: '1px solid rgba(3, 5, 186, 0.15)',
              borderRadius: 'var(--radius-md)',
              padding: '0.65rem 0.85rem',
              fontSize: '0.85rem',
              color: 'var(--dole-blue)',
              fontWeight: 600,
            }}>
              🏢 Target Office: <strong>{user.assigned_offices[0].name} ({user.assigned_offices[0].code})</strong>
            </div>
          ) : null}

          {/* Video URL Input */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <label htmlFor="arta-video-url" style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                Video URL (YouTube or MP4):
              </label>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                YouTube, Shorts, or direct video link
              </span>
            </div>
            <input
              id="arta-video-url"
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="e.g. https://www.youtube.com/watch?v=... or https://example.com/video.mp4"
              className="form-control"
              style={{ width: '100%', minHeight: '44px', padding: '0.5rem 0.75rem' }}
            />
          </div>

          {/* Quick Preset Buttons */}
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.35rem' }}>
              Quick Presets:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={() => setVideoUrl('https://www.youtube.com/watch?v=7uK7f0E4g2w')}
                className="btn btn-outline btn-sm"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', minHeight: '30px' }}
              >
                📌 ARTA RA 11032 Citizen's Charter
              </button>
              <button
                type="button"
                onClick={() => setVideoUrl('https://www.youtube.com/watch?v=2e6i5GjD4iY')}
                className="btn btn-outline btn-sm"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', minHeight: '30px' }}
              >
                📌 DOLE Anti-Fixer & Integrity
              </button>
            </div>
          </div>

          {/* Active Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
            <input
              id="arta-is-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <label htmlFor="arta-is-active" style={{ fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' }}>
              Active on TV Display (uncheck to pause without deleting URL)
            </label>
          </div>

          {/* Live Video Preview */}
          <div style={{
            backgroundColor: '#0f172a',
            borderRadius: '12px',
            padding: '0.75rem',
            border: '1px solid #334155',
            marginTop: '0.25rem',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.5rem',
              color: '#94a3b8',
              fontSize: '0.78rem',
              fontWeight: 700,
              textTransform: 'uppercase',
            }}>
              <span>📺 Live TV Player Preview</span>
              <span>{parsed ? (parsed.type === 'youtube' ? 'YouTube Embed' : 'Direct Video') : 'No Video'}</span>
            </div>

            <div style={{
              width: '100%',
              height: '190px',
              backgroundColor: '#020617',
              borderRadius: '8px',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}>
              {parsed ? (
                parsed.type === 'youtube' || parsed.type === 'embed' ? (
                  <iframe
                    src={parsed.url}
                    title="ARTA Video Preview"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{ width: '100%', height: '100%', border: 'none' }}
                  />
                ) : (
                  <video
                    src={parsed.url}
                    autoPlay
                    loop
                    muted
                    controls
                    playsInline
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )
              ) : (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '1rem' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>📹</div>
                  <div style={{ fontSize: '0.85rem' }}>Enter a video URL above to see live preview</div>
                </div>
              )}
            </div>
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.72rem', color: '#64748b', textAlign: 'center' }}>
              Note: On public TV displays, video is automatically muted so it never interrupts queue announcement chimes.
            </p>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', gap: '0.75rem' }}>
            {videoUrl ? (
              <button
                type="button"
                onClick={handleClear}
                disabled={saving}
                className="btn btn-outline btn-sm"
                style={{ color: 'var(--dole-red)', borderColor: '#fca5a5' }}
              >
                🗑️ Remove Video
              </button>
            ) : <div />}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-outline"
                style={{ minHeight: '44px' }}
              >
                Close
              </button>
              <button
                type="submit"
                disabled={saving || !videoUrl.trim()}
                className="btn btn-primary"
                style={{ minHeight: '44px', fontWeight: 700 }}
              >
                {saving ? 'Saving...' : '💾 Save & Play on TV'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
