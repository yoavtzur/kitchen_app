export function FullScreenMessage({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center' }}>
      <p className="muted">{text}</p>
    </div>
  );
}
