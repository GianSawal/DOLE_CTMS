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
