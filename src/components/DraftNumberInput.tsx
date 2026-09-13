import { useEffect, useRef, useState, type CSSProperties } from 'react';

type Props = {
  /** `undefined` renders as a blank field (e.g. "use the default value") rather than 0. */
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  /** Whether an emptied field commits as `undefined` (clear) or reverts to the last value.
   * Defaults to reverting — most callers have no "cleared" state to fall back to. */
  allowClear?: boolean;
  id?: string;
  'aria-label'?: string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  min?: number;
};

function toDraft(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/** A number input that only dispatches on blur / Enter, not on every keystroke — so typing
 * "12" produces one committed change instead of two. Re-syncs its draft from `value` whenever
 * the input isn't focused, so an incoming sync update (another device) still lands; an
 * empty or invalid draft reverts to the last committed value (unless `allowClear`, in which
 * case it commits `undefined`). */
export function DraftNumberInput({
  value,
  onCommit,
  allowClear = false,
  id,
  'aria-label': ariaLabel,
  placeholder,
  className,
  style,
  min = 0,
}: Props) {
  const [draft, setDraft] = useState(toDraft(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(toDraft(value));
  }, [value]);

  function commit() {
    if (draft === '') {
      if (allowClear) {
        onCommit(undefined);
      } else {
        setDraft(toDraft(value));
      }
      return;
    }
    const parsed = parseFloat(draft);
    if (!Number.isNaN(parsed) && parsed >= min) {
      onCommit(parsed);
    } else {
      setDraft(toDraft(value));
    }
  }

  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type="number"
      inputMode="decimal"
      placeholder={placeholder}
      className={className}
      style={style}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
