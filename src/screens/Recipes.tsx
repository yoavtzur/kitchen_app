import { useRef, useState } from 'react';
import { createWorker } from 'tesseract.js';
import { useApp } from '../store/AppContext';
import { CategoryTabs } from '../components/CategoryTabs';
import { BottomSheet } from '../components/BottomSheet';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';
import { matchesQuery } from '../lib/search';
import { RecipeEditor } from './RecipeEditor';
import { multiplierForProduct, toPrepare } from '../lib/calc';
import { todayStr } from '../lib/date';
import { formatQty, unitLabel } from '../lib/units';
import type { Recipe, RecipeCategory } from '../types';

const CATEGORIES: { value: RecipeCategory; label: string }[] = [
  { value: 'cold', label: 'פס קר' },
  { value: 'hot', label: 'פס חם' },
  { value: 'taboon', label: 'טאבון' },
  { value: 'dessert', label: 'קינוחים' },
  { value: 'general', label: 'כללי' },
];

type CategoryFilter = RecipeCategory | 'all';

// "הכל" leads the row so browsing everything at once is the default, not a tab you have to
// find — the individual stations stay right beside it for narrowing down.
const TABS: { value: CategoryFilter; label: string }[] = [{ value: 'all', label: 'הכל' }, ...CATEGORIES];

function RecipeRow({ recipe }: { recipe: Recipe }) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  // The product this recipe makes — shown inline so the recipe↔stock link is visible here too.
  const product = state.products.find((p) => p.id === recipe.producesProductId);
  const today = todayStr();
  const prep = product ? toPrepare(product, today, state) : 0;
  const { multiplier, unitMismatch } = product
    ? multiplierForProduct(product, recipe, prep, state.settings.roundMultiplierTo)
    : { multiplier: 0, unitMismatch: false };

  function itemName(refType: 'ingredient' | 'product', refId: string): string {
    if (refType === 'ingredient') return state.ingredients.find((i) => i.id === refId)?.name ?? refId;
    return state.products.find((p) => p.id === refId)?.name ?? refId;
  }

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', background: 'none', border: 'none', padding: 0, textAlign: 'start' }}
      >
        <div className="row">
          <span style={{ fontWeight: 700 }}>{recipe.name}</span>
          <span className="muted">{formatQty(recipe.yieldQty, recipe.yieldUnit)} לבאטץ&apos;</span>
        </div>
        {product && (
          <div className="row" style={{ marginTop: 'var(--space-2)' }}>
            <span className="muted">
              במלאי: {formatQty(product.currentQty, product.unit)}
            </span>
            {unitMismatch ? (
              <span className="pill red">יחידה לא תואמת</span>
            ) : multiplier > 0 ? (
              <span className="pill yellow">להכין היום ×{multiplier}</span>
            ) : (
              <span className="pill green">אין צורך היום</span>
            )}
          </div>
        )}
        {!product && (
          <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
            לא מנוהל במלאי — לא מופיע במסך הראשי
          </p>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <table className="data-table" style={{ marginBottom: 'var(--space-3)' }}>
            <thead>
              <tr>
                <th>רכיב</th>
                <th>כמות</th>
              </tr>
            </thead>
            <tbody>
              {recipe.items.length === 0 ? (
                <tr>
                  <td colSpan={2} className="muted">
                    אין רכיבים במתכון.
                  </td>
                </tr>
              ) : (
                recipe.items.map((item, i) => (
                  <tr key={i}>
                    <td>{itemName(item.refType, item.refId)}</td>
                    <td>{formatQty(item.qty, item.unit)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {product && (
            <p className="muted" style={{ marginBottom: 'var(--space-2)' }}>
              צריכה יומית: {product.dailyUsage} {unitLabel(product.unit)} · יעד שבועי:{' '}
              {product.weeklyTarget} {unitLabel(product.unit)}
            </p>
          )}
          <p className="muted" style={{ marginBottom: 'var(--space-2)' }}>אופן הכנה</p>
          <ol className="step-list">
            {recipe.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <button type="button" className="btn" style={{ marginTop: 'var(--space-3)' }} onClick={() => setEditing(true)}>
            ערוך פריט
          </button>
        </div>
      )}

      {editing && (
        <RecipeEditor recipe={recipe} defaultCategory={recipe.category} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

type ScanStatus = 'idle' | 'loading-model' | 'recognizing' | 'done' | 'error';

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8.5A2 2 0 0 1 6 6.5h1.5l1-2h7l1 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </svg>
  );
}

/**
 * First step toward "photograph a recipe" — OCR only, entirely client-side (tesseract.js,
 * no server, no cost). It just reads the text out of the photo; it does not yet try to turn
 * that text into a structured recipe (name/category/ingredients/steps) — that needs an AI
 * parsing step behind a small server function, deliberately left for later so we can first
 * see how well plain OCR reads real printed recipes.
 */
function RecipeScanSheet({ onClose }: { onClose: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);

  function pickFile(file: File) {
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
    setText('');
    setStatus('idle');
  }

  async function scan() {
    if (!imageFile) return;
    setStatus('loading-model');
    setProgress(0);
    try {
      const worker = await createWorker('heb+eng', undefined, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setStatus('recognizing');
            setProgress(Math.round(m.progress * 100));
          }
        },
      });
      const { data } = await worker.recognize(imageFile);
      await worker.terminate();
      setText(data.text.trim());
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  function copyText() {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  const busy = status === 'loading-model' || status === 'recognizing';

  return (
    <BottomSheet title="סריקת מתכון (ניסיוני)" onClose={onClose}>
      <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
        צלמו או בחרו תמונה של מתכון מודפס. השלב הזה קורא את הטקסט מתוך התמונה בלבד —
        עדיין לא יוצר מתכון אוטומטית. אפשר להעתיק את הטקסט ולהדביק אותו בעורך המתכון.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pickFile(file);
          e.target.value = '';
        }}
      />

      <button
        type="button"
        className="btn"
        style={{ width: '100%', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
      >
        <CameraIcon />
        {imageFile ? 'בחרו תמונה אחרת' : 'צלמו או בחרו תמונה'}
      </button>

      {imageUrl && (
        <img
          src={imageUrl}
          alt="תצוגה מקדימה של המתכון"
          style={{ width: '100%', borderRadius: 'var(--radius-m)', marginBottom: 'var(--space-3)', display: 'block' }}
        />
      )}

      {imageFile && !busy && status !== 'done' && (
        <button type="button" className="btn btn-primary" style={{ width: '100%', marginBottom: 'var(--space-3)' }} onClick={scan}>
          סרוק טקסט
        </button>
      )}

      {busy && (
        <div className="card" style={{ marginBottom: 'var(--space-3)', textAlign: 'center' }}>
          <p className="muted">
            {status === 'loading-model' ? 'טוען מנוע זיהוי טקסט…' : `סורק… ${progress}%`}
          </p>
        </div>
      )}

      {status === 'error' && (
        <p style={{ color: 'var(--color-red)', marginBottom: 'var(--space-3)' }}>
          הסריקה נכשלה. נסו תמונה ברורה וחדה יותר.
        </p>
      )}

      {status === 'done' && (
        <div className="field">
          <label>טקסט שזוהה (אפשר לערוך)</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ minHeight: 220 }}
            dir="rtl"
          />
          <button type="button" className="btn" style={{ marginTop: 'var(--space-2)' }} onClick={copyText}>
            {copied ? 'הועתק ✓' : 'העתק טקסט'}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

export function Recipes() {
  const { state } = useApp();
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);

  const searching = query.trim().length > 0;

  // One shape covers all three views: searching and a single station both render as one
  // unlabeled group; "הכל" is the only case that splits into a labeled section per station,
  // so everything is visible without hopping between tabs, and a station is still called out.
  const groups: { label?: string; recipes: Recipe[] }[] = searching
    ? [{ recipes: state.recipes.filter((r) => matchesQuery(query, r.name)) }]
    : category === 'all'
      ? CATEGORIES.map((c) => ({
          label: c.label,
          recipes: state.recipes.filter((r) => r.category === c.value),
        })).filter((g) => g.recipes.length > 0)
      : [{ recipes: state.recipes.filter((r) => r.category === category) }];

  const isEmpty = groups.every((g) => g.recipes.length === 0);
  const emptyText = searching
    ? 'לא נמצאו מתכונים.'
    : category === 'all'
      ? 'אין עדיין מתכונים. הוסף מתכון ראשון.'
      : 'אין מתכונים בקטגוריה הזו עדיין.';

  // Adding a recipe while "הכל" is selected still needs one real station to start from.
  const addDefaultCategory: RecipeCategory = category === 'all' ? 'cold' : category;

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">מתכונים</h1>
        <div className="row" style={{ gap: 8, width: 'auto' }}>
          <button type="button" className="btn btn-icon" onClick={() => setScanning(true)} aria-label="סרוק מתכון">
            <CameraIcon />
          </button>
          <button type="button" className="btn btn-icon btn-primary" onClick={() => setAdding(true)} aria-label="הוסף פריט">
            +
          </button>
        </div>
      </div>

      <SearchInput value={query} onChange={setQuery} placeholder="חיפוש מתכון..." />

      {!searching && <CategoryTabs tabs={TABS} value={category} onChange={setCategory} />}

      {isEmpty ? (
        <EmptyState text={emptyText} />
      ) : (
        groups.map((g, i) => (
          <div key={g.label ?? i}>
            {g.label && <h2 className="section-title">{g.label}</h2>}
            <div className="card-list">
              {g.recipes.map((r) => (
                <RecipeRow key={r.id} recipe={r} />
              ))}
            </div>
          </div>
        ))
      )}

      {adding && <RecipeEditor recipe={null} defaultCategory={addDefaultCategory} onClose={() => setAdding(false)} />}
      {scanning && <RecipeScanSheet onClose={() => setScanning(false)} />}
    </div>
  );
}
