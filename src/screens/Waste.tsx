import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/Segmented';
import { EmptyState } from '../components/EmptyState';
import { formatDayMonth, todayStr } from '../lib/date';
import { formatQty } from '../lib/units';
import {
  periodRange,
  shiftPeriod,
  sortedWasteLog,
  summarizeWaste,
  type WastePeriod,
} from '../lib/waste';

type View = 'log' | 'summary';

const VIEWS: { value: View; label: string }[] = [
  { value: 'log', label: 'יומן' },
  { value: 'summary', label: 'סיכום' },
];

const PERIODS: { value: WastePeriod; label: string }[] = [
  { value: 'week', label: 'שבוע' },
  { value: 'month', label: 'חודש' },
];

const REASON_LABEL = { expired: 'פג תוקף', spoiled: 'התקלקל' } as const;

const HE_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function periodLabel(period: WastePeriod, from: string, to: string): string {
  if (period === 'week') return `${formatDayMonth(from)} – ${formatDayMonth(to)}`;
  const [y, m] = from.split('-').map(Number);
  return `${HE_MONTHS[m - 1]} ${y}`;
}

/**
 * What has been thrown away, for the chef. Chef-only by route (`ChefRoute`), like the other
 * management screens. Two views of one append-only log: the log itself (newest first, with who
 * threw it), and a per-item total over a week or a month — which is the view that answers "what
 * am I over-ordering?".
 */
export function Waste() {
  const { state } = useApp();
  const [view, setView] = useState<View>('log');
  const [period, setPeriod] = useState<WastePeriod>('week');
  const [anchor, setAnchor] = useState(todayStr);

  const log = useMemo(() => sortedWasteLog(state), [state]);
  const range = periodRange(period, anchor, state.settings.weekStartsOn);
  const summary = useMemo(() => summarizeWaste(log, range), [log, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const cookName = (id?: string) => (id ? (state.cooks.find((c) => c.id === id)?.name ?? '—') : '—');

  return (
    <div>
      <ScreenHeader title="יומן זריקות" />
      <Segmented options={VIEWS} value={view} onChange={setView} label="תצוגת יומן זריקות" />

      {view === 'log' ? (
        log.length === 0 ? (
          <EmptyState text="עדיין לא נזרק כלום. זריקות שנרשמות מהאפליקציה יופיעו כאן." />
        ) : (
          <div className="list-card">
            {log.map((e) => (
              <div key={e.id} className="row-item">
                <div>
                  <div style={{ fontWeight: 600 }}>{e.itemName}</div>
                  <div className="muted">
                    {formatDayMonth(e.date)} · {timeOf(e.at)} · {cookName(e.cookId)} · {REASON_LABEL[e.reason]}
                  </div>
                </div>
                <span>{formatQty(e.qty, e.unit)}</span>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <Segmented
            options={PERIODS}
            value={period}
            onChange={(next) => {
              setPeriod(next);
              setAnchor(todayStr());
            }}
            label="תקופה"
          />
          <div className="row" style={{ justifyContent: 'space-between', margin: 'var(--space-3) 0' }}>
            <button type="button" className="btn btn-sm" aria-label="התקופה הקודמת" onClick={() => setAnchor(shiftPeriod(period, anchor, -1))}>
              ›
            </button>
            <strong>{periodLabel(period, range.from, range.to)}</strong>
            <button type="button" className="btn btn-sm" aria-label="התקופה הבאה" onClick={() => setAnchor(shiftPeriod(period, anchor, 1))}>
              ‹
            </button>
          </div>
          {summary.length === 0 ? (
            <EmptyState text="לא נזרק כלום בתקופה הזו." />
          ) : (
            <div className="card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>פריט</th>
                    <th>סה״כ נזרק</th>
                    <th>פעמים</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr key={`${row.itemType}:${row.itemId}`}>
                      <td>{row.name}</td>
                      <td>{formatQty(row.totalQty, row.unit)}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
