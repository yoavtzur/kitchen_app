import { useState } from 'react';
import { useInstallHint } from '../lib/useInstallHint';
import { BottomSheet } from './BottomSheet';
import { ShareIcon } from './icons';

/**
 * How to add the app to an iPhone's home screen. There is no install button to build on iOS, so
 * this is instructions — with the share icon drawn, because "the share button" is exactly what
 * someone who has never done this cannot find.
 *
 * The third step is the one that matters most: the icon is a separate app from the browser tab it
 * was added from, and does not share its sign-in, so the first launch asks for the e-mail and
 * password again. Said up front, it is a one-time step; unsaid, it looks like the app lost the account.
 */
export function InstallStepsSheet({ onClose }: { onClose: () => void }) {
  return (
    <BottomSheet title="הוספה למסך הבית" onClose={onClose}>
      <ol className="install-steps">
        <li>
          לחצו על כפתור השיתוף{' '}
          <span className="install-share" aria-hidden="true">
            <ShareIcon size={22} />
          </span>
          . בספארי הוא בתחתית המסך, בכרום בשורת הכתובת.
        </li>
        <li>גללו ובחרו ״הוסף למסך הבית״, ואז ״הוסף״.</li>
        <li>
          פתחו את האפליקציה מהאייקון החדש והתחברו שוב באימייל ובסיסמה — רק בפעם הראשונה. האייקון הוא אפליקציה נפרדת
          מהדפדפן, ולכן ההתחברות לא עוברת אליו.
        </li>
      </ol>
      <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
        הבנתי
      </button>
    </BottomSheet>
  );
}

/** The card on the task list and the waiting screen: one line of why, one button for how, one for "not now". */
export function InstallHintCard() {
  const { applies, dismissed, dismiss } = useInstallHint();
  const [open, setOpen] = useState(false);
  if (!applies || dismissed) return null;
  return (
    <>
      <div className="card install-hint stack-gap-2">
        <p style={{ fontWeight: 600 }}>הוסיפו את האפליקציה למסך הבית</p>
        <p className="muted">היא תיפתח במסך מלא, בלי שורת כתובת, בלחיצה אחת.</p>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => setOpen(true)}>
            הראו לי איך
          </button>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={dismiss}>
            לא עכשיו
          </button>
        </div>
      </div>
      {open && <InstallStepsSheet onClose={() => setOpen(false)} />}
    </>
  );
}
