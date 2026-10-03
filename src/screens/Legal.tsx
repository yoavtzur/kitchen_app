import { Link } from 'react-router-dom';

/**
 * The privacy notice and terms of use, rendered **outside every gate** (see `LEGAL_ROUTES` and
 * the layout route in `App.tsx`).
 *
 * That placement is the requirement, not a detail: a privacy notice a person can only read
 * after creating the account is a notice given after the processing it describes has already
 * started. The sign-up screen links here, and these two routes are the only ones in the app
 * that render without a session.
 *
 * The text below describes what this codebase actually does, checked against it rather than
 * adapted from a template — which is the only way a notice is worth anything. Three facts about
 * it are worth keeping true as the app changes:
 *
 *   • It describes the **anonymous usage statistics** of `lib/analytics.ts` — closed event
 *     list, no identifier stored on the device, opt-out in Settings. If an event is added there
 *     that carries anything beyond a screen name or an action type, this document changes in
 *     the same commit.
 *   • It says photos sent to scan a recipe go to Google. That is `api/scan-recipe`.
 *   • It says deleting the last account in a kitchen deletes the kitchen. That is
 *     `delete_my_account()` in migration 0007.
 *
 * `OPERATOR` is the only part that is not derived from the code: a real notice needs a real,
 * named controller and a real address to send a request to. Deliberately one object at the top
 * of the file rather than strings scattered through the copy, so it is obvious that it is
 * unfilled — and it is listed in LAUNCH-CHECKLIST.md as a blocking item.
 */
const OPERATOR = {
  /** The legal entity that runs this kitchen's installation — the data controller. */
  name: 'מפעיל האפליקציה',
  /** Where a person sends an access, correction or deletion request. */
  email: 'privacy@example.com',
  /** The region the Supabase project was created in; shown because it is where the data lives. */
  region: 'האיחוד האירופי (פרנקפורט)',
  /** Last substantive change to these documents. */
  updated: '1 באוקטובר 2026',
};

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">{title}</h1>
      </div>
      <div className="card stack-gap-3">{children}</div>
      <div className="card stack-gap-2">
        <p className="muted">עודכן לאחרונה: {OPERATOR.updated}</p>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn" style={{ flex: 1, textAlign: 'center' }} to="/legal/privacy">
            פרטיות
          </Link>
          <Link className="btn" style={{ flex: 1, textAlign: 'center' }} to="/legal/terms">
            תנאי שימוש
          </Link>
          <Link className="btn" style={{ flex: 1, textAlign: 'center' }} to="/">
            חזרה לאפליקציה
          </Link>
        </div>
      </div>
    </div>
  );
}

export function Privacy() {
  return (
    <LegalPage title="מדיניות פרטיות">
      <p>
        האפליקציה מנהלת מלאי, מתכונים ומשימות הכנה במטבח. המסמך הזה מפרט אילו נתונים נשמרים, היכן, ולמה — ומה אפשר
        לעשות איתם. האחראי על המידע הוא {OPERATOR.name}, ופניות בנושא נשלחות אל {OPERATOR.email}.
      </p>

      <h2 className="section-title">מה נשמר</h2>
      <p>
        <strong>חשבון:</strong> כתובת אימייל וסיסמה מוצפנת. אלה נדרשים כדי שתוכלו להתחבר ממספר מכשירים ולראות את
        אותם הנתונים.
      </p>
      <p>
        <strong>בקשת הצטרפות:</strong> מי שמבקש להצטרף למטבח (בקישור הזמנה או בקוד) מזין שם פרטי, שם משפחה, ואם
        רוצה — מספר טלפון. הפרטים האלה גלויים לשף של אותו מטבח בלבד, כדי שיוכל לזהות מי מבקש להצטרף ולאשר או לדחות.
        עד לאישור הבקשה אין למבקש גישה לנתוני המטבח. עם אישור, השם נשמר כשם הטבח בנתוני המטבח, הטלפון (אם הוזן) נשמר
        כפרטי קשר כמתואר להלן, והבקשה נמחקת; דחיית הבקשה משאירה סימון זמני עד שהמבקש מאשר שראה אותה. בקשה שנמחק החשבון
        שלה נמחקת איתו. קישורי הזמנה נשמרים כקוד גיבוב בלבד, ופגים לאחר 72 שעות.
      </p>
      <p>
        <strong>פרטי קשר:</strong> מספר טלפון שהזנתם בפרופיל (או בבקשת ההצטרפות) נשמר בנפרד מנתוני המטבח, וניתן
        לשנות או למחוק אותו בכל עת במסך "הפרופיל שלי". השף של המטבח רואה את המספר ואת כתובת האימייל של כל חברי הצוות,
        כדי שיוכל ליצור קשר; טבח רואה רק את מספרי הטלפון של השפים, ולא של טבחים אחרים. המספר נמחק כשהחשבון נמחק או
        כשהשף מסיר אתכם מהמטבח.
      </p>
      <p>
        <strong>נתוני המטבח:</strong> מצרכים, מוצרים, מתכונים, כמויות, משימות הכנה, הזמנות ספקים, ושמות הטבחים
        שהוזנו בהגדרות. שמות הטבחים הם טקסט חופשי שהשף מקליד — אם מקלידים שם מלא של אדם, זה מידע אישי על אותו אדם,
        והוא נשמר יחד עם שאר נתוני המטבח.
      </p>
      <p>
        <strong>נתונים טכניים:</strong> מזהה מכשיר אקראי שנוצר מקומית (לצורכי איתור תקלות בסנכרון בלבד), ומונה יומי
        של פעולות סריקה והצטרפות, שנועד למנוע שימוש לרעה.
      </p>
      <p>
        <strong>סטטיסטיקות שימוש אנונימיות:</strong> כדי להבין אילו חלקים באפליקציה משמשים בפועל, נשלחים אל PostHog
        אירועים בודדים מרשימה סגורה: שהאפליקציה נפתחה, שם המסך שנפתח (למשל "הזמנות"), וסוג הפעולה שבוצעה (למשל
        "השלמת משימה"). <strong>לא נשלחים שמות, כמויות, תוכן מתכונים, כתובת אימייל או כל טקסט שהוזן.</strong> האירועים
        אינם מקושרים לחשבון: מזהה אקראי נשמר בזיכרון הדף בלבד, אינו נכתב למכשיר ומתחלף בכל פתיחה, כתובת ה‑IP אינה
        משמשת לאיתור מיקום, ואין יצירת פרופיל אישי. אפשר לכבות זאת בהגדרות ("פרטיות וחשבון"), והאפליקציה מכבדת
        אוטומטית את אות "Do Not Track" ו‑Global Privacy Control של הדפדפן. במצב מקומי (ללא חשבון) שום דבר לא נשלח.
      </p>
      <p className="muted">
        אין באפליקציה פרסום, פיקסלים או מעקב בין אתרים, ואין קובצי Cookie פרסומיים. האחסון המקומי בדפדפן משמש רק
        לשמירת ההתחברות, לעבודה במצב לא מקוון ולבחירות שלכם (כמו כיבוי הסטטיסטיקות).
      </p>

      <h2 className="section-title">היכן זה נשמר, ומי עוד רואה את זה</h2>
      <p>
        הנתונים נשמרים אצל <strong>Supabase</strong> (מסד נתונים ושירות הזדהות) באזור {OPERATOR.region}. כל מי שחבר
        באותו מטבח רואה את נתוני המטבח — זו מטרת האפליקציה. חברי מטבח אחר אינם רואים דבר.
      </p>
      <p>
        <strong>סריקת מתכון מתמונה</strong> היא הפעולה היחידה ששולחת מידע לצד שלישי נוסף: התמונה נשלחת אל שירות
        Gemini של Google לצורך חילוץ הטקסט, ומוחזרת כטקסט. התמונה אינה נשמרת אצלנו. הפעולה מופעלת רק כשלוחצים על
        כפתור הסריקה.
      </p>
      <p>
        <strong>סטטיסטיקות שימוש</strong> נשלחות אל PostHog, אם הופעלו, כמתואר למעלה.
      </p>
      <p>
        <strong>דיווחי תקלות</strong> נשלחים אל Sentry, אם הופעל. הדיווחים עוברים סינון אגרסיבי לפני השליחה: כל
        טקסט בעברית, כתובות אימייל ומזהים ייחודיים מוסרים מהם, ותוכן המסך ופעולות המשתמש אינם נשלחים כלל. מה שנשאר
        הוא סוג השגיאה ומיקומה בקוד.
      </p>

      <h2 className="section-title">כמה זמן</h2>
      <p>
        נתוני המטבח נשמרים כל עוד המטבח קיים. מוני הסריקה וההצטרפות נשמרים ברמת היום ואינם מזוהים עם פעולה מסוימת.
        מחיקת החשבון האחרון במטבח מוחקת גם את המטבח עצמו על כל נתוניו.
      </p>

      <h2 className="section-title">הזכויות שלכם</h2>
      <p>
        <strong>עיון והעתק:</strong> כפתור "ייצוא גיבוי" בהגדרות מוריד את כל נתוני המטבח כקובץ JSON, בכל רגע, ללא
        בקשה מאיתנו.
      </p>
      <p>
        <strong>מחיקה:</strong> כפתור "מחיקת החשבון" בהגדרות מוחק את החשבון, את כתובת האימייל ואת הסיסמה לצמיתות.
        אם אתם החברים האחרונים במטבח — גם המטבח נמחק. הפעולה אינה הפיכה ואין לנו עותק לשחזר ממנו.
      </p>
      <p>
        <strong>תיקון והתנגדות:</strong> אפשר לערוך כל נתון ישירות באפליקציה. לכל בקשה אחרת, או לתלונה, פנו אל{' '}
        {OPERATOR.email}.
      </p>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage title="תנאי שימוש">
      <p>
        השימוש באפליקציה מותנה בהסכמה לתנאים שלהלן. האפליקציה מסופקת על ידי {OPERATOR.name} לשימוש צוות המטבח.
      </p>

      <h2 className="section-title">חשבון והצטרפות למטבח</h2>
      <p>
        כל טבח פותח חשבון משלו ומבקש להצטרף למטבח — באמצעות קישור הזמנה חד-פעמי שהשף שולח לו (תקף 72 שעות), או
        באמצעות קוד בן שש ספרות. <strong>הצטרפות נכנסת לתוקף רק לאחר שהשף מאשר את הבקשה.</strong> אין למסור את
        הקישור או הקוד לגורם שאינו חלק מהצוות. שף יכול להחליף את הקוד בכל רגע מתוך ההגדרות; החלפה מבטלת את הקוד
        הישן מיידית.
      </p>
      <p>אין לשתף חשבון בין אנשים. חשבון אחד שייך לאדם אחד, ושף אחראי להסיר טבח שעזב.</p>

      <h2 className="section-title">מה מותר ומה לא</h2>
      <p>
        האפליקציה מיועדת לניהול מטבח. אין לנסות לנחש קודי הצטרפות, לעקוף את מגבלות השימוש, להעמיס על השירות, או
        לגשת לנתונים של מטבח שאינכם חברים בו. ניסיונות הצטרפות מוגבלים במספרם ביום, ופעולות סריקה מוגבלות במכסה
        יומית.
      </p>

      <h2 className="section-title">זמינות ואחריות</h2>
      <p>
        השירות מסופק כפי שהוא. איננו מתחייבים לזמינות רציפה, ואיננו אחראים להחלטות תפעוליות שהתקבלו על סמך חישובי
        האפליקציה — הכמויות, ההזמנות והמשימות הן הצעה המבוססת על הנתונים שהוזנו, והאחריות על בדיקתן היא על הצוות.
      </p>
      <p>
        <strong>גיבוי:</strong> הנתונים מסונכרנים בין מכשירי המטבח, אך זהו אינו גיבוי. מומלץ לייצא גיבוי מעת לעת
        מתוך ההגדרות. ייבוא גיבוי מחליף את כל נתוני המטבח בכל המכשירים ואינו הפיך.
      </p>

      <h2 className="section-title">סיום</h2>
      <p>
        אפשר להפסיק את השימוש ולמחוק את החשבון בכל רגע מתוך ההגדרות. אנו רשאים להשבית גישה של חשבון שפועל בניגוד
        לתנאים אלה.
      </p>
      <p className="muted">שאלות: {OPERATOR.email}</p>
    </LegalPage>
  );
}
