import React, { useState, useEffect } from 'react';
import { staffApi } from '../../api/staff';
import { useAuth } from '../../context/AuthContext';
import Navbar from '../../components/Navbar';

export default function StaffQr() {
  const { user } = useAuth();
  const [selectedOfficeId, setSelectedOfficeId] = useState('');

  useEffect(() => {
    if (user?.assigned_offices?.length > 0) {
      const isAssigned = user.assigned_offices.some(o => String(o.id) === String(selectedOfficeId));
      if (!selectedOfficeId || !isAssigned) {
        setSelectedOfficeId(String(user.assigned_offices[0].id));
      }
    }
  }, [user, selectedOfficeId]);

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

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', margin: 0 }}>
              Printable Office Check-in QR Codes
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Print and mount this QR sign at the office entrance or guard desk for client self check-in.
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

        {/* Poster Card (Printable) */}
        <div className="card print-slip-area" style={{
          backgroundColor: '#ffffff',
          textAlign: 'center',
          padding: '3rem 2rem',
          maxWidth: '540px',
          margin: '0 auto',
          boxShadow: 'var(--shadow-md)',
          border: '2px solid var(--border-color)',
        }}>
          <img
            src="/dolelogo.png"
            alt="DOLE Official Seal"
            className="dole-logo-img"
            style={{ width: '84px', height: '84px', margin: '0 auto 1rem', display: 'block' }}
          />

          <div style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--dole-blue)' }}>
            Republic of the Philippines
          </div>
          <h2 style={{ fontSize: '1.4rem', color: 'var(--text-primary)', margin: '0.25rem 0' }}>
            Department of Labor and Employment
          </h2>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            {currentOffice?.name}
          </div>

          {/* QR Code Container */}
          <div style={{
            display: 'inline-block',
            padding: '1.25rem',
            backgroundColor: '#ffffff',
            border: '2px solid #0f172a',
            borderRadius: '16px',
            marginBottom: '1.5rem',
          }}>
            {qrImageUrl ? (
              <img
                src={qrImageUrl}
                alt="DOLE Office Check-in QR"
                style={{ width: '260px', height: '260px', display: 'block' }}
              />
            ) : (
              <div style={{ width: '260px', height: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                Select an office
              </div>
            )}
          </div>

          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            SCAN HERE TO CHECK IN
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: '380px', margin: '0 auto 1.5rem', lineHeight: 1.4 }}>
            Scan with your mobile camera or QR reader to get your digital queue ticket and monitor your status in real-time.
          </p>

          <div style={{
            backgroundColor: '#f8fafc',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '0.75rem',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            wordBreak: 'break-all',
          }}>
            Check-in URL: {checkinUrl}
          </div>
        </div>

        {/* Quick Links */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1.5rem' }}>
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
