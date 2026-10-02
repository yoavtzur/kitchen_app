import type { ReactNode } from 'react';

// One inline-SVG icon set, shared by the bottom nav and the menu rows so they cannot drift apart.
// All stroke icons on a 24px grid and `currentColor`, which is what lets an active nav tab and a
// danger row recolour them with CSS alone.

type IconProps = { size?: number };

function Svg({ size = 20, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function OrdersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h2l1.6 9.2a2 2 0 0 0 2 1.7h7.2a2 2 0 0 0 2-1.6L20 9H7" />
      <circle cx="10" cy="20" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="17" cy="20" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function TasksIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.3 12.3l2.4 2.4 5-5" />
    </Svg>
  );
}

export function CountIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 9h16l-1.5 9.2a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4 9z" />
      <path d="M8.5 9 10 4M15.5 9 14 4" />
    </Svg>
  );
}

export function RecipesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5.2a2 2 0 0 1 2-2h6v17.6H6a2 2 0 0 1-2-2V5.2z" />
      <path d="M20 5.2a2 2 0 0 0-2-2h-6v17.6h6a2 2 0 0 0 2-2V5.2z" />
    </Svg>
  );
}

export function ConsumptionIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </Svg>
  );
}

export function MenuIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function StationsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="4" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="4" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="14" width="7" height="6" rx="1.5" />
      <rect x="13.5" y="14" width="7" height="6" rx="1.5" />
    </Svg>
  );
}

export function TeamIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.5-3.2 3-5 6-5s5.5 1.8 6 5" />
      <path d="M16 5.6a3 3 0 0 1 0 5.8M18 14.8c1.8.6 2.8 2.2 3 4.2" />
    </Svg>
  );
}

export function SettingsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </Svg>
  );
}

export function ProfileIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5" />
    </Svg>
  );
}

export function LegalIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
      <path d="M14 3.5V8h4M9 13h6M9 16.5h6" />
    </Svg>
  );
}

export function LogoutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
      <path d="M15 8l4 4-4 4M19 12H9" />
    </Svg>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.2" />
      <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
    </Svg>
  );
}

export function TrashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

export function PencilIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M14.5 7.5l3 3" />
    </Svg>
  );
}

/** Points toward the *end* edge of the row. The path is drawn pointing left, which is the end
 * edge in RTL; `.menu-row .chevron` mirrors it for an LTR document. */
export function ChevronIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.5 6l-6 6 6 6" />
    </Svg>
  );
}

export function EyeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function EyeOffIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.3A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3.5 3.5l17 17" />
    </Svg>
  );
}

export function PhoneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 4h3.5l1.7 4.3-2.1 1.4a11 11 0 0 0 5.2 5.2l1.4-2.1L19 14.5V18a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </Svg>
  );
}

export function ChatIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5.5h16v10H10.5L6 19.5v-4H4z" />
    </Svg>
  );
}

export function AlertIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4.2 2.8 19.5h18.4L12 4.2z" />
      <path d="M12 10v4.4" />
      <circle cx="12" cy="17.1" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function ShortageIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 9h16l-1.5 9.2a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4 9z" />
      <path d="M9.5 14.5h5" />
    </Svg>
  );
}

export function WasteIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h5.2a1.6 1.6 0 0 0 1.6-1.5L17 7" />
      <path d="M10 11l4 5M14 11l-4 5" />
    </Svg>
  );
}

export function ReceivingIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9z" />
      <path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" />
    </Svg>
  );
}

export function RepeatIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 11V9a3 3 0 0 1 3-3h11M15 3l3 3-3 3" />
      <path d="M20 13v2a3 3 0 0 1-3 3H6M9 21l-3-3 3-3" />
    </Svg>
  );
}

/** The iOS share glyph (a box with an arrow leaving it) — drawn so the steps can point at the exact
 * button a person has to find. */
export function ShareIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 15V3M8 7l4-4 4 4" />
      <path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </Svg>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </Svg>
  );
}

export function MoreIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="5.5" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="18.5" r="1.3" fill="currentColor" />
    </Svg>
  );
}
