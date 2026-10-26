import { useState } from 'react';
import { ReferralNote } from './ui';

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Clients other offices referred here who are on the way. They are not in the line, so they
 * can't be called; `onArrived(ref)` confirms one has arrived (e.g. showed their first slip).
 * Searchable by name or by the Tx No. / queue number printed on that first slip.
 */
export default function ArrivingReferrals({ referrals, busy, onArrived }) {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const shown = term
    ? referrals.filter(r => [r.client_name, r.from_transaction_no, r.from_queue_no, r.from_office_name, r.service_name]
      .some(v => (v || '').toLowerCase().includes(term)))
    : referrals;

  return (
    <div>
      {referrals.length > 0 && (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or Tx No. on their slip"
          aria-label="Search referred clients on the way"
          style={{ minHeight: '40px', marginBottom: '0.5rem' }}
        />
      )}
      {referrals.length === 0 ? (
        <div style={{ padding: '0.75rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Nobody is on the way.</div>
      ) : shown.length === 0 ? (
        <div style={{ padding: '0.75rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>No referred client matches.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
          {shown.map(ref => (
            <li key={ref.id} style={{
              border: '1px dashed #c4b5fd', background: '#faf5ff', borderRadius: 'var(--radius-md)',
              padding: '0.7rem 0.9rem', display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', alignItems: 'center',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '0.95rem' }}>{ref.client_name || 'No name given'}</strong>
                  {ref.is_priority && <span className="badge badge-priority">Priority</span>}
                </div>
                <div style={{ fontSize: '0.85rem', marginTop: '0.2rem', color: 'var(--text-secondary)' }}>{ref.service_name}</div>
                <div style={{ fontSize: '0.76rem', marginTop: '0.15rem', color: 'var(--text-muted)' }}>
                  First slip: <span className="mono">{ref.from_transaction_no}</span> · Queue {ref.from_queue_no}
                </div>
                <ReferralNote tx={{
                  referred_from: { office_name: ref.from_office_name, by: ref.referred_by },
                  referral_note: ref.referral_note,
                }} />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  Referred {formatDateTime(ref.referred_at)} · valid until {formatDateTime(ref.expires_at)}
                </div>
              </div>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onArrived(ref)}>Arrived</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
