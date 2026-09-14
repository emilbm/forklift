import { useEffect, useRef, type ReactNode } from 'react';

/* ------------------------------------------------------------------ icons */

type IconProps = { size?: number };

const svgProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconHome = ({ size = 22 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </svg>
);

export const IconDumbbell = ({ size = 22 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M2 12h2M20 12h2M6 7v10M18 7v10M9 9v6M15 9v6M9 12h6" />
  </svg>
);

export const IconList = ({ size = 22 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </svg>
);

export const IconClipboard = ({ size = 22 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M9 3h6v3H9z" />
    <path d="M15 4.5h2.5A1.5 1.5 0 0 1 19 6v13.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5V6a1.5 1.5 0 0 1 1.5-1.5H9" />
    <path d="M9 11h6M9 15h4" />
  </svg>
);

export const IconHistory = ({ size = 22 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3.5 2" />
  </svg>
);

export const IconChevron = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const IconPlus = ({ size = 20 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconTrash = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </svg>
);

export const IconUp = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="m6 14 6-6 6 6" />
  </svg>
);

export const IconDown = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="m6 10 6 6 6-6" />
  </svg>
);

export const IconClose = ({ size = 20 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconCheck = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="m5 13 4 4 10-10" />
  </svg>
);

export const IconEdit = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M4 20h4l10-10-4-4L4 16v4Z" />
    <path d="m14 6 4 4" />
  </svg>
);

/* ------------------------------------------------------------------ sheet */

interface SheetProps {
  title?: string;
  onClose: () => void;
  children: ReactNode;
}

/** A bottom sheet — reachable with a thumb, unlike a centred dialog. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" ref={panel} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__grip" />
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ small pieces */

export function Spinner() {
  return <div className="spinner" aria-label="Loading" />;
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="banner banner--error" role="alert">
      {message}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  hint: string;
  action?: ReactNode;
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{hint}</p>
      {action}
    </div>
  );
}
