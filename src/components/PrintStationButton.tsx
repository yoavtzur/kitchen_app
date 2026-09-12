type Props = {
  label?: string;
  onBeforePrint?: () => void;
};

/** Triggers the browser's native print dialog — see the `@media print` rules in global.css
 * for how the page is reshaped for paper. No third-party library; browser print drivers only. */
export function PrintStationButton({ label = 'הדפס רשימה', onBeforePrint }: Props) {
  function handlePrint() {
    try {
      onBeforePrint?.();
      window.print();
    } catch (err) {
      console.error('print failed', err);
    }
  }

  return (
    <button
      type="button"
      className="btn no-print"
      style={{ minHeight: 48, display: 'inline-flex', alignItems: 'center', gap: 8 }}
      onClick={handlePrint}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9V3h12v6" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <path d="M6 14h12v7H6z" />
      </svg>
      {label}
    </button>
  );
}
