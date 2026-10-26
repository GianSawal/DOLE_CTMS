import { useState, useEffect, useCallback } from 'react';
import { staffApi } from '../../api/staff';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/Modal';
import { PageHeader, Notice } from '../../components/ui';
import Pagination, { paginateArray } from '../../components/Pagination';

const PAGE_SIZES = [10, 25, 50];

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
  if (account.role === 'DISPLAY') return <span className="badge" style={{ background: '#e0f2fe', color: '#075985' }}>TV Display</span>;
  if (account.role === 'REGISTRAR') return <span className="badge" style={{ background: '#f3e8ff', color: '#6b21a8' }}>Registration Desk</span>;
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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

  const setFilter = (key, value) => {
    setFilters(f => ({ ...f, [key]: value }));
    setCurrentPage(1);
  };
  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const selectedOffice = offices.find(o => String(o.id) === String(form.office));
  const adminAllowed = selectedOffice?.office_type === 'REGIONAL';
  // TV Display accounts (system admin only) just open their office's TV board after signing in
  const isTvForm = form.role === 'DISPLAY';
  // Registration Desk accounts (system admin only) can only register walk-in clients
  const isDeskForm = form.role === 'REGISTRAR';
  const isSinglePurpose = isTvForm || isDeskForm;
  const canCreateTv = Boolean(me?.is_superuser);

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
      role: ['ADMIN', 'DISPLAY', 'REGISTRAR'].includes(account.role) ? account.role : 'PERSONNEL',
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
        flash('success', created.role === 'DISPLAY'
          ? `TV account ${created.username} created. Sign in with it on the office TV; it opens the TV display automatically.`
          : created.role === 'REGISTRAR'
            ? `Registration Desk account ${created.username} created. It opens only the Registration page; the password must be changed at first login.`
            : `Account ${created.username} created. They will be asked to change the password at first login.`);
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

  const resetTwoFactor = (account) => setConfirmModal({
    title: `Reset two-factor sign-in for ${account.username}?`,
    message: 'For a lost or replaced phone. They are signed out everywhere and set up their authenticator app again at their next sign-in. Only do this after confirming it is really them asking.',
    confirmLabel: 'Reset 2FA',
    danger: true,
    onConfirm: async () => {
      try {
        const res = await staffApi.resetEmployeeTwoFactor(account.id);
        flash('success', res.message || `Two-factor sign-in reset for ${account.username}.`);
        fetchAccounts();
      } catch (err) {
        flash('error', err.message);
      }
    },
  });

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

  // Stay on a page that exists after the list shrinks (e.g. an account was deleted)
  const totalPages = Math.max(1, Math.ceil(accounts.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const pageAccounts = paginateArray(accounts, page, pageSize);
  const firstShown = accounts.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, accounts.length);

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
            {canCreateTv && <option value="DISPLAY">TV Display</option>}
            {canCreateTv && <option value="REGISTRAR">Registration Desk</option>}
          </select>
          <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status" style={{ minHeight: '44px' }}>
            <option value="">Active and inactive</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <Notice notice={notice} onDismiss={() => setNotice(null)} />

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
          <table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', minWidth: '860px' }}>
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
              ) : pageAccounts.map(a => (
                <tr key={a.id} style={{ borderTop: 'var(--border-hairline)', opacity: a.is_active ? 1 : 0.6 }}>
                  <td data-label="Name" style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{a.full_name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {a.username}{a.employee_id && a.employee_id !== a.username ? ` · ID ${a.employee_id}` : ''}
                    </div>
                  </td>
                  <td data-label="Office" style={{ padding: '0.75rem 1rem' }}>
                    <div>{a.office_name || '—'}</div>
                    {a.window_name && <div style={{ fontSize: '0.78rem', color: '#047857', fontWeight: 600 }}>At {a.window_name}</div>}
                  </td>
                  <td data-label="Position" style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{a.position || '—'}</td>
                  <td data-label="Role" style={{ padding: '0.75rem 1rem' }}><RoleBadge account={a} /></td>
                  <td data-label="Status" style={{ padding: '0.75rem 1rem' }}>
                    <span className={a.is_active ? 'badge badge-done' : 'badge badge-waiting'}>{a.is_active ? 'Active' : 'Inactive'}</span>
                    {a.must_change_password && a.is_active && (
                      <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '0.2rem' }}>Must change password</div>
                    )}
                    {a.two_factor !== 'n/a' && (
                      <div style={{ fontSize: '0.72rem', marginTop: '0.2rem', color: a.two_factor === 'on' ? '#047857' : 'var(--text-muted)' }}>
                        {a.two_factor === 'on' ? '2FA on' : '2FA: sets up at next sign-in'}
                      </div>
                    )}
                  </td>
                  <td data-label="Last login" style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(a.last_login)}</td>
                  <td data-label="Actions" style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(a)}>Edit</button>
                      <button className="btn btn-outline btn-sm" onClick={() => { setResetTarget(a); setResetPassword(''); setResetConfirm(''); setResetError(''); }}>Reset Password</button>
                      {a.two_factor === 'on' && (
                        <button className="btn btn-outline btn-sm" onClick={() => resetTwoFactor(a)}>Reset 2FA</button>
                      )}
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

          {!loading && accounts.length > 0 && (
            <>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                flexWrap: 'wrap',
                padding: '0.75rem 1.25rem',
                borderTop: 'var(--border-hairline)',
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
              }}>
                <span>Showing {firstShown}–{lastShown} of {accounts.length} account{accounts.length === 1 ? '' : 's'}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontWeight: 500, fontSize: '0.85rem' }}>
                  Rows per page
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                    style={{ minHeight: '36px', width: 'auto', padding: '0.25rem 2rem 0.25rem 0.6rem' }}
                  >
                    {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={(p) => { setCurrentPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                totalItems={accounts.length}
                pageSize={pageSize}
              />
            </>
          )}
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
                    <label htmlFor="acc-password">{isTvForm ? 'Password *' : 'Temporary password *'}</label>
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
                {/* TV, desk and staff accounts can't be switched into each other */}
                <select id="acc-role" value={form.role} onChange={(e) => setField('role', e.target.value)}
                  disabled={formModal.mode === 'edit' && isSinglePurpose}>
                  {!(formModal.mode === 'edit' && isSinglePurpose) && (
                    <>
                      <option value="PERSONNEL">Personnel</option>
                      <option value="ADMIN" disabled={!adminAllowed}>Administrator{adminAllowed ? '' : ' (regional office only)'}</option>
                    </>
                  )}
                  {(isTvForm || (formModal.mode === 'create' && canCreateTv)) && <option value="DISPLAY">TV Display</option>}
                  {(isDeskForm || (formModal.mode === 'create' && canCreateTv)) && <option value="REGISTRAR">Registration Desk</option>}
                </select>
              </div>
            </div>
            {isTvForm ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.5rem 0 1.4rem' }}>
                Sign in with this account on the office TV: it opens that office's TV display (with the check-in code)
                automatically. It cannot open any staff page or act on clients.
              </p>
            ) : isDeskForm ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.5rem 0 1.4rem' }}>
                This account only registers walk-in clients for its office and prints their slip. It cannot open any
                other page or act on clients. The password must be changed at first login.
              </p>
            ) : (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.5rem 0 1.4rem' }}>
                Administrators of the regional office manage accounts, services and reports for all offices.
                {formModal.mode === 'create' && ' New accounts must change their password at first login.'}
              </p>
            )}

            {isSinglePurpose ? (
              <>
                <h3 style={sectionHeading}>{isTvForm ? 'TV display' : 'Registration desk'}</h3>
                <div style={fieldGrid}>
                  <div>
                    <label htmlFor="acc-office">{isTvForm ? 'Office whose TV this is *' : 'Office it registers clients for *'}</label>
                    <select id="acc-office" required value={form.office} onChange={(e) => setField('office', e.target.value)}>
                      <option value="">Choose office…</option>
                      {offices.map(o => (
                        <option key={o.id} value={o.id}>{o.name}{o.office_type === 'REGIONAL' ? ' (Regional)' : ''}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            ) : (
            <>
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
            </>
            )}

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
