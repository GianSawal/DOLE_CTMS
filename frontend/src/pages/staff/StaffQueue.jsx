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

// Default officers mapped by service keyword and division
const SERVICE_DEFAULT_OFFICERS = {
  'tupad': 'CAMILLE SANTOS',
  'spes': 'ARVIE ANGAT',
  'alien employment': 'ADRIANNE MAE DIMALANTA',
  'aep': 'ADRIANNE MAE DIMALANTA',
  'livelihood': 'CAMILLE SANTOS',
  'cshp': 'CHARLIE BARROZO',
  'rule 1020': 'WILSON DAYRIT',
  'sena': 'RAYMOND GONZALES',
  'single entry': 'RAYMOND GONZALES',
  'labor inspection': 'JESSICA TRISHIA GONZALES',
  'general labor': 'ROY OCAMPO',
};

const DIVISION_DEFAULT_OFFICERS = {
  'TSSD 2': 'CAMILLE SANTOS',
  'TSSD2': 'CAMILLE SANTOS',
  'TSSD 1': 'RAYMOND GONZALES',
  'TSSD1': 'RAYMOND GONZALES',
};

const determineDefaultOfficerForTx = (tx, personnelList = []) => {
  if (!tx) return '';
  if (tx.default_officer && typeof tx.default_officer === 'string') {
    return tx.default_officer.trim();
  }

  const sName = (tx.service_name || '').toLowerCase();
  for (const [kw, officer] of Object.entries(SERVICE_DEFAULT_OFFICERS)) {
    if (sName.includes(kw)) {
      return officer;
    }
  }

  const divName = (tx.division_name || '').trim();
  if (divName) {
    const divOfficer = DIVISION_DEFAULT_OFFICERS[divName] || DIVISION_DEFAULT_OFFICERS[divName.replace(/\s+/g, '')];
    if (divOfficer) return divOfficer;

    const normDiv = (divName || '').toUpperCase().replace(/\s+/g, '');
    const candidate = (personnelList || []).find(p => {
      const divs = (p.division_names || []).map(d => (d || '').toUpperCase().replace(/\s+/g, ''));
      return divs.includes(normDiv) || divs.includes('ALL');
    });
    if (candidate?.full_name) return candidate.full_name;
  }

  return '';
};

export default function StaffQueue() {
  const { user } = useAuth();

  const [selectedOffice, setSelectedOffice] = useState(() => localStorage.getItem('ctms_staff_office') || '');
  const [selectedCounter, setSelectedCounter] = useState(() => localStorage.getItem('ctms_staff_counter') || '');

  const [queueData, setQueueData] = useState({ waiting: [], serving: [], pending: [], counters: [], office: null });
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
  const [walkinMemberNames, setWalkinMemberNames] = useState(['', '']);

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

  // Auto-select counter logic:
  // If user has a single counter available, auto-select it.
  // If multiple counters are available:
  //   - Keep '-- All Counters / Divisions --' ('') if selected or if unset
  //   - If a valid saved counter is in localStorage, use it
  //   - Never forcibly hijack the selection to counters[0] (e.g. IMSD)
  useEffect(() => {
    if (queueData.counters?.length > 0) {
      const saved = localStorage.getItem('ctms_staff_counter');
      const hasValid = queueData.counters.some(c => String(c.id) === String(selectedCounter));

      // If exactly 1 counter exists, auto-select it
      if (queueData.counters.length === 1) {
        const onlyId = String(queueData.counters[0].id);
        if (selectedCounter !== onlyId) {
          setSelectedCounter(onlyId);
          localStorage.setItem('ctms_staff_counter', onlyId);
        }
        return;
      }

      // If user is currently on '-- All Counters / Divisions --', keep it!
      if (selectedCounter === '') {
        return;
      }

      // If user has a valid saved counter in localStorage, preserve it
      if (saved && queueData.counters.some(c => String(c.id) === String(saved))) {
        if (selectedCounter !== saved) {
          setSelectedCounter(saved);
        }
        return;
      }

      // If saved is explicitly empty string, keep selectedCounter as ''
      if (saved === '') {
        if (selectedCounter !== '') setSelectedCounter('');
        return;
      }

      // If selectedCounter is set but invalid (e.g. from another office), reset to All Counters
      if (selectedCounter && !hasValid) {
        setSelectedCounter('');
        localStorage.setItem('ctms_staff_counter', '');
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

  // Fetch queue data (with automatic recovery if a stale unauthorized counter ID is in localStorage)
  const fetchQueue = useCallback(async () => {
    if (!selectedOffice) return;
    try {
      const data = await staffApi.getQueue(selectedOffice, selectedCounter);
      setQueueData(data);
      setError('');
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      const isForbiddenCounter = msg.includes('forbidden') || msg.includes('not authorized');
      if (selectedCounter && isForbiddenCounter) {
        setSelectedCounter('');
        localStorage.setItem('ctms_staff_counter', '');
        try {
          const fallbackData = await staffApi.getQueue(selectedOffice, '');
          setQueueData(fallbackData);
          setError('');
          return;
        } catch (retryErr) {
          setError(retryErr.message || 'Error loading queue.');
          return;
        }
      }
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

  // Build a map of officers who are currently assigned to active clients (waiting, serving, pending)
  // excluding the transaction currently being edited/reassigned (assignTx)
  const busyPersonnelMap = useMemo(() => {
    const map = new Map(); // key: lowercase normalized name, value: { queue_no, status, txId, rawName }

    const registerAssignment = (tx) => {
      if (!tx || !tx.assigned_personnel) return;
      // Skip the current transaction being assigned/viewed
      if (assignTx && String(tx.id) === String(assignTx.id)) return;

      const status = tx.status?.toLowerCase();
      // Only active transactions block the officer from reassignment
      if (['waiting', 'serving', 'pending'].includes(status)) {
        const raw = String(tx.assigned_personnel).trim();
        const norm = raw.toLowerCase();
        if (norm && !map.has(norm)) {
          map.set(norm, {
            queue_no: tx.queue_no,
            status: tx.status,
            txId: tx.id,
            rawName: raw,
          });
        }
      }
    };

    if (Array.isArray(queueData.active_assignments)) {
      queueData.active_assignments.forEach(registerAssignment);
    }
    (queueData.waiting || []).forEach(registerAssignment);
    (queueData.serving || []).forEach(registerAssignment);
    (queueData.pending || []).forEach(registerAssignment);

    return map;
  }, [queueData, assignTx]);

  const getBusyInfo = useCallback((nameOrObj) => {
    if (!nameOrObj) return null;
    if (typeof nameOrObj === 'string') {
      const clean = nameOrObj.trim().toLowerCase();
      return busyPersonnelMap.get(clean) || null;
    }
    const name = nameOrObj.full_name?.trim().toLowerCase();
    if (name && busyPersonnelMap.has(name)) return busyPersonnelMap.get(name);
    const empId = nameOrObj.employee_id?.trim().toLowerCase();
    if (empId && busyPersonnelMap.has(empId)) return busyPersonnelMap.get(empId);
    return null;
  }, [busyPersonnelMap]);

  // Check if currently selected / typed name matches an unavailable / busy officer
  const matchedBusyOfficer = useMemo(() => {
    if (!assignPersonnelName.trim()) return null;
    return getBusyInfo(assignPersonnelName);
  }, [assignPersonnelName, getBusyInfo]);

  // Count available eligible personnel
  const availableEligiblePersonnel = useMemo(() => {
    return eligiblePersonnel.filter(p => !getBusyInfo(p));
  }, [eligiblePersonnel, getBusyInfo]);

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

  const resolvedDefaultOfficer = useMemo(() => {
    return assignTx ? (assignTx.default_officer || determineDefaultOfficerForTx(assignTx, officePersonnel)) : '';
  }, [assignTx, officePersonnel]);

  const handleOpenAssignModal = (tx) => {
    setAssignTx(tx);
    if (selectedOffice) {
      staffApi.getPersonnel({ office: selectedOffice, active_only: 'true' })
        .then(data => setOfficePersonnel(Array.isArray(data) ? data : []))
        .catch(() => {});
    }

    // Automatically determine default officer based on the service selected by the client
    const defaultOfficer = tx?.default_officer || determineDefaultOfficerForTx(tx, officePersonnel);

    // If client already has an assigned officer, retain it; otherwise automatically display the default officer
    let defaultName = tx?.assigned_personnel ? tx.assigned_personnel.trim() : defaultOfficer;

    // Fallback: If no default officer found and staff can self-assign, fallback to self if available
    if (!defaultName) {
      const txDiv = normalizeDiv(tx?.division_name);
      const loggedInUserDivs = (user?.assigned_divisions || []).map(d => normalizeDiv(d.name));
      const canUserSelfAssign = user?.is_superuser || !txDiv || loggedInUserDivs.includes(txDiv);
      if (canUserSelfAssign) {
        const candidate = (user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : (user?.username || ''));
        const selfBusy = getBusyInfo(candidate);
        if (!selfBusy) {
          defaultName = candidate;
        }
      }
    }
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

    if (matchedBusyOfficer) {
      setError(`Officer ${matchedBusyOfficer.rawName || assignPersonnelName} is currently assigned to Queue #${matchedBusyOfficer.queue_no} and cannot be assigned to another client until their current transaction is completed.`);
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

    // Determine counter to use:
    // If next client has a division, find the counter matching that division name
    let counterToUse = null;
    if (nextWaitingClient.division_name && queueData.counters?.length > 0) {
      const divNorm = nextWaitingClient.division_name.trim().toLowerCase().replace(/\s+/g, '');
      const matched = queueData.counters.find(
        c => c.name.trim().toLowerCase().replace(/\s+/g, '') === divNorm
      );
      if (matched) {
        counterToUse = String(matched.id);
      }
    }

    if (!counterToUse && selectedCounter) {
      counterToUse = selectedCounter;
    }
    if (!counterToUse && queueData.counters?.length > 0) {
      counterToUse = String(queueData.counters[0].id);
    }

    if (!counterToUse) {
      setError('No window counters available for this office. Please set up a counter first.');
      return;
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

    // Determine counter to use:
    // If ticket has a division, find the counter matching that division name
    let counterToUse = null;
    if (tx.division_name && queueData.counters?.length > 0) {
      const divNorm = tx.division_name.trim().toLowerCase().replace(/\s+/g, '');
      const matched = queueData.counters.find(
        c => c.name.trim().toLowerCase().replace(/\s+/g, '') === divNorm
      );
      if (matched) {
        counterToUse = String(matched.id);
      }
    }

    // If no division match, use selectedCounter if set, or first available counter
    if (!counterToUse && selectedCounter) {
      counterToUse = selectedCounter;
    }
    if (!counterToUse && queueData.counters?.length > 0) {
      counterToUse = String(queueData.counters[0].id);
    }

    if (!counterToUse) {
      setError('No window counters available. Please select or add a counter.');
      return;
    }

    // NOTE: We intentionally do NOT call setSelectedCounter(counterToUse) here.
    // Forcing selectedCounter switches the user's dropdown view and filters out all other divisions.
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
    let memberNames = null;
    if (walkinIsGroup) {
      const parsedSize = parseInt(walkinGroupSize, 10);
      const count = isNaN(parsedSize) || parsedSize < 2 ? 2 : parsedSize;
      const rep = (walkinRepName.trim().toLowerCase() === 'anonymous' || !walkinRepName.trim()) 
        ? 'Anonymous' 
        : walkinRepName.trim();
      finalClientName = `${rep} (Group of ${count})`;
      // Collect all member names (trimmed, non-empty)
      memberNames = walkinMemberNames.slice(0, count).map(n => n.trim()).filter(Boolean);
      if (memberNames.length < count) {
        setError('Please enter the name for every group member.');
        return;
      }
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
        group_member_names: memberNames,
      });
      setShowWalkinModal(false);
      setWalkinName('');
      setWalkinService('');
      setWalkinPriority(false);
      setWalkinIsGroup(false);
      setWalkinRepName('');
      setWalkinGroupSize('2');
      setWalkinMemberNames(['', '']);
      setPrintedTx(newTx);
      await fetchQueue();
    } catch (err) {
      setError(err.message || 'Failed to register walk-in.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-ground)' }}>
      <Navbar />

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        {/* Top Console Card: Office & Counter Selectors + Call Next + Walk-in */}
        <div className="staff-console-card">
          {/* Top Banner Row: Console Title + Live Sync Status + Mini Stats */}
          <div className="staff-console-top">
            <div>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--dole-blue)',
                backgroundColor: 'rgba(3, 5, 186, 0.06)',
                padding: '0.2rem 0.55rem',
                borderRadius: '9999px',
                marginBottom: '0.35rem',
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
                <span>Counter Dispatch Console</span>
              </div>
              <h1 style={{
                fontSize: '1.4rem',
                fontWeight: 800,
                color: '#0f172a',
                lineHeight: 1.2,
                margin: 0,
                letterSpacing: '-0.02em',
              }}>
                Service Counter Queue
              </h1>
              <p style={{
                margin: '0.2rem 0 0 0',
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
              }}>
                Frontline counter service delivery, live ticket calling, and turnaround monitoring.
              </p>
            </div>

            {/* Live Status and Quick Overview Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                fontSize: '0.775rem',
                fontWeight: 600,
                color: '#047857',
                backgroundColor: '#ecfdf5',
                border: '1px solid #a7f3d0',
                padding: '0.3rem 0.75rem',
                borderRadius: '9999px',
              }}>
                <span className="pulse-live-dot" />
                <span>Live Queue Active</span>
              </div>

              <span className="staff-stat-pill staff-stat-pill-blue">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <span>Serving: <strong>{queueData.serving?.length || 0}</strong></span>
              </span>

              <span className={`staff-stat-pill ${queueData.waiting?.length > 0 ? 'staff-stat-pill-amber' : 'staff-stat-pill-green'}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                </svg>
                <span>Waiting: <strong>{queueData.waiting?.length || 0}</strong></span>
              </span>

              <span className={`staff-stat-pill ${queueData.pending?.length > 0 ? 'staff-stat-pill-amber' : 'staff-stat-pill-green'}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="10" y1="15" x2="10" y2="9"></line>
                  <line x1="14" y1="15" x2="14" y2="9"></line>
                </svg>
                <span>Pending: <strong>{queueData.pending?.length || 0}</strong></span>
              </span>
            </div>
          </div>

          {/* Bottom Controls Row: Desk Configuration & Dispatch Buttons */}
          <div className="staff-console-bottom">
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '1rem' }}>
              <div className="staff-select-wrapper">
                <label className="staff-control-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 21h18"></path>
                    <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
                  </svg>
                  <span>Assigned Office</span>
                </label>
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
                    fontSize: '0.9rem',
                  }}>
                    🔒 {user.assigned_offices[0].name} ({user.assigned_offices[0].code})
                  </div>
                ) : (
                  <select
                    value={selectedOffice}
                    onChange={handleOfficeChange}
                    className="staff-custom-select"
                    style={{ minWidth: '250px' }}
                  >
                    {user?.assigned_offices?.map(off => (
                      <option key={off.id} value={off.id}>{off.name} ({off.code})</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="staff-select-wrapper">
                <label className="staff-control-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                  </svg>
                  <span>Your Counter / Window</span>
                </label>
                <select
                  value={selectedCounter}
                  onChange={handleCounterChange}
                  className="staff-custom-select"
                  style={{ minWidth: '220px' }}
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
                style={{
                  minHeight: '44px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                  borderColor: '#cbd5e1',
                  color: '#334155',
                  backgroundColor: '#ffffff',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="8.5" cy="7" r="4"></circle>
                  <line x1="20" y1="8" x2="20" y2="14"></line>
                  <line x1="23" y1="11" x2="17" y2="11"></line>
                </svg>
                <span>Walk-in Registration</span>
              </button>

              {nextWaitingClient && !isNextClientAssigned && (
                <button
                  type="button"
                  onClick={() => handleOpenAssignModal(nextWaitingClient)}
                  className="btn btn-sm"
                  style={{
                    minHeight: '44px',
                    backgroundColor: '#fffbeb',
                    color: '#92400e',
                    border: '1.5px solid #f59e0b',
                    borderRadius: '8px',
                    fontWeight: 700,
                    padding: '0.45rem 0.95rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    boxShadow: '0 1px 2px rgba(245, 158, 11, 0.15)',
                  }}
                  title="Assign personnel to enable Call Next Client"
                >
                  <span style={{ fontSize: '0.95rem' }}>⚠️</span>
                  <span>Next ({nextWaitingClient.queue_no}): <strong>Assign Officer</strong></span>
                </button>
              )}

              <button
                onClick={handleCallNext}
                disabled={actionLoading || !nextWaitingClient || !isNextClientAssigned}
                className="btn"
                style={{
                  minHeight: '44px',
                  fontWeight: 800,
                  fontSize: '0.925rem',
                  padding: '0.65rem 1.65rem',
                  borderRadius: '8px',
                  background: (!nextWaitingClient || !isNextClientAssigned)
                    ? '#e2e8f0'
                    : 'linear-gradient(135deg, #0305ba 0%, #1e40af 100%)',
                  color: (!nextWaitingClient || !isNextClientAssigned) ? '#64748b' : '#ffffff',
                  boxShadow: (!nextWaitingClient || !isNextClientAssigned)
                    ? 'none'
                    : '0 4px 12px rgba(3, 5, 186, 0.28)',
                  cursor: (!nextWaitingClient || !isNextClientAssigned) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.55rem',
                }}
                title={
                  !nextWaitingClient
                    ? 'No waiting clients in queue'
                    : !isNextClientAssigned
                    ? `Assign a personnel to ticket ${nextWaitingClient.queue_no} before calling next client`
                    : `Call next client (${nextWaitingClient.queue_no})`
                }
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
                <span>{actionLoading ? 'Calling Client...' : (nextWaitingClient && isNextClientAssigned ? `Call Next (${nextWaitingClient.queue_no})` : 'Call Next Client')}</span>
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 'var(--radius-md)',
            padding: '0.85rem 1.15rem',
            marginBottom: '1.5rem',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            boxShadow: '0 1px 2px rgba(220, 38, 38, 0.05)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{error}</span>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <h2 style={{ fontSize: '1.18rem', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ color: 'var(--dole-blue)' }}>
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                  </svg>
                  <span>Now Serving</span>
                </h2>
                {currentCounterName && (
                  <span style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: 'var(--dole-blue)',
                    backgroundColor: 'rgba(3, 5, 186, 0.08)',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(3, 5, 186, 0.2)',
                  }}>
                    {currentCounterName}
                  </span>
                )}
              </div>
              <span className="badge" style={{
                backgroundColor: queueData.serving?.length > 0 ? 'var(--dole-blue-light)' : '#f1f5f9',
                color: queueData.serving?.length > 0 ? 'var(--dole-blue)' : '#64748b',
                fontWeight: 700,
              }}>
                {queueData.serving?.length || 0} Active
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {queueData.serving?.length > 0 ? (
                queueData.serving.map(tx => (
                  <div key={tx.id} className="card" style={{
                    borderLeft: '5px solid var(--dole-blue)',
                    padding: '1.25rem',
                    boxShadow: '0 2px 5px rgba(0, 0, 0, 0.05)',
                  }}>
                    <div className="flex justify-between items-center" style={{ marginBottom: '0.65rem' }}>
                      <div className="flex items-center gap-2">
                        <span className="mono" style={{ fontSize: '2.1rem', fontWeight: 900, color: 'var(--dole-blue)', letterSpacing: '-0.03em' }}>
                          {tx.queue_no}
                        </span>
                        {tx.is_priority && (
                          <span className="badge badge-priority">
                            ★ Priority
                          </span>
                        )}
                        <span className="badge badge-serving">
                          {tx.counter_name || 'Window'}
                        </span>
                      </div>
                      <span className="mono" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {tx.transaction_no}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.9rem', marginBottom: '0.85rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                        <span style={{ fontWeight: 700, color: '#0f172a' }}>{tx.service_name}</span>
                        {tx.division_name && (
                          <span style={{
                            fontSize: '0.72rem',
                            backgroundColor: 'rgba(3, 5, 186, 0.08)',
                            color: 'var(--dole-blue)',
                            fontWeight: 700,
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            border: '1px solid rgba(3, 5, 186, 0.15)',
                          }}>
                            {tx.division_name}
                          </span>
                        )}
                      </div>
                      {tx.client_name && (
                        <div style={{ color: '#475569', fontSize: '0.875rem' }}>
                          Client: <strong>{tx.client_name}</strong>
                        </div>
                      )}
                      {Array.isArray(tx.group_member_names) && tx.group_member_names.length > 0 && (
                        <div style={{
                          marginTop: '0.35rem',
                          padding: '0.45rem 0.65rem',
                          backgroundColor: '#f1f5f9',
                          borderRadius: '6px',
                          border: '1px solid #e2e8f0',
                          fontSize: '0.78rem',
                          color: '#334155'
                        }}>
                          <div style={{ fontWeight: 600, color: 'var(--dole-blue)', marginBottom: '0.25rem' }}>
                            👥 Group Members ({tx.group_member_names.length}):
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                            {tx.group_member_names.map((name, idx) => (
                              <span key={idx} style={{
                                backgroundColor: '#ffffff',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                padding: '0.15rem 0.45rem',
                                fontSize: '0.74rem',
                                fontWeight: 500,
                              }}>
                                {idx + 1}. {name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <span>Called at: {tx.called_at ? new Date(tx.called_at).toLocaleTimeString() : '--'}</span>
                      </div>
                    </div>

                    {/* Assigned Personnel Badge / Edit */}
                    <div style={{
                      marginBottom: '0.85rem',
                      padding: '0.55rem 0.85rem',
                      borderRadius: '8px',
                      backgroundColor: tx.assigned_personnel ? 'rgba(3, 5, 186, 0.05)' : '#fffbeb',
                      border: tx.assigned_personnel ? '1px solid rgba(3, 5, 186, 0.18)' : '1.5px solid #f59e0b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.86rem' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                          <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        {tx.assigned_personnel ? (
                          <span style={{ color: 'var(--dole-blue)' }}>
                            Assigned Officer: <strong style={{ color: '#0f172a' }}>{tx.assigned_personnel}</strong>
                          </span>
                        ) : (
                          <span style={{ color: '#b45309', fontWeight: 700 }}>
                            ⚠️ No officer assigned yet {tx.default_officer && <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#64748b' }}>· Default: {tx.default_officer}</span>}
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
                        onClick={() => handleAction(tx.id, 'pending')}
                        disabled={actionLoading}
                        className="btn btn-sm"
                        style={{
                          backgroundColor: '#fffbeb',
                          color: '#b45309',
                          border: '1px solid #f59e0b',
                          fontWeight: 700,
                        }}
                        title="Move to Pending Line (for services that cannot be finished in one day)"
                      >
                        ⏳ Pending
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
                <div className="staff-empty-card">
                  <div className="staff-empty-icon-circle staff-empty-circle-blue">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                      <line x1="8" y1="21" x2="16" y2="21"></line>
                      <line x1="12" y1="17" x2="12" y2="21"></line>
                      <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                  </div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.35rem 0' }}>
                    Counter Ready for Service
                  </h3>
                  <p style={{ fontSize: '0.875rem', color: '#64748b', maxWidth: '360px', margin: '0 auto 0.75rem auto' }}>
                    No client is currently being served at <strong>{currentCounterName || 'this counter'}</strong>.
                  </p>
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    fontSize: '0.785rem',
                    color: 'var(--dole-blue)',
                    backgroundColor: 'rgba(3, 5, 186, 0.05)',
                    padding: '0.35rem 0.85rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(3, 5, 186, 0.15)',
                  }}>
                    <span>💡 Click <strong>Call Next Client</strong> above to dispatch the next ticket</span>
                  </div>
                </div>
              )}
            </div>

            {/* Pending Line Section (Multi-day / Ongoing Services) */}
            <div style={{ marginTop: '1.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ color: '#b45309' }}>
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="10" y1="15" x2="10" y2="9"></line>
                      <line x1="14" y1="15" x2="14" y2="9"></line>
                    </svg>
                    <span>Pending Line</span>
                  </h2>
                  {currentCounterName && (
                    <span style={{
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      color: '#b45309',
                      backgroundColor: '#fffbeb',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '6px',
                      border: '1px solid #fde68a',
                    }}>
                      {currentCounterName}
                    </span>
                  )}
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Multi-day / hold services
                  </span>
                </div>
                <span className="badge" style={{
                  backgroundColor: queueData.pending?.length > 0 ? '#fffbeb' : '#f1f5f9',
                  color: queueData.pending?.length > 0 ? '#b45309' : '#64748b',
                  border: queueData.pending?.length > 0 ? '1px solid #fde68a' : '1px solid #e2e8f0',
                  fontWeight: 700,
                }}>
                  {queueData.pending?.length || 0} Pending
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {queueData.pending?.length > 0 ? (
                  queueData.pending.map(tx => (
                    <div key={tx.id} className="card" style={{
                      borderLeft: '5px solid #f59e0b',
                      padding: '1.15rem 1.25rem',
                      backgroundColor: '#fffdf7',
                      boxShadow: '0 2px 5px rgba(0, 0, 0, 0.04)',
                    }}>
                      <div className="flex justify-between items-center" style={{ marginBottom: '0.55rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div className="flex items-center gap-2">
                          <span className="mono" style={{ fontSize: '1.65rem', fontWeight: 900, color: '#b45309', letterSpacing: '-0.02em' }}>
                            {tx.queue_no}
                          </span>
                          <span className="badge badge-pending">
                            ⏳ Pending
                          </span>
                          {tx.is_priority && (
                            <span className="badge badge-priority">
                              ★ Priority
                            </span>
                          )}
                          {(tx.counter_name || tx.division_name) && (
                            <span className="badge badge-serving">
                              {tx.counter_name || tx.division_name}
                            </span>
                          )}
                        </div>
                        <span className="mono" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          {tx.transaction_no}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.88rem', marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                          <span style={{ fontWeight: 700, color: '#0f172a' }}>{tx.service_name}</span>
                          {tx.division_name && (
                            <span style={{
                              fontSize: '0.72rem',
                              backgroundColor: 'rgba(3, 5, 186, 0.08)',
                              color: 'var(--dole-blue)',
                              fontWeight: 700,
                              padding: '0.12rem 0.45rem',
                              borderRadius: '4px',
                              border: '1px solid rgba(3, 5, 186, 0.15)',
                            }}>
                              {tx.division_name}
                            </span>
                          )}
                        </div>
                        {tx.client_name && (
                          <div style={{ color: '#475569', fontSize: '0.85rem' }}>
                            Client: <strong>{tx.client_name}</strong>
                          </div>
                        )}
                        {Array.isArray(tx.group_member_names) && tx.group_member_names.length > 0 && (
                          <div style={{
                            marginTop: '0.3rem',
                            padding: '0.35rem 0.55rem',
                            backgroundColor: '#f8fafc',
                            borderRadius: '5px',
                            border: '1px solid #e2e8f0',
                            fontSize: '0.75rem',
                            color: '#334155'
                          }}>
                            <div style={{ fontWeight: 600, color: 'var(--dole-blue)', marginBottom: '0.15rem', fontSize: '0.72rem' }}>
                              👥 Members ({tx.group_member_names.length}):
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                              {tx.group_member_names.map((name, idx) => (
                                <span key={idx} style={{
                                  backgroundColor: '#ffffff',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '3px',
                                  padding: '0.1rem 0.35rem',
                                  fontSize: '0.7rem',
                                }}>
                                  {idx + 1}. {name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                          <span>
                            Checked in: {tx.checked_in_at ? new Date(tx.checked_in_at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--'}
                          </span>
                          {tx.called_at && (
                            <span>
                              • Last served: {new Date(tx.called_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Assigned Personnel Row */}
                      <div style={{
                        marginBottom: '0.75rem',
                        padding: '0.45rem 0.75rem',
                        borderRadius: '8px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #fde68a',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.83rem' }}>
                          <span>👤</span>
                          {tx.assigned_personnel ? (
                            <span style={{ color: '#475569' }}>
                              Assigned Officer: <strong style={{ color: '#0f172a' }}>{tx.assigned_personnel}</strong>
                            </span>
                          ) : (
                            <span style={{ color: '#b45309', fontWeight: 700 }}>
                              No officer assigned {tx.default_officer && <span style={{ fontWeight: 600, fontSize: '0.78rem', color: '#64748b' }}>· Default: {tx.default_officer}</span>}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenAssignModal(tx)}
                          className="btn btn-ghost btn-xs"
                          style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--dole-blue)', textDecoration: 'underline' }}
                        >
                          {tx.assigned_personnel ? 'Change' : 'Assign'}
                        </button>
                      </div>

                      {/* Pending Card Actions */}
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.45rem',
                        borderTop: '1px solid #fef3c7',
                        paddingTop: '0.65rem',
                      }}>
                        <button
                          type="button"
                          onClick={() => handleCallSpecific(tx)}
                          disabled={actionLoading}
                          className="btn btn-primary btn-sm"
                          style={{ fontWeight: 700 }}
                          title="Resume serving this client at your counter"
                        >
                          ▶ Resume Serving
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAction(tx.id, 'done')}
                          disabled={actionLoading}
                          className="btn btn-success btn-sm"
                          style={{ fontWeight: 700 }}
                          title="Mark service as completed and unlock CSM survey"
                        >
                          ✓ Mark Done
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAction(tx.id, 'requeue')}
                          disabled={actionLoading}
                          className="btn btn-outline btn-sm"
                        >
                          ↩ Return to Queue
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAction(tx.id, 'cancel')}
                          disabled={actionLoading}
                          className="btn btn-outline btn-sm"
                          style={{ color: 'var(--dole-red)' }}
                        >
                          Cancel
                        </button>

                        <button
                          type="button"
                          onClick={() => setPrintedTx(tx)}
                          className="btn btn-outline btn-sm"
                        >
                          🖨️ Slip
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="staff-empty-card" style={{ padding: '1.75rem 1.25rem' }}>
                    <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
                      No pending multi-day transactions for <strong>{currentCounterName || 'this counter'}</strong>. Click <strong>⏳ Pending</strong> on an active Now Serving ticket to hold it here.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Waiting Queue Column */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <h2 style={{ fontSize: '1.18rem', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ color: '#d97706' }}>
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <span>Waiting in Line</span>
                </h2>
                {currentCounterName && (
                  <span style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: '#64748b',
                    backgroundColor: '#f1f5f9',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                  }}>
                    {currentCounterName}
                  </span>
                )}
              </div>
              <span className="badge" style={{
                backgroundColor: queueData.waiting?.length > 0 ? '#fffbeb' : '#f1f5f9',
                color: queueData.waiting?.length > 0 ? '#b45309' : '#64748b',
                border: queueData.waiting?.length > 0 ? '1px solid #fde68a' : '1px solid #e2e8f0',
                fontWeight: 700,
              }}>
                {queueData.waiting?.length || 0} Waiting
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {queueData.waiting?.length > 0 ? (
                queueData.waiting.map((tx, idx) => (
                  <div key={tx.id} className="card" style={{
                    padding: '1rem 1.15rem',
                    borderLeft: tx.is_priority ? '5px solid var(--dole-gold)' : '5px solid #cbd5e1',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                  }}>
                    <div className="flex justify-between items-center" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div className="flex items-center gap-2">
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: '#64748b',
                          backgroundColor: '#f1f5f9',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                        }}>
                          #{idx + 1}
                        </span>
                        <span className="mono" style={{ fontSize: '1.45rem', fontWeight: 900, color: '#0f172a' }}>
                          {tx.queue_no}
                        </span>
                        {tx.is_priority && (
                          <span className="badge badge-priority">
                            ★ Priority
                          </span>
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
                              padding: '0.25rem 0.55rem',
                              borderRadius: '6px',
                              fontWeight: 700,
                              maxWidth: '145px',
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
                              style={{ padding: '0.15rem 0.35rem', fontSize: '0.75rem' }}
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
                              padding: '0.25rem 0.65rem',
                              borderRadius: '6px',
                            }}
                            title="Assign personnel to enable Call"
                          >
                            👤 Assign {tx.default_officer ? `(${tx.default_officer})` : 'Officer'}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleCallSpecific(tx)}
                          disabled={actionLoading || !tx.assigned_personnel}
                          className="btn btn-primary btn-sm"
                          style={{
                            minHeight: '34px',
                            borderRadius: '6px',
                            fontWeight: 700,
                            padding: '0.35rem 0.85rem',
                            opacity: !tx.assigned_personnel ? 0.45 : 1,
                            cursor: !tx.assigned_personnel ? 'not-allowed' : 'pointer',
                          }}
                          title={!tx.assigned_personnel ? 'Help desk officer must assign a personnel to this queue number before calling' : 'Call this client'}
                        >
                          📢 Call
                        </button>
                      </div>
                    </div>

                    <div style={{ fontSize: '0.85rem', marginTop: '0.45rem', color: 'var(--text-secondary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <strong style={{ color: '#0f172a' }}>{tx.service_name}</strong>
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
                      {tx.client_name && <div style={{ marginTop: '0.2rem', color: '#475569' }}>Client: <strong>{tx.client_name}</strong></div>}
                      {Array.isArray(tx.group_member_names) && tx.group_member_names.length > 0 && (
                        <div style={{ marginTop: '0.25rem', fontSize: '0.74rem', color: '#475569' }}>
                          <span style={{ fontWeight: 600, color: 'var(--dole-blue)' }}>👥 Members:</span> {tx.group_member_names.join(', ')}
                        </div>
                      )}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <span>Checked in: {new Date(tx.checked_in_at).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="staff-empty-card">
                  <div className="staff-empty-icon-circle staff-empty-circle-green">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                      <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                  </div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.35rem 0' }}>
                    Queue is Clear
                  </h3>
                  <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '0 0 0.75rem 0' }}>
                    {currentCounterName ? `No clients currently waiting for ${currentCounterName}.` : 'No clients waiting in line right now.'}
                  </p>
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    fontSize: '0.785rem',
                    color: '#059669',
                    backgroundColor: '#ecfdf5',
                    padding: '0.35rem 0.85rem',
                    borderRadius: '6px',
                    border: '1px solid #a7f3d0',
                  }}>
                    <span className="pulse-live-dot" />
                    <span>Real-time listener active • Auto-refreshes on check-in</span>
                  </div>
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
                    onClick={() => {
                      const next = walkinRepName === 'Anonymous' ? '' : 'Anonymous';
                      setWalkinRepName(next);
                      if (next === 'Anonymous') {
                        setWalkinMemberNames(prev => {
                          const updated = [...prev];
                          if (!updated[0] || updated[0] === walkinRepName) {
                            updated[0] = 'Anonymous';
                          }
                          return updated;
                        });
                      }
                    }}
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
                  onChange={(e) => {
                    const val = e.target.value;
                    setWalkinRepName(val);
                    setWalkinMemberNames(prev => {
                      const updated = [...prev];
                      if (!updated[0] || updated[0] === walkinRepName) {
                        updated[0] = val;
                      }
                      return updated;
                    });
                  }}
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
                      max="50"
                      required
                      value={walkinGroupSize}
                      onChange={(e) => {
                        const val = e.target.value;
                        setWalkinGroupSize(val);
                        const size = parseInt(val, 10);
                        if (!isNaN(size) && size >= 2 && size <= 50) {
                          setWalkinMemberNames(prev => {
                            const arr = [...prev];
                            while (arr.length < size) arr.push('');
                            return arr.slice(0, size);
                          });
                        }
                      }}
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

              {/* Dynamic Member Name Inputs */}
              {(() => {
                const size = parseInt(walkinGroupSize, 10);
                const count = isNaN(size) || size < 2 ? 2 : Math.min(size, 50);
                return count > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.85rem' }}>
                      👤 Member Names *
                    </label>
                    <div style={{
                      maxHeight: '220px',
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                      padding: '0.75rem',
                      background: '#f8fafc',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                    }}>
                      {Array.from({ length: count }).map((_, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: 'var(--text-muted)',
                            minWidth: '18px',
                            textAlign: 'right',
                          }}>
                            {i + 1}.
                          </span>
                          <input
                            type="text"
                            required
                            value={walkinMemberNames[i] || ''}
                            onChange={(e) => {
                              const updated = [...walkinMemberNames];
                              updated[i] = e.target.value;
                              setWalkinMemberNames(updated);
                            }}
                            placeholder={i === 0 ? "Member 1 (Representative full name)" : `Member ${i + 1} full name`}
                            style={{
                              flex: 1,
                              fontSize: '0.85rem',
                              padding: '0.4rem 0.65rem',
                              minHeight: '36px',
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                      Enter the full name of each group member. All names are required.
                    </p>
                  </div>
                );
              })()}
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

            {resolvedDefaultOfficer && (
              <div style={{
                marginTop: '0.65rem',
                padding: '0.5rem 0.75rem',
                backgroundColor: '#ffffff',
                border: '1.5px solid #93c5fd',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: '#1e40af', fontSize: '0.84rem' }}>
                    ⭐ Default Officer:
                  </span>
                  <strong style={{ color: '#0f172a', fontSize: '0.88rem' }}>{resolvedDefaultOfficer}</strong>
                  {(() => {
                    const busy = getBusyInfo(resolvedDefaultOfficer);
                    if (busy) {
                      return (
                        <span style={{
                          backgroundColor: '#fee2e2',
                          color: '#b91c1c',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.2rem',
                        }}>
                          🚫 Unavailable (Handling Queue #{busy.queue_no})
                        </span>
                      );
                    }
                    return (
                      <span style={{
                        backgroundColor: '#dcfce7',
                        color: '#15803d',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.2rem',
                      }}>
                        ✓ Available
                      </span>
                    );
                  })()}
                </div>
                {assignPersonnelName !== resolvedDefaultOfficer && (
                  <button
                    type="button"
                    onClick={() => setAssignPersonnelName(resolvedDefaultOfficer)}
                    className="btn btn-ghost btn-xs"
                    style={{
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      color: 'var(--dole-blue)',
                      backgroundColor: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Select Default
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Select Registered DOLE Personnel with Instant Real-Time Search */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label style={{ fontWeight: 700, fontSize: '0.86rem', margin: 0 }}>
                Select DOLE Personnel (Instant Real-time Search) *
              </label>
              <span style={{ fontSize: '0.75rem', color: 'var(--dole-blue)', fontWeight: 600 }}>
                {availableEligiblePersonnel.length} available in {assignTx?.division_name || 'division'}
                {eligiblePersonnel.length - availableEligiblePersonnel.length > 0 && (
                  <span style={{ color: '#b91c1c', marginLeft: '0.35rem' }}>
                    ({eligiblePersonnel.length - availableEligiblePersonnel.length} busy)
                  </span>
                )}
              </span>
            </div>
            <SearchablePersonnelSelect
              personnel={eligiblePersonnel}
              value={assignPersonnelName}
              onChange={(name) => setAssignPersonnelName(name)}
              placeholder={`-- Select ${assignTx?.division_name || ''} Personnel --`}
              searchPlaceholder={`Type to search ${assignTx?.division_name || ''} personnel...`}
              serviceDivision={assignTx?.division_name}
              isPersonnelBusy={getBusyInfo}
              defaultOfficerName={resolvedDefaultOfficer}
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
                borderColor: (matchedIneligible || matchedBusyOfficer) ? 'var(--dole-red)' : undefined,
              }}
            />
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
              Select from dropdown above or type name manually.
            </span>
            {matchedBusyOfficer && (
              <div style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 'var(--radius-sm)',
                padding: '0.65rem 0.85rem',
                color: '#991b1b',
                fontSize: '0.84rem',
                marginTop: '0.5rem',
                lineHeight: 1.45,
              }}>
                🚫 <strong>Officer Unavailable:</strong> <strong>{matchedBusyOfficer.rawName || assignPersonnelName}</strong> is currently assigned to <strong>Queue #{matchedBusyOfficer.queue_no}</strong> ({matchedBusyOfficer.status}) and cannot be assigned to another client until their current transaction is completed.
              </div>
            )}
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
                  const busyInfo = getBusyInfo(name);
                  const isBusy = Boolean(busyInfo);
                  const isIneligible = ineligiblePersonnel.some(
                    p => p.full_name?.toLowerCase().trim() === name.toLowerCase().trim()
                  );
                  const isDisabled = isBusy || isIneligible;

                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        borderRadius: '20px',
                        backgroundColor: assignPersonnelName === name
                          ? 'rgba(3, 5, 186, 0.1)'
                          : isDisabled
                          ? '#f1f5f9'
                          : '#f8fafc',
                        border: assignPersonnelName === name
                          ? '1.5px solid var(--dole-blue)'
                          : isDisabled
                          ? '1px dashed #cbd5e1'
                          : '1px solid #cbd5e1',
                        opacity: isDisabled ? 0.6 : 1,
                        overflow: 'hidden',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <button
                        type="button"
                        disabled={isDisabled}
                        onClick={() => {
                          if (!isDisabled) setAssignPersonnelName(name);
                        }}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          padding: '0.25rem 0.55rem',
                          cursor: isDisabled ? 'not-allowed' : 'pointer',
                          fontWeight: assignPersonnelName === name ? 700 : 500,
                          color: assignPersonnelName === name
                            ? 'var(--dole-blue)'
                            : isDisabled
                            ? '#64748b'
                            : 'var(--text-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          fontSize: '0.8rem',
                        }}
                        title={
                          isBusy
                            ? `Unavailable: Currently assigned to Queue #${busyInfo.queue_no} (${busyInfo.status})`
                            : isIneligible
                            ? `Cannot assign: belongs to another division`
                            : `Select ${name}`
                        }
                      >
                        <span>{isDisabled ? '🚫' : '👤'}</span>
                        <span style={{ textDecoration: isDisabled ? 'line-through' : 'none' }}>
                          {name}
                        </span>
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
              disabled={actionLoading || !assignPersonnelName.trim() || Boolean(matchedIneligible) || Boolean(matchedBusyOfficer)}
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
