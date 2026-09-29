import React from 'react';

export default function Modal({ isOpen, onClose, title, children, maxWidth = '520px' }) {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.45)',
      backdropFilter: 'blur(3px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '1.25rem 1rem',
      overflowY: 'auto',
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: 'var(--radius-lg)',
        width: '100%',
        maxWidth: maxWidth,
        boxShadow: 'var(--shadow-lg)',
        border: 'var(--border-hairline)',
        overflow: 'visible',
        position: 'relative',
        margin: 'auto',
      }}>
        <div style={{
          padding: '1rem 1.5rem',
          borderBottom: 'var(--border-hairline)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
          backgroundColor: '#ffffff',
        }}>
          <h2 style={{ fontSize: '1.15rem', margin: 0, color: 'var(--text-primary)' }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="btn btn-outline btn-sm"
            style={{ minHeight: '32px', padding: '0.2rem 0.5rem', fontSize: '1.1rem' }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: '1.5rem', overflow: 'visible' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
