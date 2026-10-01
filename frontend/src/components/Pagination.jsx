import React from 'react';

/**
 * Reusable Pagination component.
 *
 * Props:
 *  - currentPage: number (1-indexed)
 *  - totalPages: number
 *  - onPageChange: (page: number) => void
 *  - totalItems: number (optional, for "Showing X–Y of Z" text)
 *  - pageSize: number (optional, default 10)
 */
export default function Pagination({ currentPage, totalPages, onPageChange, totalItems, pageSize = 10 }) {
  if (totalPages <= 1) return null;

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems || currentPage * pageSize);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem 1.25rem',
      borderTop: '1px solid #e2e8f0',
      backgroundColor: '#ffffff',
      gap: '1rem',
      flexWrap: 'wrap',
    }}>
      <button
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.45rem 1rem',
          fontSize: '0.85rem',
          fontWeight: 600,
          borderRadius: '8px',
          border: '1px solid #cbd5e1',
          backgroundColor: currentPage <= 1 ? '#f8fafc' : '#ffffff',
          color: currentPage <= 1 ? '#94a3b8' : '#334155',
          cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
          minHeight: '36px',
        }}
      >
        ← Previous
      </button>

      <span style={{
        fontSize: '0.85rem',
        fontWeight: 600,
        color: '#334155',
        userSelect: 'none',
      }}>
        Page {currentPage} of {totalPages}
      </span>

      <button
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.45rem 1rem',
          fontSize: '0.85rem',
          fontWeight: 600,
          borderRadius: '8px',
          border: '1px solid #cbd5e1',
          backgroundColor: currentPage >= totalPages ? '#f8fafc' : '#ffffff',
          color: currentPage >= totalPages ? '#94a3b8' : '#334155',
          cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
          minHeight: '36px',
        }}
      >
        Next →
      </button>
    </div>
  );
}

/**
 * Helper hook-like function to paginate an array.
 * Usage: const paginatedItems = paginateArray(filteredItems, currentPage, pageSize);
 */
export function paginateArray(items, currentPage, pageSize = 10) {
  const startIndex = (currentPage - 1) * pageSize;
  return items.slice(startIndex, startIndex + pageSize);
}
