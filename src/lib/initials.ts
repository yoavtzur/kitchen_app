/** Initials for an avatar: the first letter of up to two words. Hebrew has no case, so no
 * transformation is needed — and a blank name must not render an empty circle. */
export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]);
  return letters.join('') || '•';
}
