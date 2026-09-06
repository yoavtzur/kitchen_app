import type { AppState } from '../types';

export const SCHEMA_VERSION = 3;

export function createSeedState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      defaultCoverageDays: 1,
      weekStartsOn: 0,
      roundMultiplierTo: 0.25,
    },
    cooks: [
      { id: 'cook-1', name: 'דני', color: '#4f9d69' },
      { id: 'cook-2', name: 'מאיה', color: '#c77b3b' },
    ],
    ingredients: [
      { id: 'ing-tomato', name: 'עגבניות', unit: 'kg', currentQty: 4, dailyUsage: 1.5, weeklyUsage: 10, parLevel: 12, supplier: 'ירקן השכונה' },
      { id: 'ing-egg', name: 'ביצים', unit: 'unit', currentQty: 60, dailyUsage: 20, weeklyUsage: 140, parLevel: 180, supplier: 'לול הגליל' },
      { id: 'ing-cream', name: 'שמנת מתוקה', unit: 'l', currentQty: 2, dailyUsage: 0.5, weeklyUsage: 3.5, supplier: 'מחלבות' },
      { id: 'ing-sugar', name: 'סוכר', unit: 'kg', currentQty: 5, dailyUsage: 0.4, weeklyUsage: 2.8 },
      { id: 'ing-flour', name: 'קמח', unit: 'kg', currentQty: 15, dailyUsage: 2, weeklyUsage: 14, parLevel: 20, supplier: 'טחנת הקמח' },
      { id: 'ing-yeast', name: 'שמרים', unit: 'g', currentQty: 200, dailyUsage: 30, weeklyUsage: 210 },
      { id: 'ing-oliveoil', name: 'שמן זית', unit: 'l', currentQty: 3, dailyUsage: 0.3, weeklyUsage: 2.1 },
      { id: 'ing-zucchini', name: 'קישואים', unit: 'kg', currentQty: 3, dailyUsage: 1, weeklyUsage: 7, supplier: 'ירקן השכונה' },
      { id: 'ing-breadcrumbs', name: 'פירורי לחם', unit: 'kg', currentQty: 2, dailyUsage: 0.5, weeklyUsage: 3.5 },
      { id: 'ing-mayo', name: 'מיונז', unit: 'l', currentQty: 1, dailyUsage: 0.2, weeklyUsage: 1.4 },
    ],
    products: [
      { id: 'prod-creme-brulee', name: 'קרם ברולה', kind: 'menu', unit: 'unit', currentQty: 3, weeklyTarget: 40, dailyUsage: 15, recipeId: 'recipe-creme-brulee' },
      { id: 'prod-pizza-dough', name: 'בצק לפיצות', kind: 'menu', unit: 'unit', currentQty: 12, weeklyTarget: 84, dailyUsage: 12, recipeId: 'recipe-pizza-dough' },
      { id: 'prod-arancini', name: 'ארנצ\'יני', kind: 'menu', unit: 'unit', currentQty: 40, weeklyTarget: 210, dailyUsage: 30, recipeId: 'recipe-arancini' },
      { id: 'prod-tomato-salsa', name: 'סלסת עגבניות', kind: 'component', unit: 'l', currentQty: 1, weeklyTarget: 7, dailyUsage: 1, recipeId: 'recipe-tomato-salsa' },
      { id: 'prod-egg-salad', name: 'סלט ביצים', kind: 'component', unit: 'l', currentQty: 0.5, weeklyTarget: 3.5, dailyUsage: 0.5, recipeId: 'recipe-egg-salad' },
      { id: 'prod-zucchini-cream', name: 'קרם זוקיני', kind: 'component', unit: 'l', currentQty: 0.5, weeklyTarget: 3.5, dailyUsage: 0.5, recipeId: 'recipe-zucchini-cream' },
    ],
    recipes: [
      {
        id: 'recipe-creme-brulee',
        name: 'קרם ברולה',
        category: 'dessert',
        yieldQty: 8,
        yieldUnit: 'unit',
        producesProductId: 'prod-creme-brulee',
        items: [
          { refType: 'ingredient', refId: 'ing-cream', qty: 1, unit: 'l' },
          { refType: 'ingredient', refId: 'ing-egg', qty: 6, unit: 'unit' },
          { refType: 'ingredient', refId: 'ing-sugar', qty: 0.2, unit: 'kg' },
        ],
        steps: [
          'לחמם שמנת עד נקודת רתיחה קלה.',
          'לטרוף חלמונים עם סוכר עד הבהרה.',
          'לשלב בהדרגה עם השמנת החמה תוך ערבוב מתמיד.',
          'למזוג לתבניות ולאפות באמבט מים ב-150 מעלות כ-35 דקות.',
          'לצנן, לפני הגשה לפזר סוכר ולקרמל בברנר.',
        ],
      },
      {
        id: 'recipe-pizza-dough',
        name: 'בצק לפיצות',
        category: 'taboon',
        yieldQty: 6,
        yieldUnit: 'unit',
        producesProductId: 'prod-pizza-dough',
        items: [
          { refType: 'ingredient', refId: 'ing-flour', qty: 1, unit: 'kg' },
          { refType: 'ingredient', refId: 'ing-yeast', qty: 15, unit: 'g' },
          { refType: 'ingredient', refId: 'ing-oliveoil', qty: 0.05, unit: 'l' },
        ],
        steps: [
          'לערבב קמח, שמרים ומים פושרים לבצק אחיד.',
          'ללוש כ-10 דקות עד קבלת בצק חלק.',
          'להוסיף שמן זית ולהמשיך ללוש דקה נוספת.',
          'לתפח בקערה מכוסה כשעה עד הכפלת הנפח.',
          'לחלק לכדורים, לתפח תפיחה שנייה של 20 דקות לפני שימוש.',
        ],
      },
      {
        id: 'recipe-arancini',
        name: "ארנצ'יני",
        category: 'hot',
        yieldQty: 20,
        yieldUnit: 'unit',
        producesProductId: 'prod-arancini',
        items: [
          { refType: 'ingredient', refId: 'ing-breadcrumbs', qty: 0.5, unit: 'kg' },
          { refType: 'ingredient', refId: 'ing-egg', qty: 3, unit: 'unit' },
        ],
        steps: [
          'לעצב את הריזוטו הקר לכדורים.',
          'לטבול בביצה טרופה ואז בפירורי לחם.',
          'לטגן בשמן עמוק עד הזהבה.',
          'להניח על נייר סופג ולהגיש חם.',
        ],
      },
      {
        id: 'recipe-tomato-salsa',
        name: 'סלסת עגבניות',
        category: 'cold',
        yieldQty: 1,
        yieldUnit: 'l',
        producesProductId: 'prod-tomato-salsa',
        items: [
          { refType: 'ingredient', refId: 'ing-tomato', qty: 1, unit: 'kg' },
          { refType: 'ingredient', refId: 'ing-oliveoil', qty: 0.05, unit: 'l' },
        ],
        steps: [
          'לחתוך עגבניות לקוביות קטנות.',
          'לתבל במלח, פלפל ושמן זית.',
          'לערבב ולהשאיר לתיבול של 10 דקות לפני הגשה.',
        ],
      },
      {
        id: 'recipe-egg-salad',
        name: 'סלט ביצים',
        category: 'cold',
        yieldQty: 1,
        yieldUnit: 'l',
        producesProductId: 'prod-egg-salad',
        items: [
          { refType: 'ingredient', refId: 'ing-egg', qty: 10, unit: 'unit' },
          { refType: 'ingredient', refId: 'ing-mayo', qty: 0.3, unit: 'l' },
        ],
        steps: [
          'לבשל ביצים קשות ולקלף.',
          'לרסק גס ולערבב עם מיונז.',
          'לתבל במלח ופלפל לפי הטעם.',
        ],
      },
      {
        id: 'recipe-zucchini-cream',
        name: 'קרם זוקיני',
        category: 'cold',
        yieldQty: 1,
        yieldUnit: 'l',
        producesProductId: 'prod-zucchini-cream',
        items: [
          { refType: 'ingredient', refId: 'ing-zucchini', qty: 1.5, unit: 'kg' },
          { refType: 'ingredient', refId: 'ing-oliveoil', qty: 0.1, unit: 'l' },
        ],
        steps: [
          'לצלות קישואים בתנור עד להתרככות.',
          'לטחון בבלנדר עם שמן זית עד קבלת מרקם חלק.',
          'לתבל במלח ופלפל ולצנן.',
        ],
      },
    ],
    tasks: [],
    taskOverrides: [],
    specialEvents: [],
    dayPlans: [],
    orderLines: [],
  };
}
