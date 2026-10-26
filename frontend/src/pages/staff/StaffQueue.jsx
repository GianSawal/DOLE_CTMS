import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { staffApi } from '../../api/staff';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/Modal';
import PrintSlip from '../../components/PrintSlip';
import WalkinModal from '../../components/WalkinModal';
import ReassignModal from '../../components/ReassignModal';
import DoneModal from '../../components/DoneModal';
import ReferModal from '../../components/ReferModal';
import ArrivingReferrals from '../../components/ArrivingReferrals';
import { broadcastQueueCall } from '../../utils/airportChime';
import { PageHeader, Notice, NoteField, LatestNote, ConcernNote, ReferralNote } from '../../components/ui';

const POLL_MS = 3000;

const sectionTitle = {
  fontSize: '0.78rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  margin: '0 0 0.75rem',
};

const subTitle = {
  fontSize: '0.72rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#6d28d9',
  margin: '0.25rem 0 0.4rem',
};

function minutesSince(iso) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function formatMinutes(mins) {
  if (mins === null) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function DivisionTag({ name }) {
  if (!name) return null;
  return (
    <span style={{
      fontSize: '0.68rem',
      fontWeight: 700,
      padding: '0.1rem 0.45rem',
      borderRadius: 'var(--radius-full)',
      background: '#f1f5f9',
      color: '#475569',
      border: '1px solid #e2e8f0',
      whiteSpace: 'nowrap',
    }}>
      {name}
    </span>
  );
}

const WAITING_FILTER_KEY = 'ctms_waiting_filter';

function loadWaitingFilter() {
  try {
    const saved = JSON.parse(localStorage.getItem(WAITING_FILTER_KEY) || '{}');
    return { division: saved.division || '', service: saved.service || '' };
  } catch {
    return { division: '', service: '' };
  }
}

function ClientName({ tx }) {
  return (
    <span style={{ color: tx.client_name ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
      {tx.client_name || 'No name given'}
    </span>
  );
}

export default function StaffQueue() {
  const { user } = useAuth();
  // Stable reference, so effects that depend on it don't re-run every render
  const offices = useMemo(() => user?.assigned_offices || [], [user]);

  const [selectedOffice, setSelectedOffice] = useState(() => localStorage.getItem('ctms_staff_office') || '');
  const [queueData, setQueueData] = useState({ waiting: [], serving: [], pending: [], counters: [], my_window: null, my_current: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { type: 'error' | 'success', text }
  const [, setTick] = useState(0);

  const [showWalkin, setShowWalkin] = useState(false);
  const [printedTx, setPrintedTx] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, confirmLabel, danger, onConfirm }
  const [pendingTx, setPendingTx] = useState(null);
  const [doneTx, setDoneTx] = useState(null);
  const [pendingReason, setPendingReason] = useState('');
  const [reassignTx, setReassignTx] = useState(null);
  const [referTx, setReferTx] = useState(null);
  // View-only filter for the waiting list; remembered on this computer
  const [waitingFilter, setWaitingFilter] = useState(loadWaitingFilter);
  const [divisions, setDivisions] = useState([]);
  const [services, setServices] = useState([]);

  useEffect(() => {
    if (offices.length > 0 && !offices.some(o => String(o.id) === String(selectedOffice))) {
      setSelectedOffice(String(offices[0].id));
    }
  }, [offices, selectedOffice]);

  const fetchQueue = useCallback(async () => {
    if (!selectedOffice) return;
    try {
      const data = await staffApi.getQueue(selectedOffice);
      setQueueData(data);
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'Failed to load the queue.' });
    } finally {
      setLoading(false);
    }
  }, [selectedOffice]);

  useEffect(() => {
    setLoading(true);
    fetchQueue();
    const timer = setInterval(fetchQueue, POLL_MS);
    return () => clearInterval(timer);
  }, [fetchQueue]);

  useEffect(() => {
    staffApi.getDivisions().then(d => setDivisions(Array.isArray(d) ? d : [])).catch(() => {});
    staffApi.getServices().then(d => {
      const list = Array.isArray(d) ? d : (d?.results || []);
      setServices(list.filter(svc => svc.is_active));
    }).catch(() => {});
  }, []);

  const updateWaitingFilter = (next) => {
    setWaitingFilter(next);
    try { localStorage.setItem(WAITING_FILTER_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  // Keep "waiting for N min" labels fresh between polls
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const flash = (type, text) => {
    setNotice({ type, text });
    if (type === 'success') setTimeout(() => setNotice(curr => (curr?.text === text ? null : curr)), 4000);
  };

  const announce = (tx, action) => {
    // Reassigned clients are handled off the TV board
    if (!tx || tx.was_transferred) return;
    broadcastQueueCall({
      officeId: selectedOffice,
      txId: tx.id,
      queueNo: tx.queue_no,
      // Clients served without a window are announced with the personnel's name
      counter: tx.counter_name || tx.assigned_to_name || tx.assigned_personnel || '',
      personnel: tx.assigned_to_name || tx.assigned_personnel || '',
      action,
    });
  };

  const run = async (fn, successText) => {
    try {
      setBusy(true);
      const result = await fn();
      if (successText) flash('success', typeof successText === 'function' ? successText(result) : successText);
      await fetchQueue();
      return result;
    } catch (err) {
      flash('error', err.message || 'Action failed.');
      await fetchQueue();
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleCallNext = () => run(async () => {
    const tx = await staffApi.callNext(selectedOffice);
    if (!tx) throw new Error('No waiting clients in the queue.');
    announce(tx, 'call_next');
    return tx;
  }, tx => `Queue ${tx.queue_no} called to ${tx.counter_name}.`);

  const handleCall = (tx, action = 'call') => run(async () => {
    const res = await staffApi.transactionAction(tx.id, action);
    announce(res, action);
    return res;
  }, res => (action === 'recall'
    ? `Queue ${res.queue_no} announced again.`
    : res.counter_name && !res.was_transferred ? `Queue ${res.queue_no} called to ${res.counter_name}.` : `You are now serving Queue ${res.queue_no}.`));

  const act = (tx, action, successText, payload) =>
    run(() => staffApi.transactionAction(tx.id, action, payload), successText);

  // The client may have no phone: hand them the new queue slip (same survey code as their first slip)
  const markArrived = (ref) => run(async () => {
    const tx = await staffApi.markReferralArrived(ref.id);
    setPrintedTx(tx);
    return tx;
  }, tx => `${ref.client_name || 'The referred client'} joined the line as Queue ${tx.queue_no}. Hand them the new slip.`);

  const confirmThen = (title, message, confirmLabel, onConfirm, danger = true) =>
    setConfirmModal({ title, message, confirmLabel, onConfirm, danger });

  const submitPending = async (e) => {
    e.preventDefault();
    const tx = pendingTx;
    setPendingTx(null);
    await act(tx, 'pending', `Queue ${tx.queue_no} moved to Pending.`, { reason: pendingReason.trim() });
    setPendingReason('');
  };

  const handleOfficeChange = (e) => {
    setSelectedOffice(e.target.value);
    localStorage.setItem('ctms_staff_office', e.target.value);
  };

  const myWindow = queueData.my_window;
  const myCurrent = queueData.my_current;
  const waiting = queueData.waiting || [];

  // Services that belong to the chosen division ('none' = services with no division)
  const inDivision = (divisionId) => {
    if (!waitingFilter.division) return true;
    if (waitingFilter.division === 'none') return !divisionId;
    return String(divisionId) === String(waitingFilter.division);
  };
  const serviceOptions = services.filter(svc => inDivision(svc.division));
  const waitingFiltered = Boolean(waitingFilter.division || waitingFilter.service);
  // Keep each ticket's real place in the full line (#3 stays #3 when filtered)
  const matchesFilter = (tx) => inDivision(tx.division_id)
    && (!waitingFilter.service || String(tx.service) === String(waitingFilter.service));
  // Clients referred from another office are listed in their own card; both are the same line
  const line = waiting.map((tx, idx) => ({ tx, position: idx + 1 }));
  const referredWaiting = line.filter(({ tx }) => tx.referred_from);
  const ownWaitingCount = waiting.length - referredWaiting.length;
  const visibleWaiting = line.filter(({ tx }) => !tx.referred_from && matchesFilter(tx));
  // Referred here but still travelling: not in the line until they arrive
  const expectedReferrals = queueData.expected_referrals || [];
  const referredTotal = expectedReferrals.length + referredWaiting.length;
  const othersServing = (queueData.serving || []).filter(tx => !myCurrent || tx.id !== myCurrent.id);
  const pendingList = queueData.pending || [];
  const officeName = queueData.office?.name || offices.find(o => String(o.id) === String(selectedOffice))?.name || '';

  const canCall = Boolean(myWindow) && !myCurrent && !busy;
  const callBlockedReason = !myWindow
    ? 'Take a window first.'
    : myCurrent
      ? `Finish Queue ${myCurrent.queue_no} first.`
      : waiting.length === 0
        ? 'Nobody is waiting.'
        : '';

  // One ticket in the waiting line; #position is its place in the whole line
  const renderWaitingRow = ({ tx, position }) => (
    <li key={tx.id} className="queue-waiting-row" style={{
      border: position === 1 ? '2px solid var(--dole-blue)' : 'var(--border-hairline)',
      background: position === 1 ? 'var(--dole-blue-subtle)' : '#fff',
      borderRadius: 'var(--radius-md)',
      padding: '0.7rem 0.9rem',
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: '0.75rem',
      alignItems: 'center',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>#{position}</span>
          <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', color: 'var(--text-primary)' }}>{tx.queue_no}</strong>
          {tx.is_priority && <span className="badge badge-priority">Priority</span>}
          <DivisionTag name={tx.division_name} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>waiting {formatMinutes(minutesSince(tx.checked_in_at))}</span>
        </div>
        <div style={{ fontSize: '0.85rem', marginTop: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <ClientName tx={tx} /> · <span style={{ color: 'var(--text-secondary)' }}>{tx.service_name}</span>
        </div>
        <ReferralNote tx={tx} />
        <ConcernNote text={tx.concern_note} />
      </div>
      <div className="queue-waiting-actions" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary btn-sm" disabled={!canCall} title={callBlockedReason || undefined} onClick={() => handleCall(tx)}>Call</button>
        <button className="btn btn-outline btn-sm" disabled={busy}
          onClick={() => confirmThen(`Cancel Queue ${tx.queue_no}?`,
            'The ticket leaves the queue and is recorded as cancelled.',
            'Cancel Ticket', () => act(tx, 'cancel', `Queue ${tx.queue_no} cancelled.`))}>
          Cancel
        </button>
        <button className="btn btn-outline btn-sm" style={{ color: 'var(--dole-red-dark)' }} disabled={busy}
          onClick={() => confirmThen(`Delete Queue ${tx.queue_no}?`,
            'Only for duplicate or mistaken tickets. This permanently removes the ticket.',
            'Delete Ticket', () => act(tx, 'delete', `Queue ${tx.queue_no} deleted.`))}>
          Delete
        </button>
      </div>
    </li>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-ground)' }}>

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        <PageHeader title="Queue" subtitle={<>{officeName ? `${officeName} — ` : ''}one shared line for every window in this office.</>}>
          {offices.length > 1 && (
              <select value={selectedOffice} onChange={handleOfficeChange} className="staff-custom-select" style={{ minWidth: '240px' }} aria-label="Office">
                {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <button className="btn btn-outline" onClick={() => setShowWalkin(true)} disabled={!selectedOffice} style={{ minHeight: '44px' }}>
              + Walk-in Registration
            </button>
        </PageHeader>

        {/* Console */}
        <div className="card" style={{
          padding: '1.1rem 1.25rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1.25rem',
          flexWrap: 'wrap',
          borderLeft: `5px solid ${myWindow ? 'var(--dole-gold)' : 'var(--dole-red)'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <div style={sectionTitle}>Your Window</div>
              {myWindow ? (
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)' }}>{myWindow.name}</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--dole-red-dark)' }}>Not at a window</span>
                  <Link to="/staff/windows" className="btn btn-sm btn-outline">Choose a window</Link>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className="staff-stat-pill staff-stat-pill-blue">{waiting.length} waiting</span>
              <span className="staff-stat-pill staff-stat-pill-green">{(queueData.serving || []).length} being served</span>
              <span className="staff-stat-pill staff-stat-pill-amber">{pendingList.length} pending</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleCallNext}
              disabled={!canCall || waiting.length === 0}
              style={{ minWidth: '200px' }}
            >
              Call Next Client
            </button>
            {callBlockedReason && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{callBlockedReason}</span>}
          </div>
        </div>

        <Notice notice={notice} onDismiss={() => setNotice(null)} />

        {loading ? (
          <div className="staff-empty-card" style={{ color: 'var(--text-muted)' }}>Loading queue…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: '1.25rem', alignItems: 'start' }}>
            {/* Left: my work */}
            <div style={{ display: 'grid', gap: '1.25rem' }}>
              <section className="card" style={{ borderTop: '5px solid var(--dole-blue)' }}>
                <h2 style={sectionTitle}>My Current Client</h2>
                {myCurrent ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '2.6rem', fontWeight: 800, color: 'var(--dole-blue)', lineHeight: 1 }}>{myCurrent.queue_no}</span>
                      {myCurrent.is_priority && <span className="badge badge-priority">Priority</span>}
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        {myCurrent.counter_name ? `at ${myCurrent.counter_name} · ` : 'no window · '}{formatMinutes(minutesSince(myCurrent.started_at))}
                      </span>
                    </div>
                    <div style={{ marginTop: '0.6rem', fontWeight: 700, fontSize: '1.05rem' }}><ClientName tx={myCurrent} /></div>
                    {myCurrent.group_member_names?.length > 0 && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        Members: {myCurrent.group_member_names.join(', ')}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{myCurrent.service_name}</span>
                      <DivisionTag name={myCurrent.division_name} />
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                      {myCurrent.transaction_no} · Survey code {myCurrent.claim_code}
                    </div>
                    <ReferralNote tx={myCurrent} />
                    <LatestNote note={myCurrent.latest_note} />
                    <ConcernNote text={myCurrent.concern_note} />

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', marginTop: '1.1rem' }}>
                      <button className="btn btn-success" disabled={busy}
                        onClick={() => setDoneTx(myCurrent)}>
                        Done
                      </button>
                      {!myCurrent.was_transferred && (
                        <button className="btn btn-outline" disabled={busy} onClick={() => handleCall(myCurrent, 'recall')}>Recall on TV</button>
                      )}
                      <button className="btn btn-outline" disabled={busy} onClick={() => { setPendingReason(''); setPendingTx(myCurrent); }}>Pending</button>
                      <button className="btn btn-outline" disabled={busy} onClick={() => setReassignTx(myCurrent)}>Reassign</button>
                      <button className="btn btn-outline" disabled={busy} onClick={() => setReferTx(myCurrent)}>Refer to Office</button>
                      <button className="btn btn-outline" disabled={busy}
                        onClick={() => confirmThen(`Return Queue ${myCurrent.queue_no} to the queue?`,
                          'The client goes back to the shared waiting line, unassigned, so any window can call them.',
                          'Return to Queue', () => act(myCurrent, 'requeue', `Queue ${myCurrent.queue_no} returned to the queue.`), false)}>
                        Return to Queue
                      </button>
                      <button className="btn btn-outline" style={{ color: 'var(--dole-red-dark)' }} disabled={busy}
                        onClick={() => confirmThen(`Mark Queue ${myCurrent.queue_no} as no-show?`,
                          'Use this when the client did not come to your window after being called.',
                          'Mark No-show', () => act(myCurrent, 'no-show', `Queue ${myCurrent.queue_no} marked as no-show.`))}>
                        No-show
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                    {myWindow ? 'You are not serving anyone. Press Call Next Client, or call a specific ticket from the waiting list.' : 'Take a window to start serving clients.'}
                  </p>
                )}
              </section>

              {pendingList.length > 0 && (
                <section className="card">
                  <h2 style={sectionTitle}>My Pending &amp; Transferred</h2>
                  <div style={{ display: 'grid', gap: '0.6rem' }}>
                    {pendingList.map(tx => (
                      <div key={tx.id} style={{ border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)', padding: '0.75rem 0.9rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem' }}>{tx.queue_no}</strong>
                            <span className={tx.status === 'transferred' ? 'badge badge-serving' : 'badge badge-pending'}>
                              {tx.status === 'transferred' ? 'Transferred – not started' : 'Pending'}
                            </span>
                            {!tx.assigned_to && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(no handler yet)</span>}
                          </div>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{tx.transaction_no}</span>
                        </div>
                        <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}><ClientName tx={tx} /> · {tx.service_name}</div>
                        <ReferralNote tx={tx} />
                        <LatestNote note={tx.latest_note} />
                        <ConcernNote text={tx.concern_note} />
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                          {tx.status === 'transferred' ? (
                            <button className="btn btn-primary btn-sm" disabled={busy || !!myCurrent}
                              title={myCurrent ? `Finish Queue ${myCurrent.queue_no} first.` : undefined} onClick={() => handleCall(tx)}>
                              Start
                            </button>
                          ) : (
                            <button className="btn btn-primary btn-sm"
                              disabled={tx.was_transferred ? (busy || !!myCurrent) : !canCall}
                              title={(tx.was_transferred ? (myCurrent ? `Finish Queue ${myCurrent.queue_no} first.` : '') : callBlockedReason) || undefined}
                              onClick={() => handleCall(tx)}>
                              Resume
                            </button>
                          )}
                          {tx.status === 'pending' && (
                            <button className="btn btn-success btn-sm" disabled={busy} onClick={() => setDoneTx(tx)}>Done</button>
                          )}
                          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setReassignTx(tx)}>Reassign</button>
                          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setReferTx(tx)}>Refer to Office</button>
                          <button className="btn btn-outline btn-sm" disabled={busy}
                            onClick={() => confirmThen(`Return Queue ${tx.queue_no} to the queue?`,
                              'The client goes back to the shared waiting line, unassigned.',
                              'Return to Queue', () => act(tx, 'requeue', `Queue ${tx.queue_no} returned to the queue.`), false)}>
                            Return to Queue
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="card">
                <h2 style={sectionTitle}>Now Serving in This Office</h2>
                {othersServing.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>No other window is serving a client.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    {othersServing.map(tx => (
                      <div key={tx.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, auto) auto 1fr', gap: '0.75rem', alignItems: 'center', padding: '0.5rem 0', borderBottom: 'var(--border-hairline)' }}>
                        <strong style={{ fontSize: '0.9rem' }}>{tx.counter_name || '—'}</strong>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--dole-blue)' }}>{tx.queue_no}</span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tx.assigned_to_name || tx.assigned_personnel || 'Unassigned'} · {tx.service_name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Right: shared waiting line, with clients referred from other offices listed apart */}
            <div style={{ display: 'grid', gap: '1.25rem' }}>
              <section className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                  <h2 style={sectionTitle}>Waiting Queue</h2>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Priority first, then first come, first served</span>
                </div>

                {/* View filter: show only tickets for one division and/or service */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', marginBottom: '0.6rem' }}>
                  <select
                    aria-label="Filter waiting list by division"
                    value={waitingFilter.division}
                    onChange={(e) => {
                      const division = e.target.value;
                      // Drop a chosen service that isn't in the new division
                      const svc = services.find(x => String(x.id) === String(waitingFilter.service));
                      const keep = svc && (!division || (division === 'none' ? !svc.division : String(svc.division) === division));
                      updateWaitingFilter({ division, service: keep ? waitingFilter.service : '' });
                    }}
                    style={{ minHeight: '38px' }}
                  >
                    <option value="">All divisions</option>
                    {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    <option value="none">No division</option>
                  </select>
                  <select
                    aria-label="Filter waiting list by service"
                    value={waitingFilter.service}
                    onChange={(e) => updateWaitingFilter({ ...waitingFilter, service: e.target.value })}
                    style={{ minHeight: '38px' }}
                  >
                    <option value="">All services</option>
                    {serviceOptions.map(svc => <option key={svc.id} value={svc.id}>{svc.name}</option>)}
                  </select>
                </div>
                {waitingFiltered && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
                    fontSize: '0.8rem', color: 'var(--text-secondary)', background: '#f8fafc',
                    border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)', padding: '0.45rem 0.7rem', marginBottom: '0.6rem',
                  }}>
                    <span>
                      Showing <strong>{visibleWaiting.length}</strong> of {ownWaitingCount} waiting.
                      {' '}<span style={{ color: 'var(--text-muted)' }}>Call Next Client still calls #1 in the whole line; use Call on a ticket below to serve this filter.</span>
                    </span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => updateWaitingFilter({ division: '', service: '' })}>
                      Clear filter
                    </button>
                  </div>
                )}

                {ownWaitingCount === 0 ? (
                  <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Nobody is waiting right now.</div>
                ) : visibleWaiting.length === 0 ? (
                  <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Nobody is waiting for this {waitingFilter.service ? 'service' : 'division'} right now.
                  </div>
                ) : (
                  <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
                    {visibleWaiting.map(renderWaitingRow)}
                  </ol>
                )}
              </section>

              <section className="card" style={{ borderTop: '5px solid #6d28d9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h2 style={{ ...sectionTitle, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    Referred Clients
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 800, padding: '0.05rem 0.5rem', borderRadius: 'var(--radius-full)',
                      background: referredTotal > 0 ? '#6d28d9' : '#e2e8f0',
                      color: referredTotal > 0 ? '#fff' : '#475569',
                    }}>{referredTotal}</span>
                  </h2>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Sent here by other offices</span>
                </div>

                <h3 style={subTitle}>On the way · {expectedReferrals.length}</h3>
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Not in the line yet, so they can't be called. They join it when they scan this office's check-in QR,
                  or when you press Arrived (e.g. they show their first slip). Arrived prints their new queue slip.
                </p>
                <ArrivingReferrals referrals={expectedReferrals} busy={busy} onArrived={markArrived} />

                <h3 style={{ ...subTitle, marginTop: '1rem' }}>Arrived · in line · {referredWaiting.length}</h3>
                {referredWaiting.length === 0 ? (
                  <div style={{ padding: '0.75rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>No referred clients are waiting.</div>
                ) : (
                  <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
                    {referredWaiting.map(renderWaitingRow)}
                  </ol>
                )}
              </section>
            </div>
          </div>
        )}
      </main>

      <WalkinModal
        isOpen={showWalkin}
        onClose={() => setShowWalkin(false)}
        officeId={selectedOffice}
        onCreated={(tx) => { setShowWalkin(false); setPrintedTx(tx); fetchQueue(); }}
      />

      <ReassignModal
        tx={reassignTx}
        onClose={() => setReassignTx(null)}
        onTransferred={(updated, person) => {
          setReassignTx(null);
          flash('success', `Queue ${updated.queue_no} transferred to ${person.name}.`);
          fetchQueue();
        }}
      />

      <ReferModal
        tx={referTx}
        onClose={() => setReferTx(null)}
        onReferred={(updated) => {
          setReferTx(null);
          flash('success', `Queue ${updated.queue_no} referred to ${updated.referred_to?.office_name || 'the other office'}. `
            + 'The client joins their line on arrival.');
          fetchQueue();
        }}
      />

      <Modal isOpen={!!printedTx} onClose={() => setPrintedTx(null)} title="Queue Slip">
        <PrintSlip transaction={printedTx} onClose={() => setPrintedTx(null)} />
      </Modal>

      <DoneModal
        tx={doneTx}
        onClose={() => setDoneTx(null)}
        onConfirm={(remarks) => {
          const tx = doneTx;
          setDoneTx(null);
          act(tx, 'done', `Queue ${tx.queue_no} completed. The client can now answer the CSM survey.`, { reason: remarks });
        }}
      />

      <Modal isOpen={!!pendingTx} onClose={() => setPendingTx(null)} title={pendingTx ? `Move Queue ${pendingTx.queue_no} to Pending` : ''} maxWidth="460px">
        <form onSubmit={submitPending}>
          <p style={{ marginTop: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            The client stays with you and appears under My Pending. Resume when they are ready.
          </p>
          <NoteField
            id="pending-reason"
            value={pendingReason}
            onChange={setPendingReason}
            placeholder="Why is this client on pending? e.g. Waiting for the business permit copy"
          />
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
          <button
            className={confirmModal?.danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => { const action = confirmModal.onConfirm; setConfirmModal(null); action(); }}
          >
            {confirmModal?.confirmLabel}
          </button>
        </div>
      </Modal>
    </div>
  );
}
