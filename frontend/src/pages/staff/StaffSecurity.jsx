import { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { staffApi } from '../../api/staff';
import { PageHeader, Notice } from '../../components/ui';
import { BackupCodes } from '../../components/TwoFactorStep';

/** The signed-in staff member's two-factor sign-in: status and new backup codes. */
export default function StaffSecurity() {
  const [status, setStatus] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [codes, setCodes] = useState(null);

  const load = () => staffApi.getTwoFactor().then(setStatus).catch(err => setNotice({ type: 'error', text: err.message }));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      setBusy(true);
      setNotice(null);
      const res = await staffApi.newBackupCodes(code.trim());
      setCodes(res.backup_codes);
      setCode('');
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'That code is not correct.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-ground)' }}>
      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '640px', margin: '0 auto', width: '100%' }}>
        <PageHeader title="Account security" subtitle="Two-factor sign-in with Google Authenticator or Microsoft Authenticator." />
        <Notice notice={notice} onDismiss={() => setNotice(null)} />

        <section className="card" style={{ padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <ShieldCheck size={28} aria-hidden="true" style={{ color: status?.enabled ? 'var(--dole-green)' : 'var(--text-muted)' }} />
            <div>
              <div style={{ fontWeight: 800 }}>{status ? (status.enabled ? 'Two-factor sign-in is on' : 'Two-factor sign-in is not set up') : 'Loading…'}</div>
              {status?.enabled && (
                <div style={{ fontSize: '0.85rem', color: status.backup_codes_left <= 3 ? 'var(--dole-red-dark)' : 'var(--text-secondary)' }}>
                  {status.backup_codes_left} unused backup code{status.backup_codes_left === 1 ? '' : 's'} left
                </div>
              )}
            </div>
          </div>

          {codes ? (
            <BackupCodes codes={codes} doneLabel="Done" onDone={() => { setCodes(null); load(); }} />
          ) : status?.enabled ? (
            <form onSubmit={submit} style={{ display: 'grid', gap: '0.75rem' }}>
              <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5, fontSize: '0.92rem' }}>
                New backup codes replace your old ones, which stop working. Enter the current code from your
                authenticator app to confirm.
              </p>
              <div>
                <label htmlFor="security-code">6-digit code</label>
                <input id="security-code" type="text" required inputMode="numeric" autoComplete="one-time-code" maxLength={7}
                  value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
                  style={{ maxWidth: '200px', fontSize: '1.3rem', fontWeight: 800, letterSpacing: '0.3em', textAlign: 'center' }} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy} style={{ justifySelf: 'start' }}>
                {busy ? 'Checking…' : 'Make new backup codes'}
              </button>
            </form>
          ) : status && (
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>You will set it up at your next sign-in.</p>
          )}
          <p style={{ margin: '1.25rem 0 0', fontSize: '0.8rem', color: 'var(--ui-muted)' }}>
            New phone or lost it? Ask your administrator to reset your two-factor sign-in; you set it up again at your next sign-in.
          </p>
        </section>
      </main>
    </div>
  );
}
