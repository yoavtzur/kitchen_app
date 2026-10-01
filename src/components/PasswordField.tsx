import { useId, useState, type ComponentProps } from 'react';
import { EyeIcon, EyeOffIcon } from './icons';

type Props = Omit<ComponentProps<'input'>, 'type' | 'id'> & {
  label: string;
  /** Pass to keep an existing `htmlFor` target; otherwise one is generated. */
  id?: string;
};

/**
 * A password input with the eye that shows what was typed — the thing every sign-in screen has
 * and this one lacked. On a phone, in a kitchen, with gloves or wet hands, a mistyped password is
 * the common failure and being unable to see it is what makes it expensive.
 *
 * Details that are easy to get wrong here:
 *  - the toggle is `type="button"`, because inside a `<form>` a bare button submits it;
 *  - it is a real button with `aria-pressed`, so a screen reader hears "show password, on/off"
 *    rather than an unlabeled icon;
 *  - `onMouseDown`/`onPointerDown` keep focus in the input, so tapping the eye does not dismiss
 *    the phone keyboard (and the caret stays where it was);
 *  - `autoComplete` and `name` are passed straight through: the toggle changes `type` to `text`
 *    and back, and password managers key off those attributes, not the type, to recognise the field.
 */
export function PasswordField({ label, id, className, ...input }: Props) {
  const generated = useId();
  const fieldId = id ?? generated;
  const [visible, setVisible] = useState(false);

  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label htmlFor={fieldId}>{label}</label>
      <div className="password-wrap">
        <input
          {...input}
          id={fieldId}
          type={visible ? 'text' : 'password'}
          className={className}
          // A revealed password must not be "corrected" by the keyboard or re-capitalised.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={visible ? 'הסתר סיסמה' : 'הצג סיסמה'}
          aria-pressed={visible}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
        </button>
      </div>
    </div>
  );
}
