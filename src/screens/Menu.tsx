import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  ChevronIcon,
  LegalIcon,
  LogoutIcon,
  RecipesIcon,
  SettingsIcon,
  StationsIcon,
} from '../components/icons';

/** Initials for the avatar: the first letter of up to two words. Hebrew has no case, so no
 * transformation is needed — and a blank name must not render an empty circle. */
function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]);
  return letters.join('') || '•';
}

function MenuLink({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className="menu-row">
      <span className="menu-row-icon">{icon}</span>
      <span className="menu-row-label">{label}</span>
      <span className="chevron">
        <ChevronIcon />
      </span>
    </Link>
  );
}

/**
 * Replaces "עוד". Role decides what is listed: a chef gets the kitchen's management screens, a
 * cook only what concerns their own account — but both reach settings, because sign-out and
 * account deletion (migration 0007) are not a chef-only right.
 */
export function Menu() {
  const { state } = useApp();
  const { membership, signOut } = useAuth();
  const { isChef } = usePermissions();

  const cook = membership?.cookId ? state.cooks.find((c) => c.id === membership.cookId) : undefined;
  const restaurantName = membership?.restaurantName?.trim() || 'ניהול מטבח';
  const displayName = cook?.name ?? (isChef ? 'שף' : 'טבח');

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">תפריט</h1>
      </div>

      <div className="profile-card">
        <span className="avatar" style={cook ? { background: cook.color } : undefined} aria-hidden="true">
          {initialsOf(displayName)}
        </span>
        <div>
          <div className="profile-name">{displayName}</div>
          <div className="profile-sub">{restaurantName}</div>
        </div>
      </div>

      <div className="list-card">
        {isChef && <MenuLink to="/recipes" icon={<RecipesIcon size={22} />} label="מתכונים" />}
        {isChef && <MenuLink to="/stations" icon={<StationsIcon size={22} />} label="ניהול פסים" />}
        <MenuLink
          to="/settings"
          icon={<SettingsIcon size={22} />}
          label={isChef ? 'צוות והגדרות' : 'הגדרות וחשבון'}
        />
        {!isChef && <MenuLink to="/legal/privacy" icon={<LegalIcon size={22} />} label="פרטיות ותנאים" />}
      </div>

      {isSupabaseConfigured && (
        <div className="list-card">
          <button type="button" className="menu-row danger" onClick={() => signOut()}>
            <span className="menu-row-icon">
              <LogoutIcon size={22} />
            </span>
            <span className="menu-row-label">התנתקות</span>
          </button>
        </div>
      )}
    </div>
  );
}
