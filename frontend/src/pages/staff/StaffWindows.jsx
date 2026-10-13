import React, { useState, useEffect, useCallback } from 'react';
import { staffApi } from '../../api/staff';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/Modal';
import { PageHeader, Notice } from '../../components/ui';

const POLL_MS = 5000;

const STATE_STYLES = {
  mine: { label: 'Your Window', bg: 'var(--dole-gold-light)', color: 'var(--dole-gold-dark)', border: '#fde68a', accent: 'var(--dole-gold)' },
  occupied: { label: 'Occupied', bg: 'var(--dole-blue-light)', color: 'var(--dole-blue)', border: 'rgba(3, 5, 186, 0.2)', accent: 'var(--dole-blue)' },
  available: { label: 'Available', bg: 'var(--dole-green-light)', color: '#047857', border: '#a7f3d0', accent: 'var(--dole-green)' },
  inactive: { label: 'Inactive', bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0', accent: '#cbd5e1' },
};

function windowState(w) {
  if (!w.is_active) return 'inactive';
  if (w.is_mine) return 'mine';
  if (w.assigned_user) return 'occupied';
  return 'available';
}

export default function StaffWindows() {
  const { user } = useAuth();
  const offices = user?.assigned_offices || [];

  const [selectedOffice, setSelectedOffice] = useState(() => localStorage.getItem('ctms_staff_office') || '');
  const [windows, setWindows] = useState([]);
  const [myWindow, setMyWindow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', text }

  const [formModal, setFormModal] = useState(null); // { mode: 'create' | 'rename', window? }
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formError, setFormError] = useState('');
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, confirmLabel, danger, onConfirm }

  useEffect(() => {
    if (offices.length > 0 && !offices.some(o => String(o.id) === String(selectedOffice))) {
      setSelectedOffice(String(offices[0].id));
    }
  }, [offices, selectedOffice]);

  const fetchWindows = useCallback(async () => {
    if (!selectedOffice) return;
    try {
      const data = await staffApi.getWindows(selectedOffice);
      setWindows(data.windows || []);
      setMyWindow(data.my_window);
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'Failed to load windows.' });
    } finally {
      setLoading(false);
    }
  }, [selectedOffice]);

  useEffect(() => {
    setLoading(true);
    fetchWindows();
    const timer = setInterval(fetchWindows, POLL_MS);
    return () => clearInterval(timer);
  }, [fetchWindows]);

  const flash = (type, text) => {
    setNotice({ type, text });
    if (type === 'success') setTimeout(() => setNotice(null), 4000);
  };

  const runAction = async (id, fn, successText) => {
    try {
      setBusyId(id);
      await fn();
      if (successText) flash('success', successText);
      await fetchWindows();
    } catch (err) {
      flash('error', err.message || 'Action failed.');
      await fetchWindows();
    } finally {
      setBusyId(null);
    }
  };

  const handleOfficeChange = (e) => {
    setSelectedOffice(e.target.value);
    localStorage.setItem('ctms_staff_office', e.target.value);
    localStorage.removeItem('ctms_staff_counter');
  };

  const openCreate = () => {
    setFormModal({ mode: 'create' });
    setFormName(`Window ${windows.length + 1}`);
    setFormDescription('');
    setFormError('');
  };

  const openRename = (w) => {
    setFormModal({ mode: 'rename', window: w });
    setFormName(w.name);
    setFormDescription(w.description || '');
    setFormError('');
  };

  const submitForm = async (e) => {
    e.preventDefault();
    try {
      setFormError('');
      if (formModal.mode === 'create') {
        const created = await staffApi.createWindow(selectedOffice, formName, formDescription);
        flash('success', `${created.name} is ready.`);
      } else {
        await staffApi.updateWindow(formModal.window.id, { name: formName, description: formDescription });
        flash('success', 'Window updated.');
      }
      setFormModal(null);
      await fetchWindows();
    } catch (err) {
      setFormError(err.message || 'Could not save the window.');
    }
  };

  const askRelease = (w) => {
    if (w.is_mine) {
      runAction(w.id, () => staffApi.releaseWindow(w.id), `You released ${w.name}.`);
      return;
    }
    setConfirmModal({
      title: `Release ${w.name}?`,
      message: `${w.assigned_user_name} will be removed from ${w.name}. Only do this if they are no longer working at this window.`,
      confirmLabel: 'Release Window',
      danger: true,
      onConfirm: () => runAction(w.id, () => staffApi.releaseWindow(w.id), `${w.name} released.`),
    });
  };

  const askToggleActive = (w) => {
    if (!w.is_active) {
      runAction(w.id, () => staffApi.updateWindow(w.id, { is_active: true }), `${w.name} activated.`);
      return;
    }
    setConfirmModal({
      title: `Deactivate ${w.name}?`,
      message: w.assigned_user
        ? `${w.assigned_user_name} will be released and nobody can use ${w.name} until it is activated again.`
        : `Nobody can use ${w.name} until it is activated again.`,
      confirmLabel: 'Deactivate',
      danger: true,
      onConfirm: () => runAction(w.id, () => staffApi.updateWindow(w.id, { is_active: false }), `${w.name} deactivated.`),
    });
  };

  const askArchive = (w) => {
    setConfirmModal({
      title: `Archive ${w.name}?`,
      message: `${w.name} will be removed from this office and the TV display. Past transactions keep their window history. Creating a window with the same name later restores it.`,
      confirmLabel: 'Archive Window',
      danger: true,
      onConfirm: () => runAction(w.id, () => staffApi.archiveWindow(w.id), `${w.name} archived.`),
    });
  };

  const officeName = offices.find(o => String(o.id) === String(selectedOffice))?.name || '';
  const myWindowHere = myWindow && String(myWindow.office) === String(selectedOffice);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        <PageHeader title="Service Windows" subtitle="Take a window before calling clients. Every window in an office serves the same shared queue.">
          {offices.length > 1 && (
              <select
                value={selectedOffice}
                onChange={handleOfficeChange}
                className="staff-custom-select"
                style={{ minWidth: '240px' }}
                aria-label="Office"
              >
                {offices.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
            <button onClick={openCreate} className="btn btn-primary" disabled={!selectedOffice} style={{ minHeight: '44px' }}>
              + Add Window
            </button>
        </PageHeader>

        {/* Where am I working? */}
        <div className="card" style={{
          padding: '1rem 1.25rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
          borderLeft: `5px solid ${myWindow ? 'var(--dole-gold)' : '#cbd5e1'}`,
        }}>
          <div style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
            {myWindow ? (
              <>
                You are working at <strong style={{ color: 'var(--text-primary)' }}>{myWindow.name}</strong>
                {!myWindowHere && <> in <strong>{myWindow.office_name}</strong></>}.
              </>
            ) : (
              <>You are not at a window. Choose an <strong>Available</strong> window below and press <strong>Assign Myself</strong>.</>
            )}
          </div>
          {myWindow && (
            <button
              className="btn btn-outline btn-sm"
              disabled={busyId === myWindow.id}
              onClick={() => runAction(myWindow.id, () => staffApi.releaseWindow(myWindow.id), `You released ${myWindow.name}.`)}
            >
              Release {myWindow.name}
            </button>
          )}
        </div>

        <Notice notice={notice} onDismiss={() => setNotice(null)} />

        {loading ? (
          <div className="staff-empty-card" style={{ color: 'var(--text-muted)' }}>Loading windows…</div>
        ) : windows.length === 0 ? (
          <div className="staff-empty-card">
            <h2 style={{ fontSize: '1.15rem', margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>No windows yet{officeName ? ` for ${officeName}` : ''}</h2>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 1.25rem' }}>
              Create one window for each counter where staff serve clients, e.g. Window 1, Window 2.
            </p>
            <button onClick={openCreate} className="btn btn-primary">+ Add Window</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '1rem' }}>
            {windows.map(w => {
              const state = windowState(w);
              const st = STATE_STYLES[state];
              const busy = busyId === w.id;
              return (
                <div key={w.id} className="card" style={{
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  borderTop: `5px solid ${st.accent}`,
                  opacity: w.is_active ? 1 : 0.8,
                }}>
                  <div style={{ padding: '1.1rem 1.25rem 0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div style={{ minWidth: 0 }}>
                      <h2 style={{ fontSize: '1.3rem', margin: 0, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{w.name}</h2>
                      {w.description && (
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>{w.description}</p>
                      )}
                    </div>
                    <span className="badge" style={{ backgroundColor: st.bg, color: st.color, border: `1px solid ${st.border}`, flexShrink: 0 }}>
                      {st.label}
                    </span>
                  </div>

                  <div style={{ padding: '0 1.25rem', display: 'grid', gap: '0.65rem', flex: 1 }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Personnel</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 600, color: w.assigned_user ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {w.assigned_user ? (w.is_mine ? `${w.assigned_user_name} (you)` : w.assigned_user_name) : 'Unassigned'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Now Serving</div>
                      {w.current_client ? (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--dole-blue)' }}>{w.current_client.queue_no}</span>
                          {w.current_client.is_priority && <span className="badge badge-priority">Priority</span>}
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', width: '100%' }}>{w.current_client.service_name}</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>Idle</div>
                      )}
                    </div>
                  </div>

                  <div style={{ padding: '1rem 1.25rem', marginTop: '0.75rem', borderTop: 'var(--border-hairline)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {state === 'available' && (
                      <button
                        className="btn btn-primary w-full"
                        disabled={busy || !!myWindow}
                        title={myWindow ? `Release ${myWindow.name} first` : undefined}
                        onClick={() => runAction(w.id, () => staffApi.assignMeToWindow(w.id), `You are now at ${w.name}.`)}
                      >
                        {myWindow ? `Release ${myWindow.name} first` : 'Assign Myself'}
                      </button>
                    )}
                    {state === 'mine' && (
                      <button className="btn btn-outline w-full" disabled={busy} onClick={() => askRelease(w)}>Release Window</button>
                    )}
                    {state === 'occupied' && (
                      <button className="btn btn-outline w-full" disabled={busy} onClick={() => askRelease(w)}>Release Personnel</button>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button className="btn btn-outline btn-sm" style={{ flex: 1 }} disabled={busy} onClick={() => openRename(w)}>Rename</button>
                      <button className="btn btn-outline btn-sm" style={{ flex: 1 }} disabled={busy} onClick={() => askToggleActive(w)}>
                        {w.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className="btn btn-outline btn-sm" style={{ flex: 1, color: 'var(--dole-red-dark)' }} disabled={busy} onClick={() => askArchive(w)}>Archive</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <Modal
        isOpen={!!formModal}
        onClose={() => setFormModal(null)}
        title={formModal?.mode === 'rename' ? `Rename ${formModal.window.name}` : `Add Window${officeName ? ` — ${officeName}` : ''}`}
        maxWidth="440px"
      >
        <form onSubmit={submitForm}>
          <label htmlFor="window-name">Window name</label>
          <input
            id="window-name"
            type="text"
            required
            autoFocus
            maxLength={50}
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="e.g. Window 1"
          />

          <label htmlFor="window-description" style={{ marginTop: '1rem' }}>Description (optional)</label>
          <input
            id="window-description"
            type="text"
            maxLength={120}
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            placeholder="e.g. Labor inspection and SEnA cases"
          />
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
            Shown to staff on this window's card, e.g. what it's for or which services it handles.
          </div>

          {formError && (
            <div style={{ color: 'var(--dole-red-dark)', fontSize: '0.85rem', marginTop: '0.5rem' }}>{formError}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
            <button type="button" className="btn btn-outline" onClick={() => setFormModal(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary">{formModal?.mode === 'rename' ? 'Save' : 'Create Window'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!confirmModal} onClose={() => setConfirmModal(null)} title={confirmModal?.title} maxWidth="440px">
        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{confirmModal?.message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem' }}>
          <button className="btn btn-outline" onClick={() => setConfirmModal(null)}>Cancel</button>
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
