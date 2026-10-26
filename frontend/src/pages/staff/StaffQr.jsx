import React, { useState, useEffect } from 'react';
import { staffApi } from '../../api/staff';
import { useAuth } from '../../context/AuthContext';
import { Lock, Printer, KeyRound, RefreshCw, Copy, Tv } from 'lucide-react';
import { PageHeader } from '../../components/ui';
import posterPrintCss from './StaffQr.css?inline';

// The poster's print rules (only the poster prints, on A4) apply only while this page is open
function usePosterPrintStyles() {
  useEffect(() => {
    if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return undefined;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(posterPrintCss);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== sheet); };
  }, []);
}

export default function StaffQr() {
  usePosterPrintStyles();
  const { user } = useAuth();
  const [selectedOfficeId, setSelectedOfficeId] = useState('');
  const [qrConfig, setQrConfig] = useState(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editMessage, setEditMessage] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionType, setActionType] = useState('info'); // 'success' | 'error' | 'info'

  useEffect(() => {
    if (user?.assigned_offices?.length > 0) {
      const isAssigned = user.assigned_offices.some(o => String(o.id) === String(selectedOfficeId));
      if (!selectedOfficeId || !isAssigned) {
        setSelectedOfficeId(String(user.assigned_offices[0].id));
      }
    }
  }, [user, selectedOfficeId]);

  useEffect(() => {
    async function loadConfig() {
      if (!selectedOfficeId) return;
      try {
        setIsLoadingConfig(true);
        const data = await staffApi.getQrConfig(selectedOfficeId);
        setQrConfig(data);
        setEditMessage(data.disabled_message || '');
      } catch (err) {
        console.error('Failed to load QR config:', err);
      } finally {
        setIsLoadingConfig(false);
      }
    }
    loadConfig();
  }, [selectedOfficeId]);

  // The check-in code changes at midnight; refresh it if this page stays open.
  useEffect(() => {
    if (!selectedOfficeId || !qrConfig?.requires_office_code) return undefined;
    const timer = setInterval(async () => {
      try {
        const data = await staffApi.getQrConfig(selectedOfficeId);
        setQrConfig(prev => ({ ...prev, ...data, disabled_message: prev?.disabled_message ?? data.disabled_message }));
      } catch {
        // Keep showing the last known code; the next tick retries.
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [selectedOfficeId, qrConfig?.requires_office_code]);

  const [codeMessage, setCodeMessage] = useState('');
  const [codeMessageType, setCodeMessageType] = useState('success');

  const showCodeMessage = (type, text) => {
    setCodeMessageType(type);
    setCodeMessage(text);
    if (type === 'success') setTimeout(() => setCodeMessage(''), 5000);
  };

  const handleOfficeCodeChange = async (changes, successText) => {
    if (!selectedOfficeId) return;
    try {
      setIsUpdating(true);
      setCodeMessage('');
      const updated = await staffApi.updateOfficeCode(selectedOfficeId, changes);
      // Keep any unsaved closure notice the user is typing
      setQrConfig(prev => ({ ...updated, disabled_message: prev?.disabled_message ?? updated.disabled_message }));
      showCodeMessage('success', successText);
    } catch (err) {
      showCodeMessage('error', err.message || 'Failed to update the check-in code.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCopyTvLink = async () => {
    try {
      await navigator.clipboard.writeText(tvDisplayUrl);
      showCodeMessage('success', 'TV link copied. Open it on the office TV.');
    } catch {
      showCodeMessage('error', 'Could not copy automatically. Select the link and copy it.');
    }
  };

  const handleToggle = async (targetState) => {
    if (!selectedOfficeId) return;
    try {
      setIsUpdating(true);
      setActionMessage('');
      const updated = await staffApi.toggleQrConfig(selectedOfficeId, targetState, editMessage);
      setQrConfig(updated);
      setEditMessage(updated.disabled_message || '');
      setActionType('success');
      setActionMessage(targetState
        ? 'Check-in is now open. Clients can register online.'
        : 'Check-in is now closed. Online registration is unavailable for this office.'
      );
      setTimeout(() => setActionMessage(''), 5000);
    } catch (err) {
      setActionType('error');
      setActionMessage(err.message || 'Failed to update QR code status.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveMessageOnly = async () => {
    if (!selectedOfficeId || !qrConfig) return;
    try {
      setIsUpdating(true);
      setActionMessage('');
      const updated = await staffApi.toggleQrConfig(selectedOfficeId, qrConfig.is_qr_enabled, editMessage);
      setQrConfig(updated);
      setActionType('success');
      setActionMessage('Closure notice saved.');
      setTimeout(() => setActionMessage(''), 5000);
    } catch (err) {
      setActionType('error');
      setActionMessage(err.message || 'Failed to update advisory text.');
    } finally {
      setIsUpdating(false);
    }
  };

  const hasMessageChanged = qrConfig && editMessage !== (qrConfig.disabled_message || '');
  const currentOffice = user?.assigned_offices?.find(o => String(o.id) === selectedOfficeId);
  const checkinUrl = selectedOfficeId ? `${window.location.origin}/checkin/office/${selectedOfficeId}` : '';
  const displayUrl = selectedOfficeId ? `${window.location.origin}/display/office/${selectedOfficeId}` : '';
  // The TV link carries the office's secret key so only the office TV shows the check-in code.
  const tvDisplayUrl = displayUrl && qrConfig?.display_key ? `${displayUrl}?key=${encodeURIComponent(qrConfig.display_key)}` : displayUrl;
  const requiresCode = !!qrConfig?.requires_office_code;
  const codeChangesAt = qrConfig?.office_code_valid_until
    ? new Date(qrConfig.office_code_valid_until).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';
  const qrImageUrl = selectedOfficeId ? staffApi.getQrCodeUrl(selectedOfficeId) : '';

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>

      {/* Scoped Print Styles for A4 Poster */}

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        <div className="no-print">
        <PageHeader title="Printable Office Check-in QR Codes" subtitle="Print and mount this official A4 QR sign at the office entrance or guard desk for client self check-in.">
          {user?.assigned_offices?.length === 1 ? (
              <div style={{
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                padding: '0 1rem',
                backgroundColor: 'rgba(3, 5, 186, 0.05)',
                border: '1px solid rgba(3, 5, 186, 0.2)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 700,
                color: 'var(--dole-blue)',
                fontSize: '0.9rem',
              }}>
                <Lock size={14} aria-hidden="true" style={{ marginRight: '0.35rem' }} />{user.assigned_offices[0].name} ({user.assigned_offices[0].code})
              </div>
            ) : (
              <select
                value={selectedOfficeId}
                onChange={(e) => setSelectedOfficeId(e.target.value)}
                style={{ minHeight: '44px', minWidth: '220px' }}
              >
                {user?.assigned_offices?.map(o => (
                  <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
                ))}
              </select>
            )}
            <button onClick={handlePrint} className="btn btn-primary" style={{ minHeight: '44px' }}>
              <Printer size={15} aria-hidden="true" /> Print Poster
            </button>
        </PageHeader>
        </div>

        {/* Office Hours & QR Code Enable/Disable Status Card (no-print) */}
        {selectedOfficeId && (
          <div className="card no-print" style={{
            marginBottom: '1.5rem',
            padding: '1.35rem 1.5rem',
            backgroundColor: qrConfig?.is_qr_enabled === false ? '#fff1f2' : '#f0fdf4',
            border: `2px solid ${qrConfig?.is_qr_enabled === false ? '#fecdd3' : '#bbf7d0'}`,
            borderRadius: '12px',
            boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.25rem' }}>
              <div style={{ flex: '1 1 340px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '0.3rem 0.85rem',
                    borderRadius: '9999px',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    letterSpacing: '0.02em',
                    backgroundColor: qrConfig?.is_qr_enabled === false ? '#fee2e2' : '#dcfce7',
                    color: qrConfig?.is_qr_enabled === false ? '#991b1b' : '#166534',
                    border: `1px solid ${qrConfig?.is_qr_enabled === false ? '#f87171' : '#86efac'}`,
                  }}>
                    <span style={{
                      width: '9px',
                      height: '9px',
                      borderRadius: '50%',
                      backgroundColor: qrConfig?.is_qr_enabled === false ? '#ef4444' : '#22c55e',
                      boxShadow: qrConfig?.is_qr_enabled === false ? '0 0 6px #ef4444' : '0 0 6px #22c55e',
                    }} />
                    {qrConfig?.is_qr_enabled === false
                      ? 'REGISTRATION CLOSED (BEYOND OFFICE HOURS)'
                      : 'REGISTRATION OPEN (CLIENTS CAN CHECK IN)'}
                  </span>
                  {isLoadingConfig && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Refreshing...</span>}
                </div>

                <h3 style={{
                  fontSize: '1.2rem',
                  fontWeight: 800,
                  margin: '0.2rem 0 0.4rem',
                  color: qrConfig?.is_qr_enabled === false ? '#991b1b' : '#166534',
                }}>
                  {qrConfig?.is_qr_enabled === false
                    ? 'QR Code Check-in is Disabled'
                    : 'QR Code Check-in is Enabled & Active'}
                </h3>

                <p style={{
                  fontSize: '0.88rem',
                  color: qrConfig?.is_qr_enabled === false ? '#7f1d1d' : '#14532d',
                  margin: '0 0 0.75rem',
                  lineHeight: 1.5,
                }}>
                  {qrConfig?.is_qr_enabled === false
                    ? 'Client registration is blocked. Anyone who scans the QR code or opens the web check-in link will see the official closed advisory and cannot generate queue tickets. Staff can still register walk-ins manually if needed.'
                    : 'Clients scanning this QR code or visiting the check-in web address can register for services and receive queue numbers.'}
                </p>

                {/* Audit metadata */}
                {qrConfig?.updated_at && (
                  <div style={{ fontSize: '0.78rem', color: '#64748b', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <span>
                      <strong>Last updated:</strong> {new Date(qrConfig.updated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    {qrConfig.disabled_by_username && (
                      <span>
                        <strong>Updated by:</strong> {qrConfig.disabled_by_username}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Action Toggle Button */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem', minWidth: '240px' }}>
                {qrConfig?.is_qr_enabled === false ? (
                  <button
                    onClick={() => handleToggle(true)}
                    disabled={isUpdating}
                    className="btn btn-primary"
                    style={{
                      minHeight: '46px',
                      backgroundColor: '#16a34a',
                      borderColor: '#15803d',
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: '0.92rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)',
                    }}
                  >
                    {isUpdating ? 'Updating...' : 'Open Check-in'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleToggle(false)}
                    disabled={isUpdating}
                    className="btn"
                    style={{
                      minHeight: '46px',
                      backgroundColor: '#dc2626',
                      borderColor: '#b91c1c',
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: '0.92rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      boxShadow: '0 2px 6px rgba(220, 38, 38, 0.25)',
                    }}
                  >
                    {isUpdating ? 'Updating...' : 'Close Check-in'}
                  </button>
                )}

                <span style={{ fontSize: '0.74rem', color: '#64748b', textAlign: 'center' }}>
                  Takes effect immediately for all visitors
                </span>
              </div>
            </div>

            {/* Custom Advisory Message Section */}
            <div style={{
              marginTop: '1.25rem',
              paddingTop: '1rem',
              borderTop: `1px dashed ${qrConfig?.is_qr_enabled === false ? '#fca5a5' : '#86efac'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  Notice shown to clients while check-in is closed
                </label>
                {hasMessageChanged && (
                  <button
                    onClick={handleSaveMessageOnly}
                    disabled={isUpdating}
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '0.78rem', padding: '0.25rem 0.65rem', fontWeight: 700 }}
                  >
                    Save Notice
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={editMessage}
                  onChange={(e) => setEditMessage(e.target.value)}
                  placeholder="e.g. Online QR check-in is currently closed. Registration is only available during regular office hours (Monday - Friday, 8:00 AM - 5:00 PM)."
                  style={{
                    flex: 1,
                    backgroundColor: '#ffffff',
                    fontSize: '0.86rem',
                    padding: '0.55rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                  }}
                />
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.35rem' }}>
                Clients will see this message on their phones when scanning the QR code beyond office hours.
              </div>
            </div>

            {/* Feedback Alerts */}
            {actionMessage && (
              <div style={{
                marginTop: '0.85rem',
                padding: '0.55rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.83rem',
                backgroundColor: actionType === 'error' ? '#fee2e2' : '#dcfce7',
                color: actionType === 'error' ? '#991b1b' : '#166534',
                border: `1px solid ${actionType === 'error' ? '#f87171' : '#86efac'}`,
                fontWeight: 700,
              }}>
                {actionMessage}
              </div>
            )}
          </div>
        )}

        {/* Hourly Check-in Code (no-print) */}
        {selectedOfficeId && qrConfig && (
          <section className="card no-print" aria-labelledby="office-code-title" style={{
            marginBottom: '1.5rem',
            padding: '1.35rem 1.5rem',
            border: `2px solid ${requiresCode ? 'rgba(3, 5, 186, 0.35)' : 'var(--border-color)'}`,
            borderRadius: '12px',
            boxShadow: 'var(--shadow-sm)',
            backgroundColor: '#ffffff',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.25rem' }}>
              <div style={{ flex: '1 1 340px' }}>
                <h3 id="office-code-title" style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--text-primary)' }}>
                  <KeyRound size={18} aria-hidden="true" style={{ color: 'var(--dole-blue)' }} />
                  Hourly Check-in Code
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '0.15rem 0.6rem',
                    borderRadius: '9999px',
                    backgroundColor: requiresCode ? '#dbeafe' : '#f1f5f9',
                    color: requiresCode ? '#1e3a8a' : '#475569',
                    border: `1px solid ${requiresCode ? '#93c5fd' : '#cbd5e1'}`,
                  }}>
                    {requiresCode ? 'REQUIRED' : 'OFF'}
                  </span>
                </h3>
                <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  {requiresCode
                    ? 'Clients must type this code when they check in, so a photo of the poster can\'t be used to register from home. Show it on the office TV or write it on a board next to the poster. A new code is made automatically every hour, on the hour; the previous code still works for 10 minutes after it changes.'
                    : 'Stops clients from registering from home with a photo of the poster. When on, the check-in form asks for a 4-digit code that is only shown inside the office (on the TV or a board). The poster does not need to be reprinted.'}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem', minWidth: '240px' }}>
                <button
                  onClick={() => handleOfficeCodeChange(
                    { requires_office_code: !requiresCode },
                    requiresCode
                      ? 'Check-in code turned off. Clients can check in without a code.'
                      : 'Check-in code turned on. Show the current code on the TV or a board.'
                  )}
                  disabled={isUpdating}
                  className={requiresCode ? 'btn btn-outline' : 'btn btn-primary'}
                  style={{ minHeight: '46px', fontWeight: 800 }}
                >
                  {isUpdating ? 'Updating...' : requiresCode ? 'Turn Off Check-in Code' : 'Require Check-in Code'}
                </button>
                <span style={{ fontSize: '0.74rem', color: '#64748b', textAlign: 'center' }}>
                  Walk-ins registered by staff never need a code
                </span>
              </div>
            </div>

            {requiresCode && qrConfig.office_code && (
              <div style={{
                marginTop: '1.25rem',
                paddingTop: '1.1rem',
                borderTop: '1px dashed var(--border-color)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '1.25rem',
                alignItems: 'center',
              }}>
                <div style={{
                  padding: '0.75rem 1.5rem',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(3, 5, 186, 0.05)',
                  border: '2px solid rgba(3, 5, 186, 0.25)',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#475569' }}>
                    Current code
                  </div>
                  <div
                    aria-label={`Current code ${qrConfig.office_code.split('').join(' ')}`}
                    style={{ fontSize: '2.75rem', fontWeight: 900, letterSpacing: '0.2em', lineHeight: 1.1, color: 'var(--dole-blue)', fontVariantNumeric: 'tabular-nums', paddingLeft: '0.2em' }}
                  >
                    {qrConfig.office_code}
                  </div>
                  {codeChangesAt && (
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Changes at {codeChangesAt}</div>
                  )}
                </div>

                <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => {
                        if (window.confirm('Make a new code now? The current code stops working immediately. Update the board if you wrote the code on one; the TV updates by itself.')) {
                          handleOfficeCodeChange({ regenerate: true }, 'New code made. The old code no longer works.');
                        }
                      }}
                      disabled={isUpdating}
                      className="btn btn-outline btn-sm"
                    >
                      <RefreshCw size={14} aria-hidden="true" /> New Code Now
                    </button>
                    <button onClick={handleCopyTvLink} className="btn btn-outline btn-sm">
                      <Copy size={14} aria-hidden="true" /> Copy TV Link
                    </button>
                    <a href={tvDisplayUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                      <Tv size={14} aria-hidden="true" /> Open TV Display
                    </a>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
                    <strong>For the TV to show the code</strong>, open it with this office's TV link (above). The ordinary display link without the key never shows the code, so it can't be seen from outside.
                    {' '}Use <strong>New Code Now</strong> if the code was shared outside the office.
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                    TV link shared by mistake?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Issue a new TV link? The current TV link stops showing the code; open the new link on the office TV.')) {
                          handleOfficeCodeChange({ regenerate_display_key: true }, 'New TV link issued. Open it on the office TV.');
                        }
                      }}
                      disabled={isUpdating}
                      style={{ border: 'none', background: 'none', padding: 0, color: 'var(--dole-blue)', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit', fontWeight: 600 }}
                    >
                      Issue a new TV link
                    </button>
                  </div>
                </div>
              </div>
            )}

            {codeMessage && (
              <div role="status" style={{
                marginTop: '0.85rem',
                padding: '0.55rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.83rem',
                backgroundColor: codeMessageType === 'error' ? '#fee2e2' : '#dcfce7',
                color: codeMessageType === 'error' ? '#991b1b' : '#166534',
                border: `1px solid ${codeMessageType === 'error' ? '#f87171' : '#86efac'}`,
                fontWeight: 700,
              }}>
                {codeMessage}
              </div>
            )}
          </section>
        )}

        {/* Warning Banner When QR Registration Is Currently Closed */}
        {qrConfig?.is_qr_enabled === false && (
          <div className="no-print" style={{
            maxWidth: '580px',
            margin: '0 auto 1.25rem',
            padding: '0.75rem 1rem',
            backgroundColor: '#fee2e2',
            border: '2px solid #ef4444',
            borderRadius: '10px',
            color: '#991b1b',
            fontSize: '0.88rem',
            fontWeight: 700,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
          }}>
            <span>⚠️</span>
            <span>Registration for this office is <strong>DISABLED</strong>. Visitors scanning this poster right now will be blocked with the advisory notice.</span>
          </div>
        )}

        {/* Poster Card (Printable A4) */}
        <div className="card print-poster-card" style={{
          backgroundColor: '#ffffff',
          textAlign: 'center',
          padding: '2.5rem 2rem',
          maxWidth: '580px',
          margin: '0 auto',
          boxShadow: 'var(--shadow-md)',
          border: '2px solid var(--border-color)',
          borderRadius: '16px',
        }}>
          {/* Header Section */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            <img
              src="/dolelogo.png"
              alt="DOLE Official Seal"
              className="dole-logo-img"
              style={{ width: '84px', height: '84px', margin: '0 auto 0.6rem', display: 'block', objectFit: 'contain' }}
            />

            <div style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#475569' }}>
              Republic of the Philippines
            </div>
            <h2 style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--dole-blue)', margin: '0.2rem 0', letterSpacing: '-0.01em' }}>
              DEPARTMENT OF LABOR AND EMPLOYMENT
            </h2>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155' }}>
              Regional Office No. III — Central Luzon
            </div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
              {currentOffice?.name || 'Frontline Services'}
            </div>

            {/* Tricolor Accent Bar */}
            <div style={{
              display: 'flex',
              width: '100%',
              maxWidth: '360px',
              height: '4px',
              borderRadius: '2px',
              overflow: 'hidden',
              margin: '0.85rem auto 0.75rem',
            }}>
              <div style={{ flex: 1, backgroundColor: 'var(--dole-blue)' }} />
              <div style={{ flex: 1, backgroundColor: 'var(--dole-red)' }} />
              <div style={{ flex: 1, backgroundColor: 'var(--dole-gold)' }} />
            </div>
          </div>

          {/* Action Title */}
          <div style={{ margin: '0.4rem 0' }}>
            <div style={{
              display: 'inline-block',
              backgroundColor: 'rgba(3, 5, 186, 0.08)',
              color: 'var(--dole-blue)',
              padding: '0.3rem 0.9rem',
              borderRadius: '9999px',
              fontSize: '0.8rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.35rem',
            }}>
              Official Check-in Station
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em' }}>
              SCAN TO GET QUEUE TICKET
            </div>
            <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0.2rem 0 0' }}>
              Point your smartphone camera at the QR code below
            </p>
          </div>

          {/* QR Code Container */}
          <div style={{
            display: 'inline-block',
            padding: '1.25rem',
            backgroundColor: '#ffffff',
            border: '3px solid #0305ba',
            borderRadius: '20px',
            margin: '0.6rem auto',
            boxShadow: '0 4px 12px rgba(3, 5, 186, 0.1)',
          }}>
            {qrImageUrl ? (
              <img
                src={qrImageUrl}
                alt="DOLE Office Check-in QR"
                style={{ width: '250px', height: '250px', display: 'block' }}
              />
            ) : (
              <div style={{ width: '250px', height: '250px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                Select an office
              </div>
            )}
          </div>

          {/* 3 Step Instructions */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.75rem',
            width: '100%',
            maxWidth: '460px',
            margin: '0.4rem auto 0.85rem',
            textAlign: 'center',
          }}>
            <div style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '0.5rem 0.25rem',
            }}>
              <div style={{ fontSize: '1.15rem', marginBottom: '0.15rem' }}>📷</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0f172a' }}>1. Scan QR</div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Open phone camera</div>
            </div>
            <div style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '0.5rem 0.25rem',
            }}>
              <div style={{ fontSize: '1.15rem', marginBottom: '0.15rem' }}>✍️</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0f172a' }}>2. Enter Info</div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                {requiresCode ? 'Service + code on the TV' : 'Select your service'}
              </div>
            </div>
            <div style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '0.5rem 0.25rem',
            }}>
              <div style={{ fontSize: '1.15rem', marginBottom: '0.15rem' }}>🎟️</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0f172a' }}>3. Get Ticket</div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Watch TV display</div>
            </div>
          </div>

          {/* URL Box & ARTA Compliance */}
          <div style={{ width: '100%' }}>
            <div style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '0.55rem 0.75rem',
              fontSize: '0.78rem',
              color: '#475569',
              wordBreak: 'break-all',
              marginBottom: '0.55rem',
            }}>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>Manual link: </span>
              <span className="mono">{checkinUrl}</span>
            </div>

            <div style={{ fontSize: '0.68rem', color: '#64748b', lineHeight: 1.3 }}>
              In compliance with <strong>Republic Act No. 11032</strong> (Ease of Doing Business &amp; Efficient Government Service Delivery Act)
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1.5rem' }}>
          <a
            href={checkinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline btn-sm"
          >
            ↗ Open Client Check-in Page
          </a>
          <a
            href={tvDisplayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline btn-sm"
          >
            ↗ Open Office TV Display Board
          </a>
        </div>
      </main>
    </div>
  );
}
