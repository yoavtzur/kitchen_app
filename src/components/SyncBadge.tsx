import { useEffect, useState } from 'react';
import { useSync } from '../store/AppContext';
import { isSupabaseConfigured } from '../lib/supabase';

/** A small indicator of sync state, so a cook on a bad kitchen wifi knows whether their last
 * change actually reached the team. Renders nothing in local mode — there's no restaurant to
 * sync with, so any sync chrome there would just be confusing noise. It's also silent while
 * everything is healthy: a permanently-on "מסונכרן" pill is noise, not signal, so it only
 * appears (debounced by 1s, to avoid flashing during routine reconnects) once there's something
 * a cook would actually want to know about. */
export function SyncBadge() {
  const { status, pendingCount, stalePendingMinutes } = useSync();
  const quiet = status === 'live' && pendingCount === 0 && stalePendingMinutes === undefined;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (quiet) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 1000);
    return () => clearTimeout(t);
  }, [quiet]);

  if (!isSupabaseConfigured || !visible) return null;

  let label: string;
  let tone: 'red' | 'yellow' | 'green';
  if (status === 'upgrade-required') {
    // Checked first: it's the most actionable explanation for a stuck queue there is, so it
    // should never be masked by the more generic "stuck sending" warning below.
    label = 'יש לרענן את האפליקציה';
    tone = 'red';
  } else if (stalePendingMinutes !== undefined) {
    // A queue stuck for 10+ minutes is worth flagging even while `status` still looks like a
    // routine retry loop (e.g. a captive portal that answers every request, so we're technically
    // "online" but never actually getting through).
    label = `שליחה תקועה (${stalePendingMinutes} דק')`;
    tone = 'red';
  } else if (status === 'offline') {
    label = pendingCount > 0 ? `לא מקוון (${pendingCount})` : 'לא מקוון';
    tone = 'yellow';
  } else if (status === 'error') {
    label = 'שגיאת סנכרון';
    tone = 'red';
  } else if (pendingCount > 0) {
    label = `שולח... (${pendingCount})`;
    tone = 'yellow';
  } else if (status === 'live') {
    label = 'מסונכרן';
    tone = 'green';
  } else {
    label = 'מתחבר...';
    tone = 'yellow';
  }

  return <div className={`pill ${tone} sync-badge`}>{label}</div>;
}
