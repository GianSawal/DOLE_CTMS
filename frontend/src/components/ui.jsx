import { CircleCheck, CircleAlert, Info, X } from 'lucide-react';

/** Standard page heading: title, one-line description, and optional actions on the right. */
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

const NOTICE_ICONS = { success: CircleCheck, error: CircleAlert, info: Info };

/** Inline status banner. `notice` is { type: 'success' | 'error' | 'info', text } or null. */
export function Notice({ notice, onDismiss }) {
  if (!notice) return null;
  const Icon = NOTICE_ICONS[notice.type] || Info;
  return (
    <div role={notice.type === 'error' ? 'alert' : 'status'} className={`ui-notice ui-notice-${notice.type || 'info'}`}>
      <div className="ui-notice-body">
        <Icon aria-hidden="true" />
        <span>{notice.text}</span>
      </div>
      {onDismiss && (
        <button className="ui-notice-dismiss" onClick={onDismiss} aria-label="Dismiss">
          <X size={16} />
        </button>
      )}
    </div>
  );
}

const NOTE_MAX = 255;

/** Multi-line "Add note" box used when reassigning a client or moving them to pending. */
export function NoteField({ id, value, onChange, placeholder, label = 'Add note' }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <label htmlFor={id}>{label} <span style={{ fontWeight: 400, color: 'var(--ui-muted)' }}>(optional)</span></label>
        <span style={{ fontSize: '0.75rem', color: 'var(--ui-muted)' }}>{value.length}/{NOTE_MAX}</span>
      </div>
      <textarea
        id={id}
        rows={3}
        maxLength={NOTE_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ resize: 'vertical', minHeight: '84px', lineHeight: 1.45 }}
      />
    </div>
  );
}

/** Shows what the client typed for a catch-all "Other..." service. */
export function ConcernNote({ text }) {
  if (!text) return null;
  return (
    <div style={{
      marginTop: '0.45rem',
      padding: '0.45rem 0.65rem',
      borderRadius: '8px',
      background: '#eff6ff',
      border: '1px solid #bfdbfe',
      fontSize: '0.82rem',
      color: 'var(--ui-text-2)',
      lineHeight: 1.4,
    }}>
      <strong style={{ fontWeight: 600 }}>Concern:</strong> {text}
    </div>
  );
}

/** Shows the latest reassignment or pending note on a client. */
export function LatestNote({ note }) {
  if (!note?.text) return null;
  const label = note.kind === 'reassign' ? 'Reassign note' : 'Pending note';
  return (
    <div style={{
      marginTop: '0.45rem',
      padding: '0.45rem 0.65rem',
      borderRadius: '8px',
      background: note.kind === 'reassign' ? '#fffaeb' : '#f2f4f7',
      border: `1px solid ${note.kind === 'reassign' ? '#fedf89' : '#e4e7ec'}`,
      fontSize: '0.82rem',
      color: 'var(--ui-text-2)',
      lineHeight: 1.4,
    }}>
      <strong style={{ fontWeight: 600 }}>{label}{note.by ? ` from ${note.by}` : ''}:</strong> {note.text}
    </div>
  );
}
