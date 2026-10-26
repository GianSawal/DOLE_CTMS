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

/** Multi-line "Remarks" box used when reassigning, moving to pending, completing, or referring a client. */
export function NoteField({ id, value, onChange, placeholder, label = 'Remarks', required = false }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <label htmlFor={id}>{label} {!required && <span style={{ fontWeight: 400, color: 'var(--ui-muted)' }}>(optional)</span>}</label>
        <span style={{ fontSize: '0.75rem', color: 'var(--ui-muted)' }}>{value.length}/{NOTE_MAX}</span>
      </div>
      <textarea
        id={id}
        rows={3}
        maxLength={NOTE_MAX}
        required={required}
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

/** On a ticket another office referred here: where the client came from and their concern. */
export function ReferralNote({ tx }) {
  if (!tx?.referred_from) return null;
  const { office_name: office, by } = tx.referred_from;
  return (
    <div style={{
      marginTop: '0.45rem',
      padding: '0.45rem 0.65rem',
      borderRadius: '8px',
      background: '#f5f3ff',
      border: '1px solid #ddd6fe',
      fontSize: '0.82rem',
      color: 'var(--ui-text-2)',
      lineHeight: 1.4,
    }}>
      <strong style={{ fontWeight: 600 }}>Referred from {office}{by ? ` by ${by}` : ''}:</strong> {tx.referral_note}
    </div>
  );
}

const NOTE_STYLES = {
  reassign: { label: 'Reassign remarks', background: '#fffaeb', border: '#fedf89' },
  pending: { label: 'Pending remarks', background: '#f2f4f7', border: '#e4e7ec' },
  done: { label: 'Done remarks', background: '#ecfdf3', border: '#abefc6' },
};

/** Shows the latest remarks written when the client was reassigned, put on pending, or completed. */
export function LatestNote({ note }) {
  if (!note?.text) return null;
  const style = NOTE_STYLES[note.kind] || NOTE_STYLES.pending;
  const label = style.label;
  return (
    <div style={{
      marginTop: '0.45rem',
      padding: '0.45rem 0.65rem',
      borderRadius: '8px',
      background: style.background,
      border: `1px solid ${style.border}`,
      fontSize: '0.82rem',
      color: 'var(--ui-text-2)',
      lineHeight: 1.4,
    }}>
      <strong style={{ fontWeight: 600 }}>{label}{note.by ? ` from ${note.by}` : ''}:</strong> {note.text}
    </div>
  );
}
