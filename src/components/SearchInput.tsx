type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 'stepper' — oversized touch-friendly field: taller input, larger text, bigger clear button. */
  variant?: 'default' | 'stepper';
};

/** Controlled search box with a clear button; RTL-safe (no left/right offsets). */
export function SearchInput({ value, onChange, placeholder = 'חיפוש...', variant = 'default' }: Props) {
  return (
    <div className={`search-input ${variant === 'stepper' ? 'stepper' : ''}`}>
      <span aria-hidden="true">🔍</span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="נקה חיפוש">
          ✕
        </button>
      )}
    </div>
  );
}
