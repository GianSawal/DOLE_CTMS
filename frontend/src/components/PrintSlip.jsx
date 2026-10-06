import React from 'react';

export default function PrintSlip({ transaction, onClose }) {
  if (!transaction) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div>
      <div className="print-slip-area" style={{
        maxWidth: '320px',
        margin: '0 auto',
        padding: '1.25rem',
        border: '1px dashed #94a3b8',
        borderRadius: '8px',
        backgroundColor: '#ffffff',
        textAlign: 'center',
        fontFamily: 'var(--font-ui)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.5rem' }}>
          <img
            src="/dolelogo.png"
            alt="DOLE Logo"
            style={{ width: '56px', height: '56px', objectFit: 'contain' }}
          />
        </div>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Republic of the Philippines
        </div>
        <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--dole-blue)' }}>
          Department of Labor and Employment
        </div>
        <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '0.2rem' }}>
          {transaction.office_name}
        </div>

        <div style={{ margin: '1rem 0', borderTop: '1px dashed #cbd5e1', borderBottom: '1px dashed #cbd5e1', padding: '0.75rem 0' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
            Queue Number
          </div>
          <div className="mono" style={{ fontSize: '2.75rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {transaction.queue_no}
          </div>
          {transaction.is_priority && (
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--dole-gold-dark)', marginTop: '0.25rem' }}>
              ★ PRIORITY LANE (RA 9994 / RA 7277)
            </div>
          )}
        </div>

        <div style={{ textAlign: 'left', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
          {transaction.division_name && (
            <div>
              <strong>Division:</strong> {transaction.division_name}
            </div>
          )}
          <div>
            <strong>Service:</strong> {transaction.service_name}
          </div>
          {transaction.assigned_personnel && (
            <div>
              <strong>Assigned Personnel:</strong> {transaction.assigned_personnel}
            </div>
          )}
          {transaction.client_name && (
            <div>
              <strong>Client:</strong> {transaction.client_name}
            </div>
          )}
          {transaction.group_member_names && Array.isArray(transaction.group_member_names) && transaction.group_member_names.length > 0 && (
            <div style={{ marginTop: '0.15rem' }}>
              <strong>Group Members ({transaction.group_member_names.length}):</strong>
              <div style={{
                marginTop: '0.2rem',
                padding: '0.35rem 0.5rem',
                backgroundColor: '#f8fafc',
                borderRadius: '4px',
                border: '1px solid #e2e8f0',
                fontSize: '0.72rem',
                lineHeight: '1.35',
              }}>
                {transaction.group_member_names.map((name, idx) => (
                  <div key={idx}>• {name}</div>
                ))}
              </div>
            </div>
          )}
          <div>
            <strong>Tx No:</strong> <span className="mono">{transaction.transaction_no}</span>
          </div>
          <div>
            <strong>Survey Code:</strong> <span className="mono" style={{ fontWeight: 800, letterSpacing: '0.1em', color: 'var(--dole-blue)' }}>{transaction.claim_code}</span>
          </div>
          <div>
            <strong>Checked In:</strong> {transaction.checked_in_at ? new Date(transaction.checked_in_at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
          </div>
          {(transaction.started_at || transaction.called_at) && (
            <div>
              <strong>Started:</strong> {new Date(transaction.started_at || transaction.called_at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
          {transaction.done_at && (
            <div>
              <strong>Done:</strong> {new Date(transaction.done_at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
          {transaction.service_duration_display && (
            <div>
              <strong>Duration:</strong> <span style={{ fontWeight: 700, color: 'var(--dole-blue)' }}>{transaction.service_duration_display}</span>
            </div>
          )}
        </div>

        <div style={{
          backgroundColor: 'var(--dole-blue-light)',
          border: '1px solid #c7d2fe',
          borderRadius: '6px',
          padding: '0.6rem',
          fontSize: '0.72rem',
          color: '#1e1b4b',
          lineHeight: 1.4,
        }}>
          <strong>DOLE CSM Survey Requirement:</strong><br />
          Once your transaction is marked <em>Done</em>, rate our service at the CSM kiosk using your <strong>Transaction No.</strong> and <strong>Survey Code</strong>.
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
        <button onClick={onClose} className="btn btn-outline btn-sm">
          Close
        </button>
        <button onClick={handlePrint} className="btn btn-primary btn-sm">
          🖨️ Print Slip
        </button>
      </div>
    </div>
  );
}
