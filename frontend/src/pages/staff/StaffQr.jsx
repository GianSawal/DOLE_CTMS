import React, { useState, useEffect } from 'react';
import { staffApi } from '../../api/staff';
import { useAuth } from '../../context/AuthContext';
import Navbar from '../../components/Navbar';

export default function StaffQr() {
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
        ? '✅ QR Code check-in has been ENABLED. Clients can now register online.'
        : '⛔ QR Code check-in has been DISABLED. Online registration is now closed for this office.'
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
      setActionMessage('💾 Advisory closure notice updated successfully.');
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
  const qrImageUrl = selectedOfficeId ? staffApi.getQrCodeUrl(selectedOfficeId) : '';

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />

      {/* Scoped Print Styles for A4 Poster */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm 12mm;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            width: 100% !important;
            height: 100% !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * {
            visibility: hidden !important;
          }
          .print-poster-card,
          .print-poster-card * {
            visibility: visible !important;
          }
          .print-poster-card {
            position: absolute !important;
            left: 0 !important;
            right: 0 !important;
            top: 0 !important;
            margin: 0 auto !important;
            width: 100% !important;
            max-width: 186mm !important;
            box-sizing: border-box !important;
            padding: 8mm 10mm !important;
            border: 3px double #0305ba !important;
            border-radius: 16px !important;
            box-shadow: none !important;
            page-break-inside: avoid !important;
            page-break-after: avoid !important;
            page-break-before: avoid !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: space-between !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', margin: 0 }}>
              Printable Office Check-in QR Codes
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Print and mount this official A4 QR sign at the office entrance or guard desk for client self check-in.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {user?.assigned_offices?.length === 1 && !user?.is_superuser ? (
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
                🔒 {user.assigned_offices[0].name} ({user.assigned_offices[0].code})
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
              🖨️ Print Poster
            </button>
          </div>
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
                      🕒 <strong>Last Updated:</strong> {new Date(qrConfig.updated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    {qrConfig.disabled_by_username && (
                      <span>
                        👤 <strong>Updated By:</strong> {qrConfig.disabled_by_username}
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
                    {isUpdating ? 'Updating...' : '✅ Enable QR Code (Open Check-in)'}
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
                    {isUpdating ? 'Updating...' : '⛔ Disable QR Code (Close for Day)'}
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
                  📢 Advisory Notice Displayed When Closed:
                </label>
                {hasMessageChanged && (
                  <button
                    onClick={handleSaveMessageOnly}
                    disabled={isUpdating}
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '0.78rem', padding: '0.25rem 0.65rem', fontWeight: 700 }}
                  >
                    💾 Save Advisory Text
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
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Select your service</div>
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
            href={displayUrl}
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
