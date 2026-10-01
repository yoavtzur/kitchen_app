import type { SyncInfo } from '../sync/store';

/**
 * What the sync chrome should show, as a pure function of the sync info.
 *
 * Two shapes, because two different jobs:
 *
 * - **A dot** for states that need no action. A cook counting stock inside a walk-in has no
 *   signal and nothing to do about it; the data is queued on the device and leaves on its own.
 *   Grey means "not connected, nothing waiting", amber means "something is waiting to be sent".
 *   Never red: red is for a person's attention.
 * - **A pill with words** for the states that do need attention or an explanation — a dot alone
 *   cannot say "refresh the app".
 *
 * Healthy (`live`, nothing pending) renders nothing at all.
 */
export type SyncIndicator =
  | { kind: 'none' }
  | { kind: 'dot'; tone: 'gray' | 'amber'; label: string }
  | { kind: 'pill'; tone: 'red' | 'yellow'; label: string };

export function syncIndicator(info: Pick<SyncInfo, 'status' | 'pendingCount' | 'stalePendingMinutes'>): SyncIndicator {
  const { status, pendingCount, stalePendingMinutes } = info;

  if (status === 'upgrade-required') {
    // First: the most actionable explanation for a stuck queue there is, so it is never masked
    // by the generic stuck-sending warning below.
    return { kind: 'pill', tone: 'red', label: 'יש לרענן את האפליקציה' };
  }
  if (status === 'read-only') {
    // Deliberately not "refresh the app": writes are off because an operator switched them off
    // (or this build is below min_client_version). Refreshing changes nothing, and saying so
    // would train a cook to ignore the one message that means it.
    return {
      kind: 'pill',
      tone: 'yellow',
      label: pendingCount > 0 ? `במצב קריאה בלבד (${pendingCount} ממתינים)` : 'במצב קריאה בלבד',
    };
  }
  if (stalePendingMinutes !== undefined) {
    // 10+ minutes unsent is worth escalating even while `status` still looks like a routine
    // retry loop (e.g. a captive portal that answers every request, so we are "online" but
    // never getting through).
    return { kind: 'pill', tone: 'red', label: `שליחה תקועה (${stalePendingMinutes} דק')` };
  }
  if (status === 'error') return { kind: 'pill', tone: 'red', label: 'שגיאת סנכרון' };

  if (status === 'offline') {
    return pendingCount > 0
      ? { kind: 'dot', tone: 'amber', label: `לא מקוון · ${pendingCount} שינויים נשמרו במכשיר` }
      : { kind: 'dot', tone: 'gray', label: 'לא מקוון' };
  }
  if (pendingCount > 0) return { kind: 'dot', tone: 'amber', label: `שולח ${pendingCount} שינויים...` };
  if (status === 'live') return { kind: 'none' };
  return { kind: 'dot', tone: 'gray', label: 'מתחבר...' };
}

/** The confirmation after a save. Without a connection the honest answer is "saved here, not
 * sent yet" — and saying so is what stops a cook in a walk-in from wondering whether the count
 * was lost. */
export function savedMessage(info: Pick<SyncInfo, 'status' | 'online'>, remote: boolean): string {
  if (remote && (info.status === 'offline' || !info.online)) return 'נשמר במכשיר, יסונכרן כשתחזור קליטה';
  return 'נשמר ✓';
}
