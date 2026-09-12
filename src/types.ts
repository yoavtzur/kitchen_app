export type Unit = 'kg' | 'g' | 'l' | 'ml' | 'unit';

/** 0=Sunday .. 6=Saturday, matching Date#getDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Per-weekday overrides for a dailyUsage figure — a key present means "use this instead
 * of the base value on that weekday"; an absent key falls back to the base. */
export type WeekdayUsage = Partial<Record<Weekday, number>>;

export type Ingredient = {
  id: string;
  name: string;
  unit: Unit;
  currentQty: number;
  dailyUsage: number;
  weeklyUsage: number;
  /** Minimum stock to keep on hand ("par level"); the order sheet tops up to at least this. */
  parLevel?: number;
  /** Per-weekday overrides of dailyUsage (e.g. Friday needs more tomatoes than Monday). */
  dailyUsageByWeekday?: WeekdayUsage;
  supplier?: string;
  /** Kitchen grouping like "ירקות"/"מוצרי חלב" — distinct from RecipeCategory/Station, which are
   * prep stations for recipes and tasks, not a way to group ingredients themselves. */
  category?: string;
  note?: string;
};

export type ProductKind = 'menu' | 'component';

export type Product = {
  id: string;
  name: string;
  kind: ProductKind;
  unit: Unit;
  currentQty: number;
  weeklyTarget: number;
  dailyUsage: number;
  /** Per-weekday overrides of dailyUsage (e.g. Friday needs more dough than Monday). */
  dailyUsageByWeekday?: WeekdayUsage;
  recipeId?: string;
  coverageDaysOverride?: number;
};

/** A station's id (see `Station`), or the built-in `'general'` ("כללי") fallback for
 * anything with no station assigned. Free-form rather than a closed union — stations are a
 * per-kitchen list a chef creates, not a fixed preset. */
export type RecipeCategory = string;

/** A prep station a chef created for their kitchen (e.g. "פס חם"). Not scoped by a kitchen/
 * restaurant id: `AppState` itself is already one kitchen's worth of data — see the Supabase
 * restaurant/snapshot split — so a station never needs to say which kitchen it belongs to. */
export type Station = {
  id: string;
  name: string;
  createdAt: string;
};

export type RecipeItemRefType = 'ingredient' | 'product';

export type RecipeItem = {
  refType: RecipeItemRefType;
  refId: string;
  qty: number;
  unit: Unit;
};

export type Recipe = {
  id: string;
  name: string;
  category: RecipeCategory;
  yieldQty: number;
  yieldUnit: Unit;
  producesProductId?: string;
  items: RecipeItem[];
  steps: string[];
};

export type Priority = 'red' | 'yellow' | 'green';

export type TaskCompletion = {
  ingredientDeltas: { id: string; delta: number }[];
  producedProductId?: string;
  producedQty?: number;
};

export type Task = {
  id: string;
  date: string; // YYYY-MM-DD
  recipeId?: string; // absent for a free-text task not tied to a recipe (e.g. "clean shelves")
  title?: string; // display title when recipeId is absent
  /** Station for a free-text task (recipeId absent) — a recipe-backed task's station always
   * comes from its recipe's own category instead. */
  categoryOverride?: RecipeCategory;
  multiplier: number;
  priority: Priority;
  priorityManual?: boolean;
  assigneeId?: string;
  done: boolean;
  source: 'manual';
  note?: string;
  appliedCompletion?: TaskCompletion;
};

export type AutoTaskOverride = {
  id: string; // `auto-${productId}-${date}`
  productId: string;
  date: string; // YYYY-MM-DD
  dismissed?: boolean;
  done?: boolean;
  priority?: Priority;
  priorityManual?: boolean;
  assigneeId?: string;
  appliedCompletion?: TaskCompletion;
};

export type SpecialEventExtra = {
  productId: string;
  extraQty: number;
};

export type SpecialEvent = {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  extras: SpecialEventExtra[];
};

export type DayPlanEntry = {
  productId: string;
  requiredQty?: number;
  prepOverride?: number;
};

export type DayPlan = {
  date: string; // YYYY-MM-DD
  entries: DayPlanEntry[];
};

/** Per-account, server-authoritative membership attributes — deliberately kept out of AppState:
 * they describe who may do what, not restaurant data, and aren't part of the synced blob. */
export type MemberRole = 'chef' | 'cook';

export type MemberPermissions = {
  canEditRecipes: boolean;
  canDeleteRecipes: boolean;
};

export type Cook = {
  id: string;
  name: string;
  color: string;
};

/** One row of the dated supply order sheet, keyed by (ingredientId, date) — see
 * `orderLineKey` in lib/date.ts. There's no synthetic id: ops carry reducer actions (not rows),
 * and ops.op_id is already its own UUID, so a stored id here would only be a value that could
 * drift from its own key components. */
export type OrderLine = {
  ingredientId: string;
  date: string; // YYYY-MM-DD
  /** Manual quantity typed by the user; when absent the suggested quantity is used. */
  qtyOverride?: number;
  ordered: boolean;
};

export type RoundTo = 0.25 | 0.5 | 1 | null;

export type Settings = {
  defaultCoverageDays: number;
  weekStartsOn: 0 | 1; // 0 = Sunday
  roundMultiplierTo: RoundTo;
};

export type AppState = {
  schemaVersion: number;
  ingredients: Ingredient[];
  products: Product[];
  recipes: Recipe[];
  tasks: Task[];
  taskOverrides: AutoTaskOverride[];
  specialEvents: SpecialEvent[];
  dayPlans: DayPlan[];
  orderLines: OrderLine[];
  cooks: Cook[];
  stations: Station[];
  settings: Settings;
};
