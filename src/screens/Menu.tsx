import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { isSupabaseConfigured } from '../lib/supabase';
import { initialsOf } from '../lib/initials';
import {
  ChevronIcon,
  LegalIcon,
  LogoutIcon,
  ReceivingIcon,
  RepeatIcon,
  RecipesIcon,
  SettingsIcon,
  StationsIcon,
  TeamIcon,
} from '../components/icons';

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
 *
 * Tapping the profile card opens "הפרופיל שלי" (name, phone, e-mail, password). The team screen
 * is for both roles: a chef manages people there, a cook finds how to reach the chef.
 */
export function Menu() {
  const { state } = useApp();
  const { membership, signOut } = useAuth();
  const { isChef } = usePermissions();

  const cook = membership?.cookId ? state.cooks.find((c) => c.id === membership.cookId) : undefined;
  const restaurantName = membership?.restaurantName?.trim() || 'ניהול מטבח';
  const displayName = cook?.name ?? (isChef ? 'שף' : 'טבח');

  const profile = (
    <>
      <span className="avatar" style={cook ? { background: cook.color } : undefined} aria-hidden="true">
        {initialsOf(displayName)}
      </span>
      <div style={{ flex: 1 }}>
        <div className="profile-name">{displayName}</div>
        <div className="profile-sub">{restaurantName}</div>
      </div>
    </>
  );

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">תפריט</h1>
      </div>

      {/* A link only when there is an account to show: local mode has no e-mail, phone or password. */}
      {isSupabaseConfigured ? (
        <Link to="/profile" className="profile-card profile-card-link" aria-label="הפרופיל שלי">
          {profile}
          <span className="chevron">
            <ChevronIcon />
          </span>
        </Link>
      ) : (
        <div className="profile-card">{profile}</div>
      )}

      <div className="list-card">
        {isChef && <MenuLink to="/recipes" icon={<RecipesIcon size={22} />} label="מתכונים" />}
        {isChef && <MenuLink to="/recurring" icon={<RepeatIcon size={22} />} label="משימות קבועות" />}
        {isChef && <MenuLink to="/receiving" icon={<ReceivingIcon size={22} />} label="קבלת סחורה" />}
        {isChef && <MenuLink to="/stations" icon={<StationsIcon size={22} />} label="ניהול פסים" />}
        <MenuLink to="/team" icon={<TeamIcon size={22} />} label={!isSupabaseConfigured ? 'צוות' : isChef ? 'צוות והזמנות' : 'צוות ויצירת קשר'} />
        <MenuLink
          to="/settings"
          icon={<SettingsIcon size={22} />}
          label={isChef ? 'הגדרות' : 'הגדרות וחשבון'}
        />
        <MenuLink to="/legal/privacy" icon={<LegalIcon size={22} />} label="פרטיות ותנאים" />
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
