import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { BottomSheet } from './BottomSheet';
import { Segmented } from './Segmented';
import { PrinterIcon } from './icons';
import { stationOptions } from '../lib/recipeCategories';
import {
  ALL,
  buildOrderDoc,
  buildStockDoc,
  buildTaskDoc,
  docToText,
  orderSuppliers,
  stationLabel,
  stockGroups,
  type PrintDoc,
  type StockPrintOptions,
} from '../lib/printDoc';
import { useTimedFlag } from '../lib/useTimedFlag';
import type { AppState } from '../types';

export type PrintKind = 'tasks' | 'stock' | 'orders';

/**
 * The printed page itself. Rendered into `document.body` (outside the app's root) only while a
 * print is under way; `body.printing-doc` hides everything else on paper, so what prints is this
 * document and nothing of the screen it was started from.
 */
export function PrintDocument({ doc }: { doc: PrintDoc }) {
  return createPortal(
    <div className="print-doc-root" dir="rtl" lang="he">
      <header className="print-doc-header">
        <h1>{doc.title}</h1>
        <p>{doc.subtitle}</p>
      </header>
      {doc.sections.length === 0 && <p>אין פריטים.</p>}
      {doc.sections.map((s, i) => (
        <section key={`${s.heading}-${i}`} className={`print-doc-section${doc.pageBreaks && i > 0 ? ' page-break' : ''}`}>
          <h2>{s.heading}</h2>
          {s.note && <p className="print-doc-note">{s.note}</p>}
          <table>
            <thead>
              <tr>
                {doc.checkboxes && <th className="print-doc-check" aria-label="בוצע" />}
                {s.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, j) => (
                <tr key={j}>
                  {doc.checkboxes && (
                    <td className="print-doc-check">
                      <span className="print-doc-box" />
                    </td>
                  )}
                  {r.map((c, k) => (
                    <td key={k} className={s.columns[k] === 'ספירה' ? 'print-doc-blank' : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>,
    document.body,
  );
}

/** Prints `doc` once: mounts the page, opens the browser's print dialog, cleans up after. */
function usePrinter() {
  const [doc, setDoc] = useState<PrintDoc | null>(null);
  useEffect(() => {
    if (!doc) return;
    document.body.classList.add('printing-doc');
    const done = () => {
      document.body.classList.remove('printing-doc');
      setDoc(null);
    };
    window.addEventListener('afterprint', done, { once: true });
    // One frame so the portal is in the DOM before the dialog snapshots the page.
    const raf = requestAnimationFrame(() => {
      try {
        window.print();
      } catch (err) {
        console.error('print failed', err);
        done();
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('printing-doc');
    };
  }, [doc]);
  return { printing: doc, print: setDoc };
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="print-opt-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function TaskOptions({ state, date, onDoc }: { state: AppState; date: string; onDoc: (d: PrintDoc) => void; }) {
  const { membership } = useAuth();
  const [stations, setStations] = useState<string[]>([]);
  const [cookId, setCookId] = useState(ALL);
  const [includeDone, setIncludeDone] = useState(false);
  const [pageBreaks, setPageBreaks] = useState(false);
  const doc = useMemo(
    () => buildTaskDoc(state, date, { stations, cookId, includeDone, pageBreaks }, membership?.restaurantName),
    [state, date, stations, cookId, includeDone, pageBreaks, membership?.restaurantName],
  );
  useEffect(() => onDoc(doc), [doc, onDoc]);
  const toggle = (id: string) => setStations((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <>
      <div className="field">
        <label>עמדות</label>
        <div className="print-chips" role="group" aria-label="עמדות">
          <button type="button" className={`tab${stations.length === 0 ? ' active' : ''}`} aria-pressed={stations.length === 0} onClick={() => setStations([])}>
            הכל
          </button>
          {stationOptions(state.stations).map((o) => (
            <button
              key={o.value}
              type="button"
              className={`tab${stations.includes(o.value) ? ' active' : ''}`}
              aria-pressed={stations.includes(o.value)}
              onClick={() => toggle(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="print-cook">טבח</label>
        <select id="print-cook" value={cookId} onChange={(e) => setCookId(e.target.value)}>
          <option value={ALL}>כל הטבחים</option>
          <option value="none">לא משויכות</option>
          {state.cooks.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <Check label="כולל משימות שבוצעו" checked={includeDone} onChange={setIncludeDone} />
      <Check label="כל עמדה בדף נפרד" checked={pageBreaks} onChange={setPageBreaks} />
    </>
  );
}

const STOCK_KINDS: { value: StockPrintOptions['kind']; label: string }[] = [
  { value: 'ingredients', label: 'מצרכים' },
  { value: 'products', label: 'מוצרים' },
];
const ING_GROUPS: { value: 'category' | 'supplier'; label: string }[] = [
  { value: 'category', label: 'לפי קטגוריה' },
  { value: 'supplier', label: 'לפי ספק' },
];

function StockOptions({ state, date, onDoc }: { state: AppState; date: string; onDoc: (d: PrintDoc) => void }) {
  const { membership } = useAuth();
  const [kind, setKind] = useState<StockPrintOptions['kind']>('ingredients');
  const [ingGroupBy, setIngGroupBy] = useState<'category' | 'supplier'>('category');
  const [group, setGroup] = useState(ALL);
  const [blankCount, setBlankCount] = useState(true);
  const [pageBreaks, setPageBreaks] = useState(false);
  const groupBy = kind === 'products' ? 'station' : ingGroupBy;
  const groups = useMemo(() => stockGroups(state, kind, groupBy), [state, kind, groupBy]);
  const activeGroup = groups.includes(group) ? group : ALL;
  const doc = useMemo(
    () => buildStockDoc(state, date, { kind, groupBy, group: activeGroup, blankCount, pageBreaks }, membership?.restaurantName),
    [state, date, kind, groupBy, activeGroup, blankCount, pageBreaks, membership?.restaurantName],
  );
  useEffect(() => onDoc(doc), [doc, onDoc]);
  return (
    <>
      <Segmented options={STOCK_KINDS} value={kind} onChange={setKind} label="מה להדפיס" />
      {kind === 'ingredients' && <Segmented options={ING_GROUPS} value={ingGroupBy} onChange={setIngGroupBy} label="קיבוץ" />}
      <div className="field">
        <label htmlFor="print-group">{kind === 'products' ? 'עמדה' : ingGroupBy === 'supplier' ? 'ספק' : 'קטגוריה'}</label>
        <select id="print-group" value={activeGroup} onChange={(e) => setGroup(e.target.value)}>
          <option value={ALL}>הכל</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {kind === 'products' ? stationLabel(state, g) : g}
            </option>
          ))}
        </select>
      </div>
      <Check label="עמודה ריקה לספירה ביד" checked={blankCount} onChange={setBlankCount} />
      <Check label="כל קבוצה בדף נפרד" checked={pageBreaks} onChange={setPageBreaks} />
    </>
  );
}

function OrderOptions({
  state,
  date,
  onDoc,
  supplierNote,
}: {
  state: AppState;
  date: string;
  onDoc: (d: PrintDoc) => void;
  supplierNote?: (supplier: string) => string | undefined;
}) {
  const { membership } = useAuth();
  const [supplier, setSupplier] = useState(ALL);
  const [pageBreaks, setPageBreaks] = useState(false);
  const suppliers = useMemo(() => orderSuppliers(state, date), [state, date]);
  const active = suppliers.includes(supplier) ? supplier : ALL;
  const doc = useMemo(
    () => buildOrderDoc(state, date, { supplier: active, pageBreaks }, membership?.restaurantName, supplierNote),
    [state, date, active, pageBreaks, membership?.restaurantName, supplierNote],
  );
  useEffect(() => onDoc(doc), [doc, onDoc]);
  return (
    <>
      <div className="field">
        <label htmlFor="print-supplier">ספק</label>
        <select id="print-supplier" value={active} onChange={(e) => setSupplier(e.target.value)}>
          <option value={ALL}>כל הספקים</option>
          {suppliers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <Check label="כל ספק בדף נפרד" checked={pageBreaks} onChange={setPageBreaks} />
    </>
  );
}

const TITLES: Record<PrintKind, string> = {
  tasks: 'הדפסה ושיתוף — משימות',
  stock: 'הדפסה ושיתוף — מלאי',
  orders: 'הדפסה ושיתוף — הזמנה',
};

function PrintSheet({
  kind,
  date,
  onClose,
  supplierNote,
}: {
  kind: PrintKind;
  date: string;
  onClose: () => void;
  supplierNote?: (supplier: string) => string | undefined;
}) {
  const { state } = useApp();
  const [doc, setDoc] = useState<PrintDoc | null>(null);
  const { printing, print } = usePrinter();
  const [copied, flagCopied] = useTimedFlag(1800);
  const rows = doc?.sections.reduce((n, s) => n + s.rows.length, 0) ?? 0;
  const text = doc ? docToText(doc) : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      flagCopied();
    } catch {
      // clipboard unavailable: WhatsApp is the other way out
    }
  }

  return (
    <BottomSheet title={TITLES[kind]} onClose={onClose}>
      <div className="stack-gap-3">
        {kind === 'tasks' && <TaskOptions state={state} date={date} onDoc={setDoc} />}
        {kind === 'stock' && <StockOptions state={state} date={date} onDoc={setDoc} />}
        {kind === 'orders' && <OrderOptions state={state} date={date} onDoc={setDoc} supplierNote={supplierNote} />}
        <p className="muted" aria-live="polite">
          {rows === 0 ? 'אין מה להדפיס בבחירה הזו.' : `${rows} שורות ב-${doc?.sections.length ?? 0} קבוצות`}
        </p>
        <button type="button" className="btn btn-primary btn-block" disabled={!doc || rows === 0} onClick={() => doc && print(doc)}>
          <PrinterIcon size={20} />
          הדפסה
        </button>
        <div className="row" style={{ gap: 8 }}>
          <a
            className={`btn${rows === 0 ? ' disabled' : ''}`}
            style={{ flex: 1 }}
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={rows === 0}
            onClick={(e) => rows === 0 && e.preventDefault()}
          >
            וואטסאפ
          </a>
          <button type="button" className="btn" style={{ flex: 1 }} disabled={rows === 0} onClick={copy}>
            {copied ? 'הועתק ✓' : 'העתק כטקסט'}
          </button>
        </div>
      </div>
      {printing && <PrintDocument doc={printing} />}
    </BottomSheet>
  );
}

/** The printer icon in a screen's header; opens the print-and-share sheet for that screen. */
export function PrintButton({
  kind,
  date,
  supplierNote,
}: {
  kind: PrintKind;
  date: string;
  supplierNote?: (supplier: string) => string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="icon-btn no-print" onClick={() => setOpen(true)} aria-label="הדפסה ושיתוף" title="הדפסה ושיתוף" aria-haspopup="dialog">
        <PrinterIcon size={20} />
      </button>
      {open && <PrintSheet kind={kind} date={date} onClose={() => setOpen(false)} supplierNote={supplierNote} />}
    </>
  );
}
