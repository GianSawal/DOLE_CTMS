import { useState, useEffect } from 'react';
import { staffApi } from '../api/staff';
import Modal from './Modal';
import { NoteField } from './ui';

/**
 * Refers a client to another office: this ticket closes as Referred, and the client
 * joins that office's waiting line when they arrive there. The client's concern is required.
 * Calls `onReferred(updatedTx)` after a successful referral.
 */
export default function ReferModal({ tx, onClose, onReferred }) {
  const [offices, setOffices] = useState([]);
  const [services, setServices] = useState([]);
  const [officeId, setOfficeId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tx) return;
    setOfficeId('');
    setServiceId(String(tx.service));
    setNote('');
    setError('');
    staffApi.getOffices()
      .then(data => setOffices((Array.isArray(data) ? data : []).filter(o => o.id !== tx.office)))
      .catch(err => setError(err.message || 'Could not load offices.'));
    staffApi.getServices()
      .then(data => setServices((Array.isArray(data) ? data : (data?.results || [])).filter(s => s.is_active)))
      .catch(() => {});
  }, [tx]);

  const office = offices.find(o => String(o.id) === officeId);
  const canSubmit = Boolean(office) && note.trim() && !saving;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      setSaving(true);
      setError('');
      const updated = await staffApi.referTransaction(tx.id, office.id, note.trim(), serviceId ? Number(serviceId) : null);
      onReferred(updated);
    } catch (err) {
      setError(err.message || 'Referral failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!tx} onClose={onClose} title={tx ? `Refer Queue ${tx.queue_no} to another office` : ''} maxWidth="520px">
      {tx && (
        <form onSubmit={submit}>
          <p style={{ marginTop: 0, color: 'var(--text-secondary)', lineHeight: 1.5, fontSize: '0.92rem' }}>
            {tx.client_name || 'This client'} · {tx.service_name}. This ticket closes as <strong>Referred</strong>. The other
            office sees the client as <strong>on the way</strong>; they join its waiting line, with a new queue number, when
            they arrive (by scanning that office's check-in QR, or when its staff confirm the arrival). The referral is valid for 3 days.
          </p>

          {error && (
            <div role="alert" style={{ background: 'var(--dole-red-light)', color: 'var(--dole-red-dark)', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '0.6rem 0.85rem', fontSize: '0.85rem', marginBottom: '0.9rem' }}>
              {error}
            </div>
          )}

          <label htmlFor="refer-office">Refer to</label>
          <select id="refer-office" value={officeId} onChange={(e) => setOfficeId(e.target.value)} required style={{ minHeight: '44px' }}>
            <option value="">Choose an office</option>
            {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>

          <div style={{ marginTop: '0.9rem' }}>
            <label htmlFor="refer-service">Service at the other office</label>
            <select id="refer-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} style={{ minHeight: '44px' }}>
              {!services.some(s => String(s.id) === String(tx.service)) && <option value={tx.service}>{tx.service_name}</option>}
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div style={{ marginTop: '0.9rem' }}>
            <NoteField
              id="refer-note"
              label="Client's concern"
              required
              value={note}
              onChange={setNote}
              placeholder="What does the client need? e.g. Registration of establishment; business is located in Baler"
            />
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--ui-muted)' }}>
              The other office sees this on the client's ticket, so they don't need to ask again.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              {saving ? 'Referring…' : office ? `Refer to ${office.name}` : 'Choose an office'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
