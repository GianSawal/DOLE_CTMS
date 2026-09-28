import React, { useState, useEffect, useRef } from 'react';
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
  return {
    type: 'direct',
    url: trimmed,
    raw: trimmed,
  };
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function ArtaVideoModal({ isOpen, onClose, defaultOfficeId }) {
  const { user } = useAuth();
  const [selectedOfficeId, setSelectedOfficeId] = useState(defaultOfficeId || '');
  
  // Mode: 'file' (upload video file) or 'url' (YouTube / online video URL)
  const [mode, setMode] = useState('file');

  // File upload state
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState('');
  const [existingFileName, setExistingFileName] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // URL state
  const [videoUrl, setVideoUrl] = useState('');
  
  // General state
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Set initial selected office from user's assigned offices
  useEffect(() => {
    if (defaultOfficeId) {
      setSelectedOfficeId(String(defaultOfficeId));
    } else if (user?.assigned_offices?.length > 0 && !selectedOfficeId) {
      setSelectedOfficeId(String(user.assigned_offices[0].id));
    }
  }, [defaultOfficeId, user, selectedOfficeId]);

  // Clean up object URL on unmount or file change
  useEffect(() => {
    return () => {
      if (filePreviewUrl && filePreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    };
  }, [filePreviewUrl]);

  // Load existing ARTA video configuration for selected office
  useEffect(() => {
    if (!isOpen || !selectedOfficeId) return;

    let isMounted = true;
    setLoading(true);
    setMessage('');
    setError('');
    setSelectedFile(null);

    async function loadConfig() {
      try {
        const res = await staffApi.getDisplayVideo(selectedOfficeId);
        if (!isMounted) return;

        const url = res.arta_video_url || '';
        const rawUrl = res.raw_video_url || '';
        const fileName = res.video_file_name || '';
        const hasFile = Boolean(res.has_file || fileName);

        setIsActive(res.is_active !== undefined ? res.is_active : true);
        setExistingFileName(fileName);

        if (hasFile) {
          setMode('file');
          setFilePreviewUrl(url);
          setVideoUrl('');
        } else if (url || rawUrl) {
          setMode('url');
          setVideoUrl(rawUrl || url);
          setFilePreviewUrl('');
        } else {
          setMode('file');
          setVideoUrl('');
          setFilePreviewUrl('');
        }
      } catch (err) {
        // Fallback to local storage if API is not yet loaded
        const cached = localStorage.getItem(`ctms_arta_video_${selectedOfficeId}`);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed.url) {
              setVideoUrl(parsed.url);
              setMode('url');
            }
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

  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    // Validate video type
    if (!file.type.startsWith('video/') && !/\.(mp4|webm|ogg|mov|mkv)$/i.test(file.name)) {
      setError('Please select a valid video file (.mp4, .webm, .ogg, or .mov).');
      return;
    }

    // Check size limit: 200MB max
    if (file.size > 200 * 1024 * 1024) {
      setError('File is too large. Maximum allowed size is 200MB.');
      return;
    }

    setError('');
    setMessage('');
    setSelectedFile(file);

    if (filePreviewUrl && filePreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(filePreviewUrl);
    }
    const newPreviewUrl = URL.createObjectURL(file);
    setFilePreviewUrl(newPreviewUrl);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) {
      if (!file.type.startsWith('video/') && !/\.(mp4|webm|ogg|mov|mkv)$/i.test(file.name)) {
        setError('Please drop a valid video file (.mp4, .webm, .ogg, or .mov).');
        return;
      }
      if (file.size > 200 * 1024 * 1024) {
        setError('File is too large. Maximum allowed size is 200MB.');
        return;
      }
      setError('');
      setMessage('');
      setSelectedFile(file);

      if (filePreviewUrl && filePreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(filePreviewUrl);
      }
      const newPreviewUrl = URL.createObjectURL(file);
      setFilePreviewUrl(newPreviewUrl);
    }
  };

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
      let finalVideoUrl = '';

      if (mode === 'file') {
        if (selectedFile) {
          const res = await staffApi.uploadDisplayVideoFile(selectedOfficeId, selectedFile, isActive);
          finalVideoUrl = res.arta_video_url || '';
          setExistingFileName(res.video_file_name || selectedFile.name);
          setSelectedFile(null);
          setFilePreviewUrl(finalVideoUrl);
        } else if (filePreviewUrl) {
          // Keep existing uploaded file, just update active status
          const res = await staffApi.updateDisplayVideo(selectedOfficeId, filePreviewUrl, isActive);
          finalVideoUrl = res.arta_video_url || filePreviewUrl;
        } else {
          setError('Please choose a video file to upload.');
          setSaving(false);
          return;
        }
      } else {
        if (!videoUrl.trim()) {
          setError('Please enter a video URL.');
          setSaving(false);
          return;
        }
        const res = await staffApi.updateDisplayVideo(selectedOfficeId, videoUrl.trim(), isActive);
        finalVideoUrl = res.arta_video_url || videoUrl.trim();
        setExistingFileName('');
        setSelectedFile(null);
      }

      // Cache locally and broadcast to open display tabs immediately
      const payload = {
        officeId: selectedOfficeId,
        url: finalVideoUrl,
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
    if (filePreviewUrl && filePreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(filePreviewUrl);
    }
    setSelectedFile(null);
    setFilePreviewUrl('');
    setExistingFileName('');
    setVideoUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await staffApi.clearDisplayVideo(selectedOfficeId);
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

  // Determine current active preview
  const currentPreviewSource = mode === 'file' ? filePreviewUrl : videoUrl;
  const parsed = parseVideoEmbedUrl(currentPreviewSource);
  const displayUrl = selectedOfficeId ? `/display/office/${selectedOfficeId}` : '';
  const hasExistingVideo = Boolean(selectedFile || filePreviewUrl || videoUrl);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="🎥 Configure ARTA Video for TV Display">
      <div style={{ maxHeight: '82vh', overflowY: 'auto', paddingRight: '0.25rem' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1.15rem 0', lineHeight: 1.45 }}>
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

          {/* Mode Tabs: Add File vs URL */}
          <div style={{
            display: 'flex',
            backgroundColor: 'var(--bg-subtle, #f1f5f9)',
            padding: '4px',
            borderRadius: '10px',
            border: '1px solid var(--border-color, #e2e8f0)',
            gap: '4px',
          }}>
            <button
              type="button"
              onClick={() => { setMode('file'); setError(''); }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
                padding: '0.6rem 0.75rem',
                border: 'none',
                borderRadius: '7px',
                fontSize: '0.88rem',
                fontWeight: mode === 'file' ? 700 : 500,
                cursor: 'pointer',
                backgroundColor: mode === 'file' ? '#ffffff' : 'transparent',
                color: mode === 'file' ? 'var(--dole-blue, #0305ba)' : 'var(--text-muted, #64748b)',
                boxShadow: mode === 'file' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <span>📁</span>
              <span>Upload Video File (MP4)</span>
            </button>
            <button
              type="button"
              onClick={() => { setMode('url'); setError(''); }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
                padding: '0.6rem 0.75rem',
                border: 'none',
                borderRadius: '7px',
                fontSize: '0.88rem',
                fontWeight: mode === 'url' ? 700 : 500,
                cursor: 'pointer',
                backgroundColor: mode === 'url' ? '#ffffff' : 'transparent',
                color: mode === 'url' ? 'var(--dole-blue, #0305ba)' : 'var(--text-muted, #64748b)',
                boxShadow: mode === 'url' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <span>🔗</span>
              <span>Video Link / YouTube</span>
            </button>
          </div>

          {/* Tab 1: Upload Video File */}
          {mode === 'file' && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/ogg,video/quicktime,video/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />

              {/* File Dropzone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                style={{
                  border: isDragOver ? '2px dashed var(--dole-blue, #0305ba)' : '2px dashed #cbd5e1',
                  backgroundColor: isDragOver ? 'rgba(3, 5, 186, 0.04)' : '#f8fafc',
                  borderRadius: '12px',
                  padding: '1.5rem 1rem',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ fontSize: '2.4rem', marginBottom: '0.4rem', lineHeight: 1 }}>
                  🎬
                </div>
                <div style={{ fontWeight: 700, fontSize: '0.98rem', color: '#1e293b', marginBottom: '0.25rem' }}>
                  {selectedFile ? 'Change Selected Video File' : 'Click or Drag & Drop to Add Video File'}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.85rem' }}>
                  Supports MP4, WebM, OGG, or MOV (Recommended 720p or 1080p, up to 200MB)
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current && fileInputRef.current.click();
                  }}
                  className="btn btn-outline btn-sm"
                  style={{
                    backgroundColor: '#ffffff',
                    borderColor: 'var(--dole-blue, #0305ba)',
                    color: 'var(--dole-blue, #0305ba)',
                    fontWeight: 600,
                    padding: '0.4rem 1rem',
                    borderRadius: '8px',
                  }}
                >
                  ➕ Choose Video File
                </button>
              </div>

              {/* Selected / Current File Info Card */}
              {(selectedFile || existingFileName || filePreviewUrl) && (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '0.75rem 1rem',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', overflow: 'hidden' }}>
                    <div style={{
                      backgroundColor: '#16a34a',
                      color: '#ffffff',
                      borderRadius: '8px',
                      padding: '0.4rem 0.6rem',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      letterSpacing: '0.5px',
                    }}>
                      MP4
                    </div>
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{
                        fontSize: '0.86rem',
                        fontWeight: 700,
                        color: '#166534',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {selectedFile ? selectedFile.name : (existingFileName || 'Current Video File')}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#15803d' }}>
                        {selectedFile
                          ? `Ready to upload (${formatBytes(selectedFile.size)})`
                          : 'Currently active on TV display board'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current && fileInputRef.current.click()}
                      className="btn btn-outline btn-sm"
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', minHeight: '28px' }}
                    >
                      Change
                    </button>
                    {selectedFile && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFile(null);
                          if (filePreviewUrl && filePreviewUrl.startsWith('blob:')) {
                            URL.revokeObjectURL(filePreviewUrl);
                          }
                          setFilePreviewUrl(existingFileName ? filePreviewUrl : '');
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', minHeight: '28px', color: '#dc2626', borderColor: '#fca5a5' }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Video URL or Folder Link Input */}
          {mode === 'url' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label htmlFor="arta-video-url" style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                  Video URL or Folder Link:
                </label>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Folder link, YouTube, or direct video file
                </span>
              </div>
              <input
                id="arta-video-url"
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="e.g. http://10.6.50.38/videos/ or https://www.youtube.com/watch?v=..."
                className="form-control"
                style={{ width: '100%', minHeight: '44px', padding: '0.5rem 0.75rem' }}
              />

              {/* Quick Preset Buttons */}
              <div style={{ marginTop: '0.65rem' }}>
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
            </div>
          )}

          {/* Active Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.1rem' }}>
            <input
              id="arta-is-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <label htmlFor="arta-is-active" style={{ fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' }}>
              Active on TV Display (uncheck to pause without deleting video)
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
              <span>
                {parsed ? (parsed.type === 'youtube' ? 'YouTube Embed' : 'Direct Video File') : 'No Video'}
              </span>
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
                    key={parsed.url}
                    src={parsed.url}
                    title="ARTA Video Preview"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{ width: '100%', height: '100%', border: 'none' }}
                  />
                ) : (
                  <video
                    key={parsed.url}
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
                  <div style={{ fontSize: '2.2rem', marginBottom: '0.25rem' }}>📹</div>
                  <div style={{ fontSize: '0.85rem' }}>
                    {mode === 'file' ? 'Choose or drop a video file above to preview' : 'Enter a video URL above to preview'}
                  </div>
                </div>
              )}
            </div>
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.72rem', color: '#64748b', textAlign: 'center' }}>
              Note: On public TV displays, video is automatically muted so it never interrupts queue announcement chimes.
            </p>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', gap: '0.75rem' }}>
            {hasExistingVideo ? (
              <button
                type="button"
                onClick={handleClear}
                disabled={saving}
                className="btn btn-outline btn-sm"
                style={{ color: 'var(--dole-red, #dc2626)', borderColor: '#fca5a5' }}
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
                disabled={saving || (mode === 'file' ? (!selectedFile && !filePreviewUrl) : !videoUrl.trim())}
                className="btn btn-primary"
                style={{ minHeight: '44px', fontWeight: 700 }}
              >
                {saving ? 'Uploading & Saving...' : '💾 Save & Play on TV'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
