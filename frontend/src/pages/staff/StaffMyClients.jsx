import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { staffApi } from '../../api/staff';
import Modal from '../../components/Modal';
import ReassignModal from '../../components/ReassignModal';
import TransactionHistoryModal from '../../components/TransactionHistoryModal';
import { broadcastQueueCall } from '../../utils/airportChime';
import { PageHeader, Notice } from '../../components/ui';

const POLL_MS = 5000;

const TABS = [
  { key: 'ongoing', label: 'Ongoing', hint: 'Clients you are serving, or that were transferred to you and are waiting for you to start.' },
  { key: 'pending', label: 'Pending', hint: 'Clients you paused, e.g. waiting for requirements. They stay with you until you resume or reassign them.' },
  { key: 'done', label: 'Done', hint: 'Transactions you completed (latest 200).' },
];

const STATUS_BADGE = {
  serving: { cls: 'badge badge-serving', label: 'Serving' },
  transferred: { cls: 'badge badge-priority', label: 'Transferred – not started' },
  pending: { cls: 'badge badge-pending', label: 'Pending' },
  done: { cls: 'badge badge-done', label: 'Done' },
};

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function StaffMyClients() {
  const [tab, setTab] = useState('ongoing');
  const [search, setSearch] = useState('');
  const [data, setData] = useState({ results: [], counts: { ongoing: 0, pending: 0, done: 0 }, my_window: null });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  const [reassignTx, setReassignTx] = useState(null);
  const [historyTxId, setHistoryTxId] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [pendingTx, setPendingTx] = useState(null);
  const [pendingReason, setPendingReason] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const res = await staffApi.getMyClients(tab, search.trim());
      setData(res);
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'Failed to load your clients.' });
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    setLoading(true);
    const debounce = setTimeout(fetchData, 250);
    const timer = setInterval(fetchData, POLL_MS);
    return () => { clearTimeout(debounce); clearInterval(timer); };
  }, [fetchData]);

  const flash = (type, text) => {
    setNotice({ type, text });
    if (type === 'success') setTimeout(() => setNotice(curr => (curr?.text === text ? null : curr)), 4000);
  };

  const run = async (tx, fn, successText) => {
    try {
      setBusyId(tx.id);
      const res = await fn();
      if (successText) flash('success', successText);
      await fetchData();
      return res;
    } catch (err) {
      flash('error', err.message || 'Action failed.');
      await fetchData();
      return null;
    } finally {
      setBusyId(null);
    }
  };

  const act = (tx, action, successText, payload) => run(tx, () => staffApi.transactionAction(tx.id, action, payload), successText);

  const startOrResume = (tx) => run(tx, async () => {
    const res = await staffApi.transactionAction(tx.id, 'call');
    // Clients started without a window are announced with the personnel's name.
    broadcastQueueCall({
      officeId: res.office,
      txId: res.id,
      queueNo: res.queue_no,
      counter: res.counter_name || res.assigned_to_name || '',
      personnel: res.assigned_to_name || '',
      action: 'call',
    });
    return res;
  }, myWindow ? `Queue ${tx.queue_no} called to your window.` : `You are now serving Queue ${tx.queue_no}.`);

  const submitPending = async (e) => {
    e.preventDefault();
    const tx = pendingTx;
    setPendingTx(null);
    await act(tx, 'pending', `Queue ${tx.queue_no} moved to Pending.`, { reason: pendingReason.trim() });
    setPendingReason('');
  };

  const confirmRequeue = (tx) => setConfirmModal({
    title: `Return Queue ${tx.queue_no} to the queue?`,
    message: 'The client goes back to the shared waiting line, unassigned, so any window can call them.',
    confirmLabel: 'Return to Queue',
    onConfirm: () => act(tx, 'requeue', `Queue ${tx.queue_no} returned to the queue.`),
  });

  const myWindow = data.my_window;
  const activeTab = TABS.find(t => t.key === tab);
  const rows = data.results || [];

  const renderActions = (tx) => {
    const busy = busyId === tx.id;
    // Transferred clients can be started without a window; resuming a paused client needs one.
    const needsWindow = !myWindow && tx.status === 'pending';
    const startLabel = tx.status === 'transferred' ? 'Start' : 'Resume';
    return (
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {tx.status === 'serving' && (
          <>
            <button className="btn btn-success btn-sm" disabled={busy} onClick={() => act(tx, 'done', `Queue ${tx.queue_no} completed. The client can now answer the CSM survey.`)}>Done</button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => { setPendingReason(''); setPendingTx(tx); }}>Pending</button>
          </>
        )}
        {(tx.status === 'transferred' || tx.status === 'pending') && (
          <button className="btn btn-primary btn-sm" disabled={busy || needsWindow} title={needsWindow ? 'Take a window first' : undefined} onClick={() => startOrResume(tx)}>
            {startLabel}
          </button>
        )}
        {tx.status === 'pending' && (
          <button className="btn btn-success btn-sm" disabled={busy} onClick={() => act(tx, 'done', `Queue ${tx.queue_no} completed.`)}>Done</button>
        )}
        {tx.status !== 'done' && (
          <>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setReassignTx(tx)}>Reassign</button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => confirmRequeue(tx)}>Return to Queue</button>
          </>
        )}
        <button className="btn btn-outline btn-sm" onClick={() => setHistoryTxId(tx.id)}>View</button>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-ground)' }}>

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <PageHeader title="My Clients" subtitle="Your own workload. The shared waiting line is on the Queue page.">
          <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            {myWindow
              ? <>Working at <strong>{myWindow.name}</strong></>
              : <>Not at a window · <Link to="/staff/windows">Choose a window</Link> to start or resume clients</>}
          </div>
        </PageHeader>

        <div role="tablist" aria-label="My Clients" style={{ display: 'flex', gap: '0.4rem', borderBottom: '2px solid var(--border-color)', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {TABS.map(t => {
            const isActive = t.key === tab;
            const count = data.counts?.[t.key] ?? 0;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => { setTab(t.key); setLoading(true); }}
                style={{
                  padding: '0.65rem 1.1rem',
                  border: 'none',
                  borderBottom: `3px solid ${isActive ? 'var(--dole-blue)' : 'transparent'}`,
                  marginBottom: '-2px',
                  background: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '0.95rem',
                  fontWeight: isActive ? 800 : 600,
                  color: isActive ? 'var(--dole-blue)' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                }}
              >
                {t.label}
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  padding: '0.05rem 0.5rem',
                  borderRadius: 'var(--radius-full)',
                  background: isActive ? 'var(--dole-blue)' : '#e2e8f0',
                  color: isActive ? '#fff' : '#475569',
                }}>{count}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{activeTab.hint}</p>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search queue no., client, or service"
            aria-label="Search my clients"
            style={{ maxWidth: '320px', minHeight: '42px' }}
          />
        </div>

        <Notice notice={notice} onDismiss={() => setNotice(null)} />

        {loading && rows.length === 0 ? (
          <div className="staff-empty-card" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="staff-empty-card" style={{ color: 'var(--text-muted)' }}>
            {search ? 'No clients match your search.' : tab === 'ongoing'
              ? 'You have no ongoing clients. Call one from the Queue page.'
              : tab === 'pending' ? 'You have no pending clients.' : 'You have not completed any transactions yet.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {rows.map(tx => {
              const badge = STATUS_BADGE[tx.status] || { cls: 'badge', label: tx.status };
              return (
                <div key={tx.id} className="card" style={{
                  padding: '0.9rem 1.1rem',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
                  gap: '0.75rem',
                  alignItems: 'center',
                  borderLeft: tx.status === 'transferred' ? '5px solid var(--dole-gold)' : undefined,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '1.3rem', color: 'var(--dole-blue)' }}>{tx.queue_no}</strong>
                      <span className={badge.cls}>{badge.label}</span>
                      {tx.is_priority && <span className="badge badge-priority">Priority</span>}
                    </div>
                    <div style={{ marginTop: '0.25rem', fontWeight: 600 }}>{tx.client_name || <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>No name given</span>}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {tx.service_name}{tx.division_name ? ` · ${tx.division_name}` : ''}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {tx.transaction_no}
                      {tx.counter_name && tx.status === 'serving' ? ` · ${tx.counter_name}` : ''}
                      {' · '}
                      {tx.status === 'done'
                        ? `Completed ${formatDateTime(tx.done_at)}${tx.is_surveyed ? ' · CSM answered' : ''}`
                        : `Checked in ${formatDateTime(tx.checked_in_at)}`}
                    </div>
                  </div>
                  {renderActions(tx)}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <ReassignModal
        tx={reassignTx}
        onClose={() => setReassignTx(null)}
        onTransferred={(updated, person) => {
          setReassignTx(null);
          flash('success', `Queue ${updated.queue_no} transferred to ${person.name}.`);
          fetchData();
        }}
      />

      <TransactionHistoryModal txId={historyTxId} onClose={() => setHistoryTxId(null)} />

      <Modal isOpen={!!pendingTx} onClose={() => setPendingTx(null)} title={pendingTx ? `Move Queue ${pendingTx.queue_no} to Pending` : ''} maxWidth="460px">
        <form onSubmit={submitPending}>
          <label htmlFor="mc-pending-reason">Reason (optional)</label>
          <input id="mc-pending-reason" type="text" maxLength={255} value={pendingReason}
            onChange={(e) => setPendingReason(e.target.value)} placeholder="e.g. Waiting for requirements" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
            <button type="button" className="btn btn-outline" onClick={() => setPendingTx(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Move to Pending</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!confirmModal} onClose={() => setConfirmModal(null)} title={confirmModal?.title} maxWidth="440px">
        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{confirmModal?.message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem' }}>
          <button className="btn btn-outline" onClick={() => setConfirmModal(null)}>Back</button>
          <button className="btn btn-primary" onClick={() => { const action = confirmModal.onConfirm; setConfirmModal(null); action(); }}>
            {confirmModal?.confirmLabel}
          </button>
        </div>
      </Modal>
    </div>
  );
}
