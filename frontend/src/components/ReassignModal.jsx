import { useState, useEffect } from 'react';
import { staffApi } from '../api/staff';
import Modal from './Modal';
import { NoteField } from './ui';

/**
 * Hands a client over to another personnel in the same office.
 * Calls `onTransferred(updatedTx)` after a successful transfer.
 */
export default function ReassignModal({ tx, onClose, onTransferred }) {
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tx) return;
    setSelected(null);
    setReason('');
    setSearch('');
    setError('');
    setLoading(true);
    staffApi.getTransferRecipients(tx.id)
      .then(data => setRecipients(Array.isArray(data) ? data : []))
      .catch(err => setError(err.message || 'Could not load personnel.'))
      .finally(() => setLoading(false));
  }, [tx]);

  const term = search.trim().toLowerCase();
  const filtered = term
    ? recipients.filter(r => `${r.name} ${r.username} ${r.position}`.toLowerCase().includes(term))
    : recipients;

  const submit = async (e) => {
    e.preventDefault();
    if (!selected) return;
    try {
      setSaving(true);
      setError('');
      const updated = await staffApi.transferTransaction(tx.id, selected.id, reason.trim());
      onTransferred(updated, selected);
    } catch (err) {
      setError(err.message || 'Transfer failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!tx} onClose={onClose} title={tx ? `Reassign Queue ${tx.queue_no}` : ''} maxWidth="520px">
      {tx && (
        <form onSubmit={submit}>
          <p style={{ marginTop: 0, color: 'var(--text-secondary)', lineHeight: 1.5, fontSize: '0.92rem' }}>
            {tx.client_name || 'This client'} · {tx.service_name}. The client leaves your list right away and waits in the
            new handler's <strong>My Clients</strong> until they start it.
          </p>

          {error && (
            <div role="alert" style={{ background: 'var(--dole-red-light)', color: 'var(--dole-red-dark)', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '0.6rem 0.85rem', fontSize: '0.85rem', marginBottom: '0.9rem' }}>
              {error}
            </div>
          )}

          <label htmlFor="reassign-search">Transfer to</label>
          <input
            id="reassign-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search personnel in this office"
            style={{ minHeight: '44px' }}
          />
          <div role="listbox" aria-label="Personnel" style={{
            marginTop: '0.5rem',
            maxHeight: '260px',
            overflowY: 'auto',
            border: 'var(--border-hairline)',
            borderRadius: 'var(--radius-md)',
          }}>
            {loading ? (
              <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>Loading personnel…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>
                {recipients.length === 0 ? 'No other active personnel in this office.' : 'No match.'}
              </div>
            ) : filtered.map(r => {
              const isSel = selected?.id === r.id;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  key={r.id}
                  onClick={() => setSelected(r)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.6rem 0.85rem',
                    border: 'none',
                    borderBottom: 'var(--border-hairline)',
                    background: isSel ? 'var(--dole-blue-light)' : '#fff',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, color: isSel ? 'var(--dole-blue)' : 'var(--text-primary)' }}>{r.name}</span>
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{r.position || r.username}</span>
                  </span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', color: r.window ? '#047857' : 'var(--text-muted)' }}>
                    {r.window ? `${r.window}${r.is_serving ? ' · serving' : ''}` : 'Not at a window'}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: '1rem' }}>
            <NoteField
              id="reassign-reason"
              value={reason}
              onChange={setReason}
              placeholder="Why are you reassigning this client? e.g. Needs a labor inspection specialist"
            />
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--ui-muted)' }}>
              The new handler sees these remarks on the client and in their notification.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!selected || saving}>
              {selected ? `Transfer to ${selected.name}` : 'Choose personnel'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
