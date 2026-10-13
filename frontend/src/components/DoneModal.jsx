import { useState, useEffect } from 'react';
import Modal from './Modal';
import { NoteField } from './ui';

/**
 * Confirms completing a client, with optional remarks on what was done.
 * `onConfirm(remarks)` is called with the trimmed text.
 */
export default function DoneModal({ tx, onClose, onConfirm }) {
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    if (tx) setRemarks('');
  }, [tx]);

  const submit = (e) => {
    e.preventDefault();
    onConfirm(remarks.trim());
  };

  return (
    <Modal isOpen={!!tx} onClose={onClose} title={tx ? `Complete Queue ${tx.queue_no}` : ''} maxWidth="460px">
      <form onSubmit={submit}>
        <p style={{ marginTop: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {tx?.service_name ? <><strong>{tx.service_name}</strong>. </> : null}
          Marking it done unlocks the client&apos;s CSM survey.
        </p>
        <NoteField
          id="done-remarks"
          value={remarks}
          onChange={setRemarks}
          placeholder="What did you do for the client? e.g. Assisted in filing the SEnA request for assistance"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-success">Mark as Done</button>
        </div>
      </form>
    </Modal>
  );
}
