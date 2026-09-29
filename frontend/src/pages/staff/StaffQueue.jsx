import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { staffApi } from '../../api/staff';
import { publicApi } from '../../api/public';
import { useAuth } from '../../context/AuthContext';
import Navbar from '../../components/Navbar';
import Modal from '../../components/Modal';
import PrintSlip from '../../components/PrintSlip';
import SearchableServiceSelect from '../../components/SearchableServiceSelect';
import SearchablePersonnelSelect from '../../components/SearchablePersonnelSelect';
import { broadcastQueueCall } from '../../utils/airportChime';

export default function StaffQueue() {
  const { user } = useAuth();

  const [selectedOffice, setSelectedOffice] = useState(() => localStorage.getItem('ctms_staff_office') || '');
  const [selectedCounter, setSelectedCounter] = useState(() => localStorage.getItem('ctms_staff_counter') || '');

  const [queueData, setQueueData] = useState({ waiting: [], serving: [], counters: [], office: null });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  // Walk-in modal state
  const [showWalkinModal, setShowWalkinModal] = useState(false);
  const [officeServices, setOfficeServices] = useState([]);
  const [walkinService, setWalkinService] = useState('');
  const [walkinName, setWalkinName] = useState('');
  const [walkinPriority, setWalkinPriority] = useState(false);
  const [walkinIsGroup, setWalkinIsGroup] = useState(false);
  const [walkinRepName, setWalkinRepName] = useState('');
  const [walkinGroupSize, setWalkinGroupSize] = useState('2');

  // Slip modal state
  const [printedTx, setPrintedTx] = useState(null);

  // Personnel assignment modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTx, setAssignTx] = useState(null);
  const [assignPersonnelName, setAssignPersonnelName] = useState('');
  const [officePersonnel, setOfficePersonnel] = useState([]);
  const [recentPersonnel, setRecentPersonnel] = useState(() => {
    try {
      const saved = localStorage.getItem('ctms_recent_personnel');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Strict RBAC: Ensure selectedOffice is ALWAYS an office assigned to this user
  useEffect(() => {
    if (user?.assigned_offices?.length > 0) {
      const isAssigned = user.assigned_offices.some(o => String(o.id) === String(selectedOffice));
      if (!selectedOffice || !isAssigned) {
        const firstId = String(user.assigned_offices[0].id);
        setSelectedOffice(firstId);
        localStorage.setItem('ctms_staff_office', firstId);
      }
    }
  }, [user, selectedOffice]);

  // Auto-select first counter if none chosen or counter is invalid
  useEffect(() => {
    if (queueData.counters?.length > 0) {
      const saved = localStorage.getItem('ctms_staff_counter');
      if (saved === '') {
        return;
      }
      const hasValid = queueData.counters.some(c => String(c.id) === String(selectedCounter));
      if (!selectedCounter || !hasValid) {
        const firstId = String(queueData.counters[0].id);
        setSelectedCounter(firstId);
        localStorage.setItem('ctms_staff_counter', firstId);
      }
    }
  }, [queueData.counters, selectedCounter]);

  // Persist selections
  const handleOfficeChange = (e) => {
    const val = e.target.value;
    setSelectedOffice(val);
    localStorage.setItem('ctms_staff_office', val);
    setSelectedCounter('');
    localStorage.removeItem('ctms_staff_counter');
  };

  const handleCounterChange = (e) => {
    const val = e.target.value;
    setSelectedCounter(val);
    localStorage.setItem('ctms_staff_counter', val);
  };

  // Fetch queue data
  const fetchQueue = useCallback(async () => {
    if (!selectedOffice) return;
    try {
      const data = await staffApi.getQueue(selectedOffice, selectedCounter);
      setQueueData(data);
      setError('');
    } catch (err) {
      setError(err.message || 'Error loading queue.');
    } finally {
      setLoading(false);
    }
  }, [selectedOffice, selectedCounter]);

  // Polling every 3 seconds (mandated by §1 hard requirements)
  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  // Fetch office services for walkin registration
  useEffect(() => {
    if (showWalkinModal && selectedOffice) {
      publicApi.getOfficeDetail(selectedOffice)
        .then(res => setOfficeServices(res.services || []))
        .catch(() => {});
    }
  }, [showWalkinModal, selectedOffice]);

  // Next waiting client according to priority ordering
  const nextWaitingClient = queueData.waiting && queueData.waiting.length > 0
    ? [...queueData.waiting].sort((a, b) => {
        if (a.is_priority !== b.is_priority) return a.is_priority ? -1 : 1;
        return new Date(a.checked_in_at) - new Date(b.checked_in_at);
      })[0]
    : null;

  const isNextClientAssigned = Boolean(nextWaitingClient?.assigned_personnel && nextWaitingClient.assigned_personnel.trim());

  // Helper to normalize division names
  const normalizeDiv = (name) => (name || '').toUpperCase().replace(/\s+/g, '');

  // Fetch registered personnel for the selected office
  useEffect(() => {
    if (selectedOffice) {
      staffApi.getPersonnel({ office: selectedOffice, active_only: 'true' })
        .then(data => setOfficePersonnel(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [selectedOffice]);

  // Filter walk-in services to staff's division(s) if not superuser
  const filteredOfficeServices = useMemo(() => {
    if (!officeServices || officeServices.length === 0) return [];
    if (user?.is_superuser || !user?.assigned_divisions || user.assigned_divisions.length === 0) {
      return officeServices;
    }
    const staffDivisionNorms = user.assigned_divisions.map(d => normalizeDiv(d.name));
    const staffDivisionIds = user.assigned_divisions.map(d => d.id);
    return officeServices.filter(svc => {
      if (svc.division && staffDivisionIds.includes(svc.division)) return true;
      if (svc.division_name) {
        const norm = normalizeDiv(svc.division_name);
        if (staffDivisionNorms.includes(norm) || norm === 'ALL') return true;
      }
      return false;
    });
  }, [officeServices, user]);

  // For the current transaction: separate eligible personnel (same division) vs ineligible
  const txDivNorm = normalizeDiv(assignTx?.division_name);

  const eligiblePersonnel = useMemo(() => {
    if (!txDivNorm) return officePersonnel;
    return officePersonnel.filter(p => {
      const divs = (p.division_names || []).map(normalizeDiv);
      return divs.includes(txDivNorm) || divs.includes('ALL');
    });
  }, [officePersonnel, txDivNorm]);

  const ineligiblePersonnel = useMemo(() => {
    if (!txDivNorm) return [];
    return officePersonnel.filter(p => {
      const divs = (p.division_names || []).map(normalizeDiv);
      return !divs.includes(txDivNorm) && !divs.includes('ALL');
    });
  }, [officePersonnel, txDivNorm]);

  // Check if currently selected / typed name matches an ineligible personnel
  const matchedIneligible = useMemo(() => {
    if (!assignPersonnelName.trim() || ineligiblePersonnel.length === 0) return null;
    const clean = assignPersonnelName.toLowerCase().trim();
    return ineligiblePersonnel.find(
      p => p.full_name?.toLowerCase().trim() === clean ||
           p.employee_id?.toLowerCase().trim() === clean
    );
  }, [assignPersonnelName, ineligiblePersonnel]);

  const currentCounter = queueData.counters?.find(c => String(c.id) === String(selectedCounter));
  const currentCounterName = currentCounter ? currentCounter.name : null;

  const handleOpenAssignModal = (tx) => {
    setAssignTx(tx);
    if (selectedOffice) {
      staffApi.getPersonnel({ office: selectedOffice, active_only: 'true' })
        .then(data => setOfficePersonnel(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
    const txDiv = normalizeDiv(tx?.division_name);
    const loggedInUserDivs = (user?.assigned_divisions || []).map(d => normalizeDiv(d.name));
    const canUserSelfAssign = user?.is_superuser || !txDiv || loggedInUserDivs.includes(txDiv);

    const defaultName = tx?.assigned_personnel || (
      canUserSelfAssign
        ? (user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : (user?.username || ''))
        : ''
    );
    setAssignPersonnelName(defaultName);
    setShowAssignModal(true);
  };

  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    if (!assignTx || !assignPersonnelName.trim()) return;

    if (matchedIneligible) {
      setError(`Cannot assign ${matchedIneligible.full_name}: assigned to ${matchedIneligible.division_names.join(', ')} and cannot be assigned to ${assignTx.division_name || 'other'} division services.`);
      return;
    }

    try {
      setActionLoading(true);
      setError('');
      const cleanName = assignPersonnelName.trim();
      await staffApi.assignPersonnel(assignTx.id, cleanName);

      // Save to recent personnel list in localStorage
      const updatedRecent = Array.from(new Set([cleanName, ...recentPersonnel])).slice(0, 8);
      setRecentPersonnel(updatedRecent);
      localStorage.setItem('ctms_recent_personnel', JSON.stringify(updatedRecent));

      setShowAssignModal(false);
      setAssignTx(null);
      await fetchQueue();
    } catch (err) {
      setError(err.message || 'Failed to assign personnel.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteRecentPersonnel = (nameToDelete, e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const updated = recentPersonnel.filter(n => n !== nameToDelete);
    setRecentPersonnel(updated);
    try {
      localStorage.setItem('ctms_recent_personnel', JSON.stringify(updated));
    } catch {}
  };

  // Actions
  const handleCallNext = async () => {
    if (!selectedOffice) {
      setError('Please select an Office first.');
      return;
    }
    if (!nextWaitingClient) {
      setError('No waiting clients currently in the queue.');
      return;
    }
    if (!isNextClientAssigned) {
      setError(`Cannot call next client (${nextWaitingClient.queue_no}): Help desk officer must assign a personnel first.`);
      handleOpenAssignModal(nextWaitingClient);
      return;
    }

    const counterToUse = selectedCounter || (queueData.counters?.length > 0 ? String(queueData.counters[0].id) : null);
    if (!counterToUse) {
      setError('No window counters available for this office. Please set up a counter first.');
      return;
    }
    if (!selectedCounter && counterToUse) {
      setSelectedCounter(counterToUse);
      localStorage.setItem('ctms_staff_counter', counterToUse);
    }

    try {
      setActionLoading(true);
      setError('');
      const called = await staffApi.callNext(selectedOffice, counterToUse, nextWaitingClient.assigned_personnel);
      if (!called) {
        setError('No waiting clients currently in the queue.');
      } else {
        broadcastQueueCall({
          officeId: selectedOffice,
          queueNo: called.queue_no,
          counter: called.counter_name,
          personnel: called.assigned_personnel || nextWaitingClient.assigned_personnel,
          action: 'call_next',
        });
        await fetchQueue();
      }
    } catch (err) {
      setError(err.message || 'Failed to call next client.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCallSpecific = async (tx) => {
    if (!tx.assigned_personnel || !tx.assigned_personnel.trim()) {
      setError(`Cannot call Queue ${tx.queue_no}: Help desk officer must assign a personnel first.`);
      handleOpenAssignModal(tx);
      return;
    }

    const counterToUse = selectedCounter || (queueData.counters?.length > 0 ? String(queueData.counters[0].id) : null);
    if (!counterToUse) {
      setError('No window counters available. Please select or add a counter.');
      return;
    }
    if (!selectedCounter && counterToUse) {
      setSelectedCounter(counterToUse);
      localStorage.setItem('ctms_staff_counter', counterToUse);
    }
    await handleAction(tx.id, 'call', { counter: counterToUse, personnel: tx.assigned_personnel });
  };

  const handleAction = async (txId, action, payload = {}) => {
    try {
      setActionLoading(true);
      setError('');
      const res = await staffApi.transactionAction(txId, action, payload);
      if (action === 'call' || action === 'recall') {
        broadcastQueueCall({
          officeId: selectedOffice,
          txId,
          queueNo: res?.queue_no,
          counter: res?.counter_name,
          personnel: res?.assigned_personnel || payload.personnel || '',
          action,
        });
      }
      await fetchQueue();
    } catch (err) {
      setError(err.message || `Failed to perform ${action}.`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleWalkinSubmit = async (e) => {
    e.preventDefault();
    if (!walkinService) return;

    let finalClientName = '';
    if (walkinIsGroup) {
      const parsedSize = parseInt(walkinGroupSize, 10);
      const count = isNaN(parsedSize) || parsedSize < 2 ? 2 : parsedSize;
      const rep = (walkinRepName.trim().toLowerCase() === 'anonymous' || !walkinRepName.trim()) 
        ? 'Anonymous' 
        : walkinRepName.trim();
      finalClientName = `${rep} (Group of ${count})`;
    } else {
      finalClientName = walkinName;
    }

    try {
      setActionLoading(true);
      setError('');
      const newTx = await staffApi.createWalkin({
        office: Number(selectedOffice),
        service: Number(walkinService),
        client_name: finalClientName,
        is_priority: walkinPriority,
      });
      setShowWalkinModal(false);
      setWalkinName('');
      setWalkinService('');
      setWalkinPriority(false);
      setWalkinIsGroup(false);
      setWalkinRepName('');
      setWalkinGroupSize('2');
      setPrintedTx(newTx);
      await fetchQueue();
    } catch (err) {
      setError(err.message || 'Failed to register walk-in.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        {/* Top Control Bar: Office & Counter Selectors + Call Next + Walkin */}
        <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem 1.5rem' }}>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem' }}>Assigned Office</label>
                {user?.assigned_offices?.length === 1 && !user?.is_superuser ? (
                  <div style={{
                    minWidth: '240px',
                    minHeight: '44px',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 0.875rem',
                    backgroundColor: 'rgba(3, 5, 186, 0.05)',
                    border: '1px solid rgba(3, 5, 186, 0.2)',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 700,
                    color: 'var(--dole-blue)',
                    fontSize: '0.92rem',
                  }}>
                    🔒 {user.assigned_offices[0].name} ({user.assigned_offices[0].code})
                  </div>
                ) : (
                  <select
                    value={selectedOffice}
                    onChange={handleOfficeChange}
                    style={{ minWidth: '240px', minHeight: '44px' }}
                  >
                    {user?.assigned_offices?.map(off => (
                      <option key={off.id} value={off.id}>{off.name} ({off.code})</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label style={{ fontSize: '0.8rem' }}>Your Counter / Window</label>
                <select
                  value={selectedCounter}
                  onChange={handleCounterChange}
                  style={{ minWidth: '200px', minHeight: '44px' }}
                >
                  <option value="">-- All Counters / Divisions --</option>
                  {queueData.counters?.map(cnt => (
                    <option key={cnt.id} value={cnt.id}>{cnt.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowWalkinModal(true)}
                className="btn btn-outline"
                style={{ minHeight: '46px' }}
              >
                ➕ Walk-in Registration
              </button>

              {nextWaitingClient && !isNextClientAssigned && (
                <button
                  type="button"
                  onClick={() => handleOpenAssignModal(nextWaitingClient)}
                  className="btn btn-sm"
                  style={{
                    minHeight: '46px',
                    backgroundColor: '#fffbeb',
                    color: '#92400e',
                    border: '2px solid #f59e0b',
                    fontWeight: 700,
                    padding: '0.5rem 0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                  title="Assign personnel to enable Call Next Client"
                >
                  <span>⚠️ Next: {nextWaitingClient.queue_no}</span>
                  <span style={{ textDecoration: 'underline' }}>Assign Personnel</span>
                </button>
              )}

              <button
                onClick={handleCallNext}
                disabled={actionLoading || !nextWaitingClient || !isNextClientAssigned}
                className="btn btn-primary btn-lg"
                style={{
                  minHeight: '46px',
                  fontWeight: 800,
                  padding: '0.75rem 1.75rem',
                  opacity: (!nextWaitingClient || !isNextClientAssigned) ? 0.45 : 1,
                  cursor: (!nextWaitingClient || !isNextClientAssigned) ? 'not-allowed' : 'pointer',
                }}
                title={
                  !nextWaitingClient
                    ? 'No waiting clients in queue'
                    : !isNextClientAssigned
                    ? `Assign a personnel to ticket ${nextWaitingClient.queue_no} before calling next client`
                    : `Call next client (${nextWaitingClient.queue_no})`
                }
              >
                {actionLoading ? 'Calling...' : '📢 Call Next Client'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div style={{
            backgroundColor: 'var(--dole-red-light)',
            border: '1px solid #fecaca',
            color: 'var(--dole-red)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            fontSize: '0.9rem',
          }}>
            {error}
          </div>
        )}

        {/* 2-Column Split: Currently Serving vs Waiting Queue */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.3fr 1fr',
          gap: '1.5rem',
        }}>
          {/* Currently Serving Column */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}>
                🔔 Now Serving ({queueData.serving?.length || 0})
                {currentCounterName && (
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--dole-blue)', marginLeft: '0.5rem' }}>
                    · {currentCounterName}
                  </span>
                )}
              </h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {queueData.serving?.length > 0 ? (
                queueData.serving.map(tx => (
                  <div key={tx.id} className="card" style={{
                    borderLeft: '6px solid var(--dole-blue)',
                    padding: '1.25rem',
                  }}>
                    <div className="flex justify-between items-center" style={{ marginBottom: '0.5rem' }}>
                      <div className="flex items-center gap-2">
                        <span className="mono" style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--dole-blue)' }}>
                          {tx.queue_no}
                        </span>
                        {tx.is_priority && (
                          <span className="badge badge-priority">Priority</span>
                        )}
                        <span className="badge badge-serving">
                          {tx.counter_name || 'Window'}
                        </span>
                      </div>
                      <span className="mono" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {tx.transaction_no}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span><strong>Service:</strong> {tx.service_name}</span>
                        {tx.division_name && (
                          <span style={{
                            fontSize: '0.72rem',
                            backgroundColor: 'rgba(3, 5, 186, 0.08)',
                            color: 'var(--dole-blue)',
                            fontWeight: 700,
                            padding: '0.1rem 0.4rem',
                            borderRadius: '3px',
                          }}>
                            {tx.division_name}
                          </span>
                        )}
                      </div>
                      {tx.client_name && (
                        <div><strong>Client:</strong> {tx.client_name}</div>
                      )}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        Called at: {tx.called_at ? new Date(tx.called_at).toLocaleTimeString() : '--'}
                      </div>
                    </div>

                    {/* Assigned Personnel Badge / Edit */}
                    <div style={{
                      marginBottom: '0.75rem',
                      padding: '0.45rem 0.8rem',
                      borderRadius: '6px',
                      backgroundColor: tx.assigned_personnel ? 'rgba(3, 5, 186, 0.06)' : '#fffbeb',
                      border: tx.assigned_personnel ? '1px solid rgba(3, 5, 186, 0.2)' : '1.5px solid #f59e0b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.88rem' }}>
                        <span>👤</span>
                        {tx.assigned_personnel ? (
                          <span style={{ color: 'var(--dole-blue)' }}>
                            Assigned Personnel: <strong style={{ color: '#0f172a' }}>{tx.assigned_personnel}</strong>
                          </span>
                        ) : (
                          <span style={{ color: '#b45309', fontWeight: 700 }}>
                            ⚠️ No personnel assigned
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenAssignModal(tx)}
                        className="btn btn-ghost btn-xs"
                        style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dole-blue)', textDecoration: 'underline' }}
                      >
                        {tx.assigned_personnel ? 'Change' : 'Assign Now'}
                      </button>
                    </div>

                    {/* Action Buttons */}
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                      borderTop: 'var(--border-hairline)',
                      paddingTop: '0.75rem',
                    }}>
                      <button
                        onClick={() => handleAction(tx.id, 'done')}
                        disabled={actionLoading}
                        className="btn btn-success btn-sm"
                        style={{ fontWeight: 700 }}
                      >
                        ✓ Mark Done (Unlocks Survey)
                      </button>

                      <button
                        onClick={() => {
                          if (!tx.assigned_personnel || !tx.assigned_personnel.trim()) {
                            setError(`Cannot recall Queue ${tx.queue_no}: Help desk officer must assign a personnel first.`);
                            handleOpenAssignModal(tx);
                            return;
                          }
                          handleAction(tx.id, 'recall', { personnel: tx.assigned_personnel });
                        }}
                        disabled={actionLoading || !tx.assigned_personnel}
                        className="btn btn-outline btn-sm"
                        style={{
                          opacity: !tx.assigned_personnel ? 0.45 : 1,
                          cursor: !tx.assigned_personnel ? 'not-allowed' : 'pointer',
                        }}
                        title={!tx.assigned_personnel ? 'Assign a personnel before recalling' : 'Recall client'}
                      >
                        🔄 Recall
                      </button>

                      <button
                        onClick={() => handleAction(tx.id, 'requeue')}
                        disabled={actionLoading}
                        className="btn btn-outline btn-sm"
                      >
                        ↩ Return to Queue
                      </button>

                      <button
                        onClick={() => handleAction(tx.id, 'no-show')}
                        disabled={actionLoading}
                        className="btn btn-danger btn-sm"
                      >
                        ✕ No-Show
                      </button>

                      <button
                        onClick={() => handleAction(tx.id, 'cancel')}
                        disabled={actionLoading}
                        className="btn btn-outline btn-sm"
                        style={{ color: 'var(--dole-red)' }}
                      >
                        Cancel
                      </button>

                      <button
                        onClick={() => setPrintedTx(tx)}
                        className="btn btn-outline btn-sm"
                      >
                        🖨️ Slip
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="card text-center" style={{ padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>☕</div>
                  <p style={{ fontWeight: 600 }}>No clients currently being served.</p>
                  <p style={{ fontSize: '0.85rem' }}>Select your counter and click <strong>Call Next Client</strong> above.</p>
                </div>
              )}
            </div>
          </section>

          {/* Waiting Queue Column */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}>
                ⏳ Waiting in Line ({queueData.waiting?.length || 0})
                {currentCounterName && (
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--dole-blue)', marginLeft: '0.5rem' }}>
                    · {currentCounterName}
                  </span>
                )}
              </h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {queueData.waiting?.length > 0 ? (
                queueData.waiting.map(tx => (
                  <div key={tx.id} className="card" style={{
                    padding: '1rem',
                    borderLeft: tx.is_priority ? '5px solid var(--dole-gold)' : '5px solid #cbd5e1',
                  }}>
                    <div className="flex justify-between items-center" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div className="flex items-center gap-2">
                        <span className="mono" style={{ fontSize: '1.4rem', fontWeight: 800 }}>
                          {tx.queue_no}
                        </span>
                        {tx.is_priority && (
                          <span className="badge badge-priority">Priority</span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {tx.assigned_personnel ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span style={{
                              fontSize: '0.78rem',
                              backgroundColor: 'rgba(3, 5, 186, 0.08)',
                              border: '1px solid rgba(3, 5, 186, 0.25)',
                              color: 'var(--dole-blue)',
                              padding: '0.2rem 0.5rem',
                              borderRadius: '4px',
                              fontWeight: 700,
                              maxWidth: '135px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }} title={`Assigned: ${tx.assigned_personnel}`}>
                              👤 {tx.assigned_personnel}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleOpenAssignModal(tx)}
                              className="btn btn-ghost btn-xs"
                              title="Edit assigned personnel"
                              style={{ padding: '0.1rem 0.3rem', fontSize: '0.75rem' }}
                            >
                              ✏️
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenAssignModal(tx)}
                            className="btn btn-sm"
                            style={{
                              backgroundColor: '#fffbeb',
                              color: '#b45309',
                              border: '1px solid #f59e0b',
                              fontWeight: 700,
                              fontSize: '0.8rem',
                              padding: '0.25rem 0.6rem',
                            }}
                            title="Assign personnel to enable Call"
                          >
                            👤 Assign
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleCallSpecific(tx)}
                          disabled={actionLoading || !tx.assigned_personnel}
                          className="btn btn-primary btn-sm"
                          style={{
                            minHeight: '32px',
                            opacity: !tx.assigned_personnel ? 0.45 : 1,
                            cursor: !tx.assigned_personnel ? 'not-allowed' : 'pointer',
                          }}
                          title={!tx.assigned_personnel ? 'Help desk officer must assign a personnel to this queue number before calling' : 'Call this client'}
                        >
                          Call
                        </button>
                      </div>
                    </div>

                    <div style={{ fontSize: '0.85rem', marginTop: '0.4rem', color: 'var(--text-secondary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <strong>{tx.service_name}</strong>
                        {tx.division_name && (
                          <span style={{
                            fontSize: '0.72rem',
                            backgroundColor: 'rgba(3, 5, 186, 0.08)',
                            color: 'var(--dole-blue)',
                            fontWeight: 700,
                            padding: '0.1rem 0.4rem',
                            borderRadius: '3px',
                          }}>
                            {tx.division_name}
                          </span>
                        )}
                      </div>
                      {tx.client_name && <div>Client: {tx.client_name}</div>}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        Checked in: {new Date(tx.checked_in_at).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="card text-center" style={{ padding: '2.5rem 1.5rem', color: 'var(--text-muted)' }}>
                  <p style={{ fontWeight: 600 }}>Queue is clear!</p>
                  <p style={{ fontSize: '0.85rem' }}>
                    {currentCounterName ? `No clients waiting for ${currentCounterName} right now.` : 'No clients waiting in line right now.'}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Walk-in Register Modal */}
      <Modal
        isOpen={showWalkinModal}
        onClose={() => setShowWalkinModal(false)}
        title="Walk-in Client Registration"
      >
        <form onSubmit={handleWalkinSubmit}>
          {/* Registration Type Segmented Control */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600, fontSize: '0.85rem' }}>
              Registration Type
            </label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.4rem',
              background: '#f1f5f9',
              padding: '3px',
              borderRadius: 'var(--radius-md)',
            }}>
              <button
                type="button"
                onClick={() => setWalkinIsGroup(false)}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: !walkinIsGroup ? '#ffffff' : 'transparent',
                  color: !walkinIsGroup ? 'var(--dole-blue)' : 'var(--text-secondary)',
                  fontWeight: !walkinIsGroup ? 700 : 500,
                  boxShadow: !walkinIsGroup ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                }}
              >
                <span>👤</span>
                <span>Individual</span>
              </button>
              <button
                type="button"
                onClick={() => setWalkinIsGroup(true)}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: walkinIsGroup ? '#ffffff' : 'transparent',
                  color: walkinIsGroup ? 'var(--dole-blue)' : 'var(--text-secondary)',
                  fontWeight: walkinIsGroup ? 700 : 500,
                  boxShadow: walkinIsGroup ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                }}
              >
                <span>👥</span>
                <span>Group</span>
              </button>
            </div>
          </div>

          {!walkinIsGroup ? (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <label style={{ margin: 0 }}>Client Name (Optional)</label>
                <button
                  type="button"
                  onClick={() => setWalkinName(walkinName === 'Anonymous' ? '' : 'Anonymous')}
                  className="btn btn-sm"
                  style={{
                    minHeight: '26px',
                    padding: '0.15rem 0.55rem',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    borderRadius: '20px',
                    backgroundColor: walkinName === 'Anonymous' ? 'var(--dole-blue)' : '#f1f5f9',
                    color: walkinName === 'Anonymous' ? '#ffffff' : 'var(--text-secondary)',
                    border: walkinName === 'Anonymous' ? '1px solid var(--dole-blue)' : '1px solid #cbd5e1',
                    cursor: 'pointer',
                  }}
                  title={walkinName === 'Anonymous' ? 'Click to clear anonymous' : 'Click to register as Anonymous'}
                >
                  {walkinName === 'Anonymous' ? '✓ Anonymous' : '👤 Anonymous'}
                </button>
              </div>
              <input
                type="text"
                value={walkinName}
                onChange={(e) => setWalkinName(e.target.value)}
                placeholder="e.g. Juan Dela Cruz or Anonymous"
                style={{
                  backgroundColor: walkinName === 'Anonymous' ? 'rgba(3, 5, 186, 0.04)' : '#ffffff',
                  borderColor: walkinName === 'Anonymous' ? 'var(--dole-blue)' : undefined,
                  fontWeight: walkinName === 'Anonymous' ? 700 : 400,
                  color: walkinName === 'Anonymous' ? 'var(--dole-blue)' : undefined,
                }}
              />
            </div>
          ) : (
            <>
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <label style={{ margin: 0 }}>Representative Name</label>
                  <button
                    type="button"
                    onClick={() => setWalkinRepName(walkinRepName === 'Anonymous' ? '' : 'Anonymous')}
                    className="btn btn-sm"
                    style={{
                      minHeight: '26px',
                      padding: '0.15rem 0.55rem',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      borderRadius: '20px',
                      backgroundColor: walkinRepName === 'Anonymous' ? 'var(--dole-blue)' : '#f1f5f9',
                      color: walkinRepName === 'Anonymous' ? '#ffffff' : 'var(--text-secondary)',
                      border: walkinRepName === 'Anonymous' ? '1px solid var(--dole-blue)' : '1px solid #cbd5e1',
                      cursor: 'pointer',
                    }}
                    title={walkinRepName === 'Anonymous' ? 'Click to clear anonymous' : 'Click to register as Anonymous'}
                  >
                    {walkinRepName === 'Anonymous' ? '✓ Anonymous' : '👤 Anonymous'}
                  </button>
                </div>
                <input
                  type="text"
                  value={walkinRepName}
                  onChange={(e) => setWalkinRepName(e.target.value)}
                  placeholder="e.g. Maria Santos (Representative)"
                  style={{
                    backgroundColor: walkinRepName === 'Anonymous' ? 'rgba(3, 5, 186, 0.04)' : '#ffffff',
                    borderColor: walkinRepName === 'Anonymous' ? 'var(--dole-blue)' : undefined,
                    fontWeight: walkinRepName === 'Anonymous' ? 700 : 400,
                    color: walkinRepName === 'Anonymous' ? 'var(--dole-blue)' : undefined,
                  }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600, fontSize: '0.85rem' }}>
                  Number of Members in Group *
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ position: 'relative', width: '110px' }}>
                    <input
                      type="number"
                      min="2"
                      max="999"
                      required
                      value={walkinGroupSize}
                      onChange={(e) => setWalkinGroupSize(e.target.value)}
                      placeholder="e.g. 5"
                      style={{
                        width: '100%',
                        fontWeight: 700,
                        paddingLeft: '2rem',
                      }}
                    />
                    <span style={{
                      position: 'absolute',
                      left: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '0.9rem',
                      pointerEvents: 'none',
                    }}>
                      👥
                    </span>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Total people in group
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Select Service after representative and group members */}
          <div style={{ marginBottom: '1rem' }}>
            <label>Select Service *</label>
            <SearchableServiceSelect
              required
              services={filteredOfficeServices || []}
              value={walkinService}
              onChange={(val) => setWalkinService(val)}
              placeholder="-- Select Service --"
              searchPlaceholder="Search services or division..."
            />
            {user && !user.is_superuser && user.assigned_divisions?.length > 0 && (
              <div style={{ fontSize: '0.75rem', color: 'var(--dole-blue)', marginTop: '0.35rem', fontWeight: 600 }}>
                🔒 Limited to your division: {user.assigned_divisions.map(d => d.name).join(', ')}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={walkinPriority}
                onChange={(e) => setWalkinPriority(e.target.checked)}
                style={{ width: '20px', height: '20px', minHeight: 'unset' }}
              />
              <span style={{ fontWeight: 600 }}>Priority Lane (Senior / PWD / Pregnant)</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setShowWalkinModal(false)}
              className="btn btn-outline"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionLoading}
              className="btn btn-primary"
            >
              Issue Ticket & Slip
            </button>
          </div>
        </form>
      </Modal>

      {/* Printable Slip Modal */}
      <Modal
        isOpen={!!printedTx}
        onClose={() => setPrintedTx(null)}
        title="Queue Slip"
      >
        <PrintSlip transaction={printedTx} onClose={() => setPrintedTx(null)} />
      </Modal>

      {/* Assign Personnel Modal */}
      <Modal
        isOpen={showAssignModal}
        onClose={() => {
          setShowAssignModal(false);
          setAssignTx(null);
        }}
        title={`Assign Personnel · Queue #${assignTx?.queue_no || ''}`}
      >
        <form onSubmit={handleAssignSubmit}>
          <div style={{
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 'var(--radius-md)',
            padding: '0.85rem 1rem',
            marginBottom: '1.25rem',
            fontSize: '0.88rem',
            color: '#1e40af',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <strong style={{ fontSize: '0.95rem' }}>Service: {assignTx?.service_name || 'Frontline Service'}</strong>
              {assignTx?.division_name && (
                <span style={{
                  backgroundColor: '#dbeafe',
                  color: '#1d4ed8',
                  padding: '0.2rem 0.55rem',
                  borderRadius: 'var(--radius-sm)',
                  fontWeight: 700,
                  fontSize: '0.78rem',
                }}>
                  Division: {assignTx.division_name}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.82rem', color: '#1e3a8a', lineHeight: 1.4 }}>
              🔒 <strong>Division Access Policy:</strong> Only personnel assigned to the <strong>{assignTx?.division_name || 'same'}</strong> division are permitted to access and be assigned to this transaction.
            </div>
          </div>

          {/* Select Registered DOLE Personnel with Instant Real-Time Search */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label style={{ fontWeight: 700, fontSize: '0.86rem', margin: 0 }}>
                Select DOLE Personnel (Instant Real-time Search) *
              </label>
              <span style={{ fontSize: '0.75rem', color: 'var(--dole-blue)', fontWeight: 600 }}>
                {eligiblePersonnel.length} available in {assignTx?.division_name || 'division'}
              </span>
            </div>
            <SearchablePersonnelSelect
              personnel={eligiblePersonnel}
              value={assignPersonnelName}
              onChange={(name) => setAssignPersonnelName(name)}
              placeholder={`-- Select ${assignTx?.division_name || ''} Personnel --`}
              searchPlaceholder={`Type to search ${assignTx?.division_name || ''} personnel...`}
              serviceDivision={assignTx?.division_name}
            />
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ fontWeight: 700, marginBottom: '0.4rem', display: 'block', fontSize: '0.86rem' }}>
              Assigned Personnel Name *
            </label>
            <input
              type="text"
              required
              value={assignPersonnelName}
              onChange={(e) => setAssignPersonnelName(e.target.value)}
              placeholder="e.g. Juan Dela Cruz"
              style={{
                width: '100%',
                padding: '0.65rem 0.75rem',
                fontSize: '0.95rem',
                borderColor: matchedIneligible ? 'var(--dole-red)' : undefined,
              }}
            />
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
              Select from dropdown above or type name manually.
            </span>
          </div>

          {matchedIneligible && (
            <div style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem 0.9rem',
              color: '#991b1b',
              fontSize: '0.84rem',
              marginBottom: '1.25rem',
              lineHeight: 1.45,
            }}>
              ⚠️ <strong>Division Restriction Violation:</strong> <strong>{matchedIneligible.full_name}</strong> is assigned to division(s) <strong>{matchedIneligible.division_names?.join(', ')}</strong> and cannot access or be assigned to services under the <strong>{assignTx?.division_name}</strong> division.
            </div>
          )}

          {recentPersonnel.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                  Recently assigned:
                </label>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Click ✕ to remove
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                {recentPersonnel.map((name, idx) => {
                  const isIneligible = ineligiblePersonnel.some(
                    p => p.full_name?.toLowerCase().trim() === name.toLowerCase().trim()
                  );
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        borderRadius: '20px',
                        backgroundColor: assignPersonnelName === name
                          ? 'rgba(3, 5, 186, 0.1)'
                          : isIneligible
                          ? '#f1f5f9'
                          : '#f8fafc',
                        border: assignPersonnelName === name
                          ? '1.5px solid var(--dole-blue)'
                          : isIneligible
                          ? '1px dashed #cbd5e1'
                          : '1px solid #cbd5e1',
                        opacity: isIneligible ? 0.6 : 1,
                        overflow: 'hidden',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setAssignPersonnelName(name)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          padding: '0.25rem 0.55rem',
                          cursor: 'pointer',
                          fontWeight: assignPersonnelName === name ? 700 : 500,
                          color: assignPersonnelName === name ? 'var(--dole-blue)' : 'var(--text-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          fontSize: '0.8rem',
                        }}
                        title={isIneligible ? `Cannot assign: belongs to another division` : `Select ${name}`}
                      >
                        <span>{isIneligible ? '🚫' : '👤'}</span>
                        <span style={{ textDecoration: isIneligible ? 'line-through' : 'none' }}>{name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteRecentPersonnel(name, e)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          padding: '0.2rem 0.45rem',
                          paddingLeft: '0.1rem',
                          cursor: 'pointer',
                          color: '#94a3b8',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          lineHeight: 1,
                          transition: 'color 0.15s ease',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--dole-red)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = '#94a3b8'}
                        title={`Remove "${name}" from recent list`}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button
              type="button"
              onClick={() => {
                setShowAssignModal(false);
                setAssignTx(null);
              }}
              className="btn btn-outline"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionLoading || !assignPersonnelName.trim() || Boolean(matchedIneligible)}
              className="btn btn-primary"
              style={{ fontWeight: 700 }}
            >
              {actionLoading ? 'Saving...' : 'Save Personnel Assignment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
