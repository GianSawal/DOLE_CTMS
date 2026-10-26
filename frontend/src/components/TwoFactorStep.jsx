import { useState, useEffect } from 'react';
import { ShieldCheck, KeyRound } from 'lucide-react';
import { staffApi } from '../api/staff';
import { Notice } from './ui';

/** The account's one-time backup codes, shown once: print or copy them before continuing. */
export function BackupCodes({ codes, onDone, doneLabel = 'I saved my backup codes — continue' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch { /* clipboard blocked: they can still print or write them down */ }
  };
  return (
    <div>
      <p style={{ marginTop: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        If you lose your phone, each of these codes signs you in once instead of the 6-digit code.
        Keep them somewhere safe, not on the same phone. They are shown only now.
      </p>
      <ol className="mono print-backup-codes" style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.4rem 1.25rem', padding: '0.9rem 1.1rem 0.9rem 2.2rem',
        margin: '0 0 1rem', background: '#f8fafc', border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)',
        fontSize: '1rem', fontWeight: 700, letterSpacing: '0.05em',
      }}>
        {codes.map(c => <li key={c}>{c}</li>)}
      </ol>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => window.print()}>Print</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <button type="button" className="btn btn-primary btn-lg w-full" onClick={onDone}>{doneLabel}</button>
    </div>
  );
}

/**
 * Sign-in step after a correct password: set up the authenticator app (first time), then
 * enter its 6-digit code, or a backup code. Calls onSignedIn(data) with the issued sign-in.
 */
export default function TwoFactorStep({ challenge, setupRequired, onSignedIn, onCancel }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(null);  // signed in, but backup codes / a note to show first

  useEffect(() => {
    if (!setupRequired) return;
    staffApi.twoFactorSetup(challenge)
      .then(setSetup)
      .catch(err => {
        if (err.status === 401) setExpired(true);
        setError(err.message || 'Could not start the setup.');
      });
  }, [challenge, setupRequired]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      setBusy(true);
      setError('');
      const data = await staffApi.twoFactorVerify(challenge, code.trim());
      if (data.backup_codes || data.backup_codes_left !== undefined) setDone(data);
      else onSignedIn(data);
    } catch (err) {
      if (err.status === 401) setExpired(true);
      setError(err.message || 'That code is not correct.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (done?.backup_codes) {
    return (
      <div>
        <h1 className="page-title">Save your backup codes</h1>
        <BackupCodes codes={done.backup_codes} onDone={() => onSignedIn(done)} />
      </div>
    );
  }
  if (done) {
    return (
      <div>
        <h1 className="page-title">Signed in with a backup code</h1>
        <Notice notice={{
          type: done.backup_codes_left <= 3 ? 'error' : 'info',
          text: `You have ${done.backup_codes_left} backup code${done.backup_codes_left === 1 ? '' : 's'} left. `
            + 'Make new ones under Account security, or ask your administrator to reset your two-factor sign-in if you lost your phone.',
        }} />
        <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => onSignedIn(done)}>Continue</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <ShieldCheck size={36} aria-hidden="true" style={{ color: 'var(--dole-blue)', marginBottom: '0.5rem' }} />
        <h1 className="page-title">{setupRequired ? 'Set up two-factor sign-in' : 'Enter your code'}</h1>
        <p className="page-subtitle">
          {setupRequired
            ? 'Staff accounts need a code from an authenticator app at every sign-in.'
            : useBackup ? 'Type one of your backup codes.' : 'Open your authenticator app and type the 6-digit code for DOLE CTMS.'}
        </p>
      </div>

      <Notice notice={error ? { type: 'error', text: error } : null} />

      {expired ? (
        <button type="button" className="btn btn-primary btn-lg w-full" onClick={onCancel}>Sign in again</button>
      ) : (
        <>
          {setupRequired && (
            <ol style={{ paddingLeft: '1.2rem', margin: '0 0 1.25rem', lineHeight: 1.55, color: 'var(--text-secondary)' }}>
              <li>Install <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong> on your phone.</li>
              <li>In the app, add an account and scan this QR code.</li>
              <li>Type the 6-digit code the app shows.</li>
            </ol>
          )}
          {setupRequired && (setup ? (
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <img src={setup.qr_image} alt="QR code for your authenticator app" width="200" height="200"
                style={{ border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)', imageRendering: 'pixelated' }} />
              <details style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                <summary style={{ cursor: 'pointer' }}>Can't scan? Type this key instead</summary>
                <div className="mono" style={{ marginTop: '0.4rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                  {setup.secret}
                </div>
                <div>Account: your username · Type: time-based</div>
              </details>
            </div>
          ) : !error && (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Preparing your QR code…</p>
          ))}

          <form onSubmit={submit} style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <label htmlFor="two-factor-code">{useBackup ? 'Backup code' : '6-digit code'}</label>
              <input
                id="two-factor-code"
                type="text"
                required
                autoFocus
                autoComplete="one-time-code"
                inputMode={useBackup ? 'text' : 'numeric'}
                autoCapitalize={useBackup ? 'characters' : 'none'}
                maxLength={useBackup ? 9 : 7}
                placeholder={useBackup ? 'XXXX-XXXX' : '123 456'}
                value={code}
                onChange={(e) => setCode(useBackup ? e.target.value : e.target.value.replace(/[^\d ]/g, ''))}
                style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.3em', textAlign: 'center' }}
              />
            </div>
            <button type="submit" disabled={busy || (setupRequired && !setup)} className="btn btn-primary btn-lg w-full">
              {busy ? 'Checking…' : setupRequired ? 'Turn on and sign in' : 'Sign in'}
            </button>
          </form>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginTop: '1.25rem', fontSize: '0.82rem' }}>
            <button type="button" onClick={onCancel}
              style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, minHeight: 0 }}>
              ← Back
            </button>
            {!setupRequired && (
              <button type="button" onClick={() => { setUseBackup(v => !v); setCode(''); setError(''); }}
                style={{ border: 'none', background: 'none', color: 'var(--dole-blue)', cursor: 'pointer', padding: 0, minHeight: 0, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <KeyRound size={14} aria-hidden="true" /> {useBackup ? 'Use the app code' : 'Use a backup code'}
              </button>
            )}
          </div>
          {!setupRequired && (
            <p style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'var(--ui-muted)', textAlign: 'center' }}>
              Lost your phone and your backup codes? Ask your administrator to reset your two-factor sign-in.
            </p>
          )}
        </>
      )}
    </div>
  );
}
