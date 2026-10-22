import type { JSX } from 'react'

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

export function SaveIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="M12 3v11" />
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

/** Four-way arrow: drag an annotation to another place. */
export function MoveIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="M12 3v18" />
      <path d="M3 12h18" />
      <path d="m9 6 3-3 3 3" />
      <path d="m9 18 3 3 3-3" />
      <path d="m6 9-3 3 3 3" />
      <path d="m18 9 3 3-3 3" />
    </svg>
  )
}

export function CopyIcon(): JSX.Element {
  return (
    <svg {...base}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a3 3 0 0 0-3 3v6.5A2.5 2.5 0 0 0 5.5 15" />
    </svg>
  )
}

export function RepeatIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="M3 11a8 8 0 0 1 13.7-5.6L21 9" />
      <path d="M21 4v5h-5" />
      <path d="M21 13a8 8 0 0 1-13.7 5.6L3 15" />
      <path d="M3 20v-5h5" />
    </svg>
  )
}

export function CloseIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

export function SettingsIcon(): JSX.Element {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10 3.04V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </svg>
  )
}

export function CheckIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  )
}

export function ArrowIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="M5 19 19 5" />
      <path d="M11 5h8v8" />
    </svg>
  )
}

export function RectIcon(): JSX.Element {
  return (
    <svg {...base}>
      <rect x="4" y="5.5" width="16" height="13" rx="2.5" />
    </svg>
  )
}

/** A plain diagonal segment: the line tool, which has no arrow head. */
export function LineIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="M5 19 19 5" />
    </svg>
  )
}

export function PenIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 0l.5.5a2.1 2.1 0 0 1 0 3L8.5 19 4 20Z" />
    </svg>
  )
}

export function TextIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="M5 6.5V5h14v1.5" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </svg>
  )
}

export function BlurIcon(): JSX.Element {
  return (
    <svg {...base}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" strokeDasharray="2.6 2.6" />
      <circle cx="9" cy="10" r="1.4" />
      <circle cx="14.5" cy="13.5" r="1.4" />
    </svg>
  )
}

export function StepIcon(): JSX.Element {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10.4 9.6 12.2 8.4v7.2" strokeWidth="1.6" />
    </svg>
  )
}

export function UndoIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="M4 9h10a5 5 0 0 1 0 10H9" />
      <path d="m8 5-4 4 4 4" />
    </svg>
  )
}

/** Magnifier with a minus: zoom out. */
export function ZoomOutIcon(): JSX.Element {
  return (
    <svg {...base}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
      <path d="M8.5 11h5" />
    </svg>
  )
}

/** Magnifier with a plus: zoom in. */
export function ZoomInIcon(): JSX.Element {
  return (
    <svg {...base}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
      <path d="M8.5 11h5" />
      <path d="M11 8.5v5" />
    </svg>
  )
}

/** Arrows pointing into the corners: fit the whole picture on screen. */
export function FitIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="M9 4H4v5" />
      <path d="M15 4h5v5" />
      <path d="M15 20h5v-5" />
      <path d="M9 20H4v-5" />
    </svg>
  )
}

export function TextScanIcon(): JSX.Element {
  return (
    <svg {...base}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M8 9h8" />
      <path d="M8 12.5h8" />
      <path d="M8 16h4.5" />
    </svg>
  )
}
