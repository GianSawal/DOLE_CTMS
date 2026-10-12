import { useState, useEffect } from 'react';
import { staffApi } from '../api/staff';
import Modal from './Modal';

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function describe(e) {
  switch (e.event) {
    case 'CALLED': return `${e.to_user_name} called the client${e.to_counter_name ? ` to ${e.to_counter_name}` : ''}`;
    case 'TRANSFERRED': return `${e.from_user_name || e.actor_name} transferred the client to ${e.to_user_name}`;
    case 'PENDING': return `${e.actor_name} moved the client to Pending`;
    case 'RESUMED': return `${e.to_user_name} ${e.from_status === 'transferred' ? 'started' : 'resumed'} the client${e.to_counter_name ? ` at ${e.to_counter_name}` : ''}`;
    case 'COMPLETED': return `${e.actor_name} marked the transaction Done`;
    case 'REOPENED': return `${e.actor_name} reopened the transaction (Undo Done)`;
    case 'REQUEUED': return `${e.actor_name} returned the client to the waiting queue`;
    case 'NO_SHOW': return `${e.actor_name} marked the client as no-show`;
    case 'CANCELLED': return `${e.actor_name} cancelled the ticket`;
    default: return e.event_label;
  }
}

/** Ticket details plus its immutable handling history. */
export default function TransactionHistoryModal({ txId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!txId) return;
    setData(null);
    setError('');
    staffApi.getTransactionHistory(txId)
      .then(setData)
      .catch(err => setError(err.message || 'Could not load history.'));
  }, [txId]);

  const tx = data?.transaction;

  return (
    <Modal isOpen={!!txId} onClose={onClose} title={tx ? `Queue ${tx.queue_no} — ${tx.transaction_no}` : 'Transaction History'} maxWidth="560px">
      {error && <div role="alert" style={{ color: 'var(--dole-red-dark)' }}>{error}</div>}
      {!data && !error && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}
      {tx && (
        <>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.35rem 1rem', margin: '0 0 1.25rem', fontSize: '0.9rem' }}>
            <dt style={{ color: 'var(--text-muted)' }}>Client</dt><dd style={{ margin: 0 }}>{tx.client_name || '—'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Service</dt><dd style={{ margin: 0 }}>{tx.service_name}{tx.division_name ? ` (${tx.division_name})` : ''}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Checked in</dt><dd style={{ margin: 0 }}>{formatDateTime(tx.checked_in_at)}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Handled by</dt><dd style={{ margin: 0 }}>{tx.assigned_to_name || tx.assigned_personnel || '—'}</dd>
            {tx.status === 'done' && (
              <>
                <dt style={{ color: 'var(--text-muted)' }}>Completed</dt><dd style={{ margin: 0 }}>{formatDateTime(tx.done_at)} · {tx.served_by_name}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>CSM survey</dt><dd style={{ margin: 0 }}>{tx.is_surveyed ? 'Answered' : 'Not yet answered'}</dd>
              </>
            )}
          </dl>

          <h3 style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '0 0 0.6rem' }}>
            History
          </h3>
          {data.events.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>No recorded events (handled before history tracking started).</p>
          ) : (
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: '2px solid #e2e8f0' }}>
              {data.events.map(e => (
                <li key={e.id} style={{ position: 'relative', padding: '0 0 0.9rem 1rem' }}>
                  <span style={{ position: 'absolute', left: '-6px', top: '4px', width: '10px', height: '10px', borderRadius: '50%', background: e.event === 'TRANSFERRED' ? 'var(--dole-gold)' : 'var(--dole-blue)' }} />
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{describe(e)}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatDateTime(e.created_at)}</div>
                  {e.reason && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>Note: {e.reason}</div>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Modal>
  );
}
