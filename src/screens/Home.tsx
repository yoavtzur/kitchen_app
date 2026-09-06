import { Link } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { daysOfSupply, priorityFor } from '../lib/calc';
import { getDisplayTasks, type DisplayTask } from '../lib/tasks';
import { dayName, todayStr } from '../lib/date';
import { NumberEditor } from '../components/NumberEditor';
import { PriorityDot } from '../components/PriorityDot';
import { EmptyState } from '../components/EmptyState';
import { unitLabel } from '../lib/units';
import type { AppState, Priority, Product } from '../types';

const PRIORITY_ORDER: Record<Priority, number> = { red: 0, yellow: 1, green: 2 };

function formatToday(date: string): string {
  const [, m, d] = date.split('-');
  return `יום ${dayName(date)}, ${Number(d)}/${Number(m)}`;
}

function StatCard({
  to,
  value,
  label,
  tone,
}: {
  to: string;
  value: number;
  label: string;
  tone: Priority | 'neutral';
}) {
  return (
    <Link to={to} className={`stat-card ${tone === 'neutral' ? '' : tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </Link>
  );
}

/** One row of "what to cook today", driven by the live auto-task list. */
function PrepRow({ task, state, today }: { task: DisplayTask; state: AppState; today: string }) {
  const { dispatch } = useApp();
  const recipe = state.recipes.find((r) => r.id === task.recipeId);
  const product = state.products.find((p) => p.id === task.productId);
  const title = recipe?.name ?? task.title ?? 'משימה';

  return (
    <div className={`card priority-card ${task.priority}`}>
      <div className="row">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <PriorityDot priority={task.priority} />
          <Link
            to="/tasks"
            style={{
              fontWeight: 600,
              color: 'inherit',
              textDecoration: 'none',
              textDecorationLine: task.done ? 'line-through' : 'none',
              opacity: task.done ? 0.5 : 1,
            }}
          >
            {title}
            {recipe && !task.unitMismatch && ` — מתכון ×${task.multiplier}`}
          </Link>
        </div>
        {product && (
          <NumberEditor
            value={product.currentQty}
            label={`כמות נוכחית — ${product.name}`}
            suffix={unitLabel(product.unit)}
            onChange={(qty) => dispatch({ type: 'SET_PRODUCT_QTY', id: product.id, qty, today })}
          />
        )}
      </div>
      {task.unitMismatch && (
        <p className="pill red" style={{ marginTop: 'var(--space-2)' }}>
          יחידת המלאי לא תואמת ליחידת המתכון — צריך לתקן בעריכת הפריט
        </p>
      )}
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const { state, dispatch } = useApp();
  const today = todayStr();
  const priority = priorityFor(product, today, state);
  const recipe = state.recipes.find((r) => r.id === product.recipeId);
  // A prep item usually shares its name with its recipe, so repeating it adds nothing —
  // show the daily target instead, and call out an item with no recipe behind it.
  const subtitle = !recipe
    ? 'ללא מתכון'
    : recipe.name !== product.name
      ? recipe.name
      : `יומי: ${product.dailyUsage} ${unitLabel(product.unit)}`;
  return (
    <div className={`card priority-card ${priority}`}>
      <div className="row">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{product.name}</div>
          <div className="muted">{subtitle}</div>
        </div>
        <NumberEditor
          value={product.currentQty}
          label={`כמות נוכחית — ${product.name}`}
          suffix={unitLabel(product.unit)}
          onChange={(qty) => dispatch({ type: 'SET_PRODUCT_QTY', id: product.id, qty, today })}
        />
      </div>
    </div>
  );
}

export function Home() {
  const { state } = useApp();
  const today = todayStr();

  // Always read tasks through getDisplayTasks: auto tasks are computed live and are not in
  // state.tasks, so counting state.tasks alone would miss almost everything.
  const todayTasks = getDisplayTasks(today, state);
  const openTasks = todayTasks.filter((t) => !t.done);
  const urgentCount = openTasks.filter((t) => t.priority === 'red').length;

  const prepList = [...openTasks].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );

  const lowIngredients = state.ingredients
    .map((ing) => ({ ing, days: daysOfSupply(ing, today) }))
    .filter(({ days }) => days < 2)
    .sort((a, b) => a.days - b.days);

  const menuProducts = state.products.filter((p) => p.kind === 'menu');
  const componentProducts = state.products.filter((p) => p.kind === 'component');

  return (
    <div>
      <div className="home-hero">
        <span className="home-blob home-blob-a" aria-hidden="true" />
        <span className="home-blob home-blob-b" aria-hidden="true" />
        <div className="screen-header">
          <div>
            <h1 className="screen-title">ניהול מטבח</h1>
            <p className="muted">{formatToday(today)} &middot; המטבח מחכה לך</p>
          </div>
          <div className="home-mascot" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z" />
              <path d="M4 10a8 8 0 0 1 16 0" />
              <circle cx="12" cy="5" r="1.6" fill="#FFFFFF" stroke="none" />
            </svg>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard to="/tasks" value={urgentCount} label="דחוף היום" tone="red" />
        <StatCard to="/tasks" value={openTasks.length} label="משימות פתוחות" tone="neutral" />
        <StatCard
          to="/orders"
          value={lowIngredients.filter(({ days }) => days < 1).length}
          label="מצרכים חסרים"
          tone="yellow"
        />
      </div>

      {state.products.length === 0 ? (
        <EmptyState text="אין עדיין פריטים. הוסף מתכון ראשון במסך מתכונים והוא יופיע כאן מיד." />
      ) : (
        <>
          <h2 className="section-title">להכין היום</h2>
          {prepList.length === 0 ? (
            <EmptyState text="הכל במלאי — אין מה להכין היום." />
          ) : (
            <div className="card-list">
              {prepList.map((t) => (
                <PrepRow key={t.id} task={t} state={state} today={today} />
              ))}
            </div>
          )}
        </>
      )}

      {lowIngredients.length > 0 && (
        <>
          <h2 className="section-title">מצרכים לחידוש</h2>
          <Link to="/orders" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card">
              {lowIngredients.map(({ ing, days }) => (
                <div key={ing.id} className="row-item">
                  <span>{ing.name}</span>
                  <span className={`pill ${days < 1 ? 'red' : 'yellow'}`}>
                    {days === Infinity ? '∞' : `${Math.round(days * 10) / 10} ימים`}
                  </span>
                </div>
              ))}
            </div>
          </Link>
        </>
      )}

      {menuProducts.length > 0 && (
        <>
          <h2 className="section-title">מנות בתפריט</h2>
          <div className="card-list">
            {menuProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </>
      )}

      {componentProducts.length > 0 && (
        <>
          <h2 className="section-title">מוצרים</h2>
          <div className="card-list">
            {componentProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </>
      )}

      <h2 className="section-title">ניווט מהיר</h2>
      <div className="nav-grid">
        <Link to="/ingredients" className="card">כמות מצרכים</Link>
        <Link to="/recipes" className="card">מתכונים</Link>
        <Link to="/tasks" className="card">משימות יומיות</Link>
        <Link to="/orders" className="card">הזמנת אספקה</Link>
        <Link to="/count" className="card">ספירת מלאי</Link>
        <Link to="/consumption" className="card">צריכה שבועית</Link>
        <Link to="/settings" className="card">הגדרות</Link>
      </div>
    </div>
  );
}
