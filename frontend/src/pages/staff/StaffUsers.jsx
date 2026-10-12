import { useState, useEffect, useCallback } from 'react';
import { staffApi } from '../../api/staff';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/Modal';
import { PageHeader, Notice } from '../../components/ui';

const EMPTY_FORM = {
  username: '',
  email: '',
  password: '',
  confirm_password: '',
  role: 'PERSONNEL',
  first_name: '',
  middle_name: '',
  last_name: '',
  employee_id: '',
  office: '',
  position: '',
};

const fieldGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.9rem 1rem' };
const sectionHeading = {
  fontSize: '0.78rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--dole-blue)',
  margin: '0 0 0.75rem',
};

function formatDate(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function RoleBadge({ account }) {
  if (account.role === 'SYSTEM_ADMIN') return <span className="badge" style={{ background: '#1e293b', color: '#fff' }}>System Admin</span>;
  if (account.is_regional_admin) return <span className="badge badge-priority">Administrator</span>;
  return <span className="badge badge-waiting">Personnel</span>;
}

export default function StaffUsers() {
  const { user: me } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [offices, setOffices] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);

  const [filters, setFilters] = useState({ search: '', office: '', role: '', status: '' });

  const [formModal, setFormModal] = useState(null); // { mode: 'create' | 'edit', account? }
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetError, setResetError] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

  const flash = (type, text) => {
    setNotice({ type, text });
    if (type === 'success') setTimeout(() => setNotice(curr => (curr?.text === text ? null : curr)), 4500);
  };

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await staffApi.getEmployees(filters);
      setAccounts(Array.isArray(data) ? data : []);
    } catch (err) {
      flash('error', err.message || 'Failed to load accounts.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(fetchAccounts, 250);
    return () => clearTimeout(t);
  }, [fetchAccounts]);

  useEffect(() => {
    staffApi.getOffices().then(d => setOffices(Array.isArray(d) ? d : [])).catch(() => {});
    staffApi.getPositions().then(d => setPositions(Array.isArray(d) ? d : (d?.results || []))).catch(() => {});
  }, []);

  const setFilter = (key, value) => setFilters(f => ({ ...f, [key]: value }));
  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const selectedOffice = offices.find(o => String(o.id) === String(form.office));
  const adminAllowed = selectedOffice?.office_type === 'REGIONAL';

  // An Administrator role only means something on a regional account.
  useEffect(() => {
    if (form.role === 'ADMIN' && selectedOffice && !adminAllowed) setField('role', 'PERSONNEL');
  }, [form.role, selectedOffice, adminAllowed]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, office: filters.office || '' });
    setFormError('');
    setFormModal({ mode: 'create' });
  };

  const openEdit = (account) => {
    setForm({
      ...EMPTY_FORM,
      username: account.username,
      email: account.email || '',
      role: account.role === 'ADMIN' ? 'ADMIN' : 'PERSONNEL',
      first_name: account.first_name || '',
      middle_name: account.middle_name || '',
      last_name: account.last_name || '',
      employee_id: account.employee_id || '',
      office: account.office ? String(account.office) : '',
      position: account.position || '',
    });
    setFormError('');
    setFormModal({ mode: 'edit', account });
  };

  const submitForm = async (e) => {
    e.preventDefault();
    setFormError('');
    if (formModal.mode === 'create' && form.password !== form.confirm_password) {
      setFormError('Password and confirmation do not match.');
      return;
    }
    const payload = {
      email: form.email.trim(),
      role: form.role,
      first_name: form.first_name.trim(),
      middle_name: form.middle_name.trim(),
      last_name: form.last_name.trim(),
      employee_id: form.employee_id.trim(),
      office: form.office ? Number(form.office) : null,
      position: form.position.trim(),
    };
    try {
      setSaving(true);
      if (formModal.mode === 'create') {
        const created = await staffApi.createEmployee({
          ...payload,
          username: form.username.trim(),
          password: form.password,
          confirm_password: form.confirm_password,
        });
        flash('success', `Account ${created.username} created. They will be asked to change the password at first login.`);
      } else {
        await staffApi.updateEmployee(formModal.account.id, payload);
        flash('success', `Account ${formModal.account.username} updated.`);
      }
      setFormModal(null);
      fetchAccounts();
    } catch (err) {
      setFormError(err.message || 'Could not save the account.');
    } finally {
      setSaving(false);
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setResetError('');
    if (resetPassword !== resetConfirm) {
      setResetError('Password and confirmation do not match.');
      return;
    }
    try {
      const res = await staffApi.resetEmployeePassword(resetTarget.id, resetPassword, resetConfirm);
      setResetTarget(null);
      flash('success', res.message || 'Temporary password set.');
      fetchAccounts();
    } catch (err) {
      setResetError(err.message || 'Could not reset the password.');
    }
  };

  const toggleActive = (account) => {
    const deactivating = account.is_active;
    setConfirmModal({
      title: `${deactivating ? 'Deactivate' : 'Activate'} ${account.username}?`,
      message: deactivating
        ? 'They will no longer be able to log in, and they are released from their window. History stays intact.'
        : 'They will be able to log in again.',
      confirmLabel: deactivating ? 'Deactivate' : 'Activate',
      danger: deactivating,
      onConfirm: async () => {
        try {
          await staffApi.toggleEmployeeActive(account.id);
          flash('success', `${account.username} ${deactivating ? 'deactivated' : 'activated'}.`);
          fetchAccounts();
        } catch (err) {
          flash('error', err.message);
        }
      },
    });
  };

  const deleteAccount = (account) => setConfirmModal({
    title: `Delete ${account.username}?`,
    message: 'Only accounts that never handled a transaction can be deleted. Otherwise, deactivate the account to keep its history.',
    confirmLabel: 'Delete Account',
    danger: true,
    onConfirm: async () => {
      try {
        await staffApi.deleteEmployee(account.id);
        flash('success', `${account.username} deleted.`);
        fetchAccounts();
      } catch (err) {
        flash('error', err.message);
      }
    },
  });

  const filterOffices = me?.oversight_offices?.length ? me.oversight_offices : offices;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-ground)' }}>

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        <PageHeader title="User Management" subtitle="Each account holds the login and the personnel details of one staff member.">
          <button className="btn btn-primary" onClick={openCreate} style={{ minHeight: '44px' }}>+ New Account</button>
        </PageHeader>

        <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
          <input type="search" value={filters.search} onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Search name, username, ID, position" aria-label="Search accounts" style={{ minHeight: '44px' }} />
          <select value={filters.office} onChange={(e) => setFilter('office', e.target.value)} aria-label="Office" style={{ minHeight: '44px' }}>
            <option value="">All offices</option>
            {filterOffices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={filters.role} onChange={(e) => setFilter('role', e.target.value)} aria-label="Role" style={{ minHeight: '44px' }}>
            <option value="">All roles</option>
            <option value="PERSONNEL">Personnel</option>
            <option value="ADMIN">Administrator</option>
          </select>
          <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status" style={{ minHeight: '44px' }}>
            <option value="">Active and inactive</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <Notice notice={notice} onDismiss={() => setNotice(null)} />

        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', minWidth: '860px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Name</th>
                <th style={{ padding: '0.75rem 1rem' }}>Office</th>
                <th style={{ padding: '0.75rem 1rem' }}>Position</th>
                <th style={{ padding: '0.75rem 1rem' }}>Role</th>
                <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                <th style={{ padding: '0.75rem 1rem' }}>Last login</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading accounts…</td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No accounts match these filters.</td></tr>
              ) : accounts.map(a => (
                <tr key={a.id} style={{ borderTop: 'var(--border-hairline)', opacity: a.is_active ? 1 : 0.6 }}>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{a.full_name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {a.username}{a.employee_id && a.employee_id !== a.username ? ` · ID ${a.employee_id}` : ''}
                    </div>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <div>{a.office_name || '—'}</div>
                    {a.window_name && <div style={{ fontSize: '0.78rem', color: '#047857', fontWeight: 600 }}>At {a.window_name}</div>}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{a.position || '—'}</td>
                  <td style={{ padding: '0.75rem 1rem' }}><RoleBadge account={a} /></td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span className={a.is_active ? 'badge badge-done' : 'badge badge-waiting'}>{a.is_active ? 'Active' : 'Inactive'}</span>
                    {a.must_change_password && a.is_active && (
                      <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '0.2rem' }}>Must change password</div>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(a.last_login)}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(a)}>Edit</button>
                      <button className="btn btn-outline btn-sm" onClick={() => { setResetTarget(a); setResetPassword(''); setResetConfirm(''); setResetError(''); }}>Reset Password</button>
                      {a.id !== me?.id && (
                        <>
                          <button className="btn btn-outline btn-sm" onClick={() => toggleActive(a)}>{a.is_active ? 'Deactivate' : 'Activate'}</button>
                          <button className="btn btn-outline btn-sm" style={{ color: 'var(--dole-red-dark)' }} onClick={() => deleteAccount(a)}>Delete</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* Create / edit account */}
      <Modal
        isOpen={!!formModal}
        onClose={() => setFormModal(null)}
        title={formModal?.mode === 'edit' ? `Edit ${formModal.account.username}` : 'New Account'}
        maxWidth="720px"
      >
        {formModal && (
          <form onSubmit={submitForm}>
            {formError && (
              <div role="alert" style={{ background: 'var(--dole-red-light)', color: 'var(--dole-red-dark)', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '0.65rem 0.9rem', fontSize: '0.88rem', marginBottom: '1rem' }}>
                {formError}
              </div>
            )}

            <h3 style={sectionHeading}>Login account</h3>
            <div style={fieldGrid}>
              <div>
                <label htmlFor="acc-username">Username *</label>
                <input id="acc-username" required disabled={formModal.mode === 'edit'} value={form.username}
                  onChange={(e) => setField('username', e.target.value)} placeholder="e.g. JUAN_DELACRUZ" autoComplete="off" />
              </div>
              <div>
                <label htmlFor="acc-email">Email</label>
                <input id="acc-email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="name@dole.gov.ph" />
              </div>
              {formModal.mode === 'create' && (
                <>
                  <div>
                    <label htmlFor="acc-password">Temporary password *</label>
                    <input id="acc-password" type="password" required minLength={6} value={form.password}
                      onChange={(e) => setField('password', e.target.value)} autoComplete="new-password" />
                  </div>
                  <div>
                    <label htmlFor="acc-confirm">Confirm password *</label>
                    <input id="acc-confirm" type="password" required minLength={6} value={form.confirm_password}
                      onChange={(e) => setField('confirm_password', e.target.value)} autoComplete="new-password" />
                  </div>
                </>
              )}
              <div>
                <label htmlFor="acc-role">Role *</label>
                <select id="acc-role" value={form.role} onChange={(e) => setField('role', e.target.value)}>
                  <option value="PERSONNEL">Personnel</option>
                  <option value="ADMIN" disabled={!adminAllowed}>Administrator{adminAllowed ? '' : ' (regional office only)'}</option>
                </select>
              </div>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.5rem 0 1.4rem' }}>
              Administrators of the regional office manage accounts, services and reports for all offices.
              {formModal.mode === 'create' && ' New accounts must change their password at first login.'}
            </p>

            <h3 style={sectionHeading}>Personnel details</h3>
            <div style={fieldGrid}>
              <div>
                <label htmlFor="acc-first">First name *</label>
                <input id="acc-first" required value={form.first_name} onChange={(e) => setField('first_name', e.target.value)} />
              </div>
              <div>
                <label htmlFor="acc-middle">Middle name</label>
                <input id="acc-middle" value={form.middle_name} onChange={(e) => setField('middle_name', e.target.value)} />
              </div>
              <div>
                <label htmlFor="acc-last">Last name *</label>
                <input id="acc-last" required value={form.last_name} onChange={(e) => setField('last_name', e.target.value)} />
              </div>
              <div>
                <label htmlFor="acc-empid">Personnel ID</label>
                <input id="acc-empid" value={form.employee_id} onChange={(e) => setField('employee_id', e.target.value)} placeholder="Defaults to the username" />
              </div>
              <div>
                <label htmlFor="acc-office">Office *</label>
                <select id="acc-office" required value={form.office} onChange={(e) => setField('office', e.target.value)}>
                  <option value="">Choose office…</option>
                  {offices.map(o => (
                    <option key={o.id} value={o.id}>{o.name}{o.office_type === 'REGIONAL' ? ' (Regional)' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="acc-position">Position</label>
                <input id="acc-position" list="position-options" value={form.position} onChange={(e) => setField('position', e.target.value)} placeholder="e.g. Labor and Employment Officer I" />
                <datalist id="position-options">
                  {positions.map(p => <option key={p.id} value={p.title} />)}
                </datalist>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-outline" onClick={() => setFormModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{formModal.mode === 'edit' ? 'Save Changes' : 'Create Account'}</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Reset password */}
      <Modal isOpen={!!resetTarget} onClose={() => setResetTarget(null)} title={resetTarget ? `Reset password for ${resetTarget.username}` : ''} maxWidth="440px">
        <form onSubmit={submitReset}>
          {resetError && <div role="alert" style={{ color: 'var(--dole-red-dark)', fontSize: '0.88rem', marginBottom: '0.75rem' }}>{resetError}</div>}
          <label htmlFor="reset-pw">New temporary password</label>
          <input id="reset-pw" type="password" required minLength={6} value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} autoComplete="new-password" />
          <label htmlFor="reset-confirm" style={{ marginTop: '0.75rem' }}>Confirm password</label>
          <input id="reset-confirm" type="password" required minLength={6} value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} autoComplete="new-password" />
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>They will be asked to choose a new password at their next login.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-outline" onClick={() => setResetTarget(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Set Password</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!confirmModal} onClose={() => setConfirmModal(null)} title={confirmModal?.title} maxWidth="440px">
        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{confirmModal?.message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem' }}>
          <button className="btn btn-outline" onClick={() => setConfirmModal(null)}>Back</button>
          <button className={confirmModal?.danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => { const action = confirmModal.onConfirm; setConfirmModal(null); action(); }}>
            {confirmModal?.confirmLabel}
          </button>
        </div>
      </Modal>
    </div>
  );
}
