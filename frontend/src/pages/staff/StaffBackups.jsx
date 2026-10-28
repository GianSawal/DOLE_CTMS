import { useState, useEffect } from 'react';
import { DatabaseBackup, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { staffApi } from '../../api/staff';
import { PageHeader, Notice } from '../../components/ui';

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}

/** System administrator: make an encrypted backup and download it. */
export default function StaffBackups() {
  const [info, setInfo] = useState(null);
  const [contents, setContents] = useState('database');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = () => staffApi.getBackupInfo().then(setInfo).catch(err => setNotice({ type: 'error', text: err.message }));
  useEffect(() => { load(); }, []);

  const min = info?.min_passphrase || 12;
  const ready = passphrase.length >= min && passphrase === confirm && !busy;

  const submit = async (e) => {
    e.preventDefault();
    try {
      setBusy(true);
      setNotice(null);
      const name = await staffApi.downloadBackup(contents, passphrase, confirm);
      setNotice({ type: 'success', text: `Backup saved to your downloads as ${name}. Keep the passphrase somewhere safe: without it the backup can't be opened.` });
      setPassphrase('');
      setConfirm('');
      load();
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const option = (value, title, detail) => (
    <label key={value} style={{
      display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.85rem 1rem', margin: 0, cursor: 'pointer',
      border: `2px solid ${contents === value ? 'var(--dole-blue)' : 'var(--border-color)'}`, borderRadius: 'var(--radius-md)',
      background: contents === value ? 'var(--dole-blue-light)' : '#fff',
    }}>
      <input type="radio" name="backup-contents" value={value} checked={contents === value} onChange={() => setContents(value)}
        style={{ width: '18px', height: '18px', minHeight: 0, marginTop: '0.15rem' }} />
      <span>
        <span style={{ display: 'block', fontWeight: 700 }}>{title}</span>
        <span style={{ display: 'block', fontSize: '0.84rem', color: 'var(--text-secondary)', fontWeight: 400 }}>{detail}</span>
      </span>
    </label>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-ground)' }}>
      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '760px', margin: '0 auto', width: '100%' }}>
        <PageHeader title="Backups" subtitle="Make an encrypted copy of the system's data and download it. Nothing is kept on the server." />
        <Notice notice={notice} onDismiss={() => setNotice(null)} />

        {info?.last_backup && (
          <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            Last backup: {formatDateTime(info.last_backup.timestamp)} by {info.last_backup.actor_username}
            {info.last_backup.details?.contents ? ` (${info.last_backup.details.contents === 'everything' ? 'everything' : 'database only'})` : ''}
          </p>
        )}

        <form onSubmit={submit} className="card" style={{ padding: '1.25rem 1.5rem', display: 'grid', gap: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '0 0 0.6rem' }}>
              What to back up
            </h2>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {option('database', 'Database only',
                `Every table${info ? ` (${info.tables})` : ''}: transactions, accounts, settings, audit log, and the CSM tables in the shared database.`)}
              {option('everything', 'Everything',
                `The database plus uploaded files${info ? ` (${info.media_files} file${info.media_files === 1 ? '' : 's'}, about ${formatBytes(info.media_bytes)})` : ''}, such as the offices' TV videos.`)}
            </div>
          </div>

          <div>
            <h2 style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <LockKeyhole size={14} aria-hidden="true" /> Encryption passphrase
            </h2>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              The backup is encrypted with AES-256 using this passphrase. It is not saved anywhere: write it down and keep it
              apart from the backup file. <strong>Without it, the backup can never be opened.</strong>
            </p>
            <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
              <div>
                <label htmlFor="backup-passphrase">Passphrase</label>
                <div style={{ position: 'relative' }}>
                  <input id="backup-passphrase" type={show ? 'text' : 'password'} autoComplete="new-password" required
                    value={passphrase} onChange={(e) => setPassphrase(e.target.value)} style={{ paddingRight: '2.75rem' }} />
                  <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide passphrase' : 'Show passphrase'}
                    style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', minHeight: '32px', width: '32px', padding: 0, background: 'transparent', color: 'var(--ui-muted)' }}>
                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="backup-confirm">Type it again</label>
                <input id="backup-confirm" type={show ? 'text' : 'password'} autoComplete="new-password" required
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            </div>
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: passphrase && passphrase.length < min ? 'var(--dole-red-dark)' : 'var(--ui-muted)' }}>
              At least {min} characters. A few unrelated words make a strong, memorable passphrase.
              {confirm && passphrase !== confirm ? ' The two entries don\'t match yet.' : ''}
            </p>
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={!ready} style={{ justifySelf: 'start', gap: '0.5rem' }}>
            <DatabaseBackup size={18} aria-hidden="true" /> {busy ? 'Making the backup…' : 'Make backup and download'}
          </button>
          {busy && contents === 'everything' && (
            <p style={{ margin: '-0.75rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Backups with videos can take a minute or more.</p>
          )}
        </form>

        <section className="card" style={{ padding: '1.1rem 1.5rem', marginTop: '1rem', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Opening a backup</strong>
          <p style={{ margin: '0.35rem 0 0' }}>
            On the server: <code>python manage.py decrypt_backup &lt;file&gt;</code>. On any computer with Python:
            {' '}<code>pip install cryptography</code>, then <code>python backend/tools/decrypt_backup.py &lt;file&gt;</code>.
            Both ask for the passphrase and write a zip with the data (one file per table) and, for "Everything", the uploaded files.
            A wrong passphrase, or a changed or incomplete file, is refused.
          </p>
        </section>
      </main>
    </div>
  );
}
