import React, { useId } from 'react';

/**
 * RemoteFlow logo – the same drawing as the application icon (src-tauri/icons/icon.svg):
 * a terminal prompt with a "flow" wave on a cyan → blue tile.
 */
export const AppLogo: React.FC<{ className?: string; title?: string }> = ({ className = 'h-6 w-6', title }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="64 64 896 896" className={className} role="img" aria-label={title ?? 'RemoteFlow'}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#06b6d4" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="208" fill={`url(#${id}-bg)`} />
      <rect x="64" y="64" width="896" height="896" rx="208" fill={`url(#${id}-shine)`} />
      <polyline
        points="262,322 462,512 262,702"
        fill="none"
        stroke="#ffffff"
        strokeWidth="112"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 536 690 C 586 610, 646 610, 696 690 S 806 770, 856 690"
        fill="none"
        stroke="#ffffff"
        strokeWidth="96"
        strokeLinecap="round"
      />
    </svg>
  );
};
