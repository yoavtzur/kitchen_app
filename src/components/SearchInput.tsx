type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

/** Controlled search box with a clear button; RTL-safe (no left/right offsets). */
export function SearchInput({ value, onChange, placeholder = 'חיפוש...' }: Props) {
  return (
    <div className="search-input">
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
