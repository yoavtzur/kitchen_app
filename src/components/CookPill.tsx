import type { Cook } from '../types';

/** The color-pill idiom repeated across Tasks/Settings/PickCook, extracted once a fourth
 * caller (the chef permissions list) would otherwise have copied it again. */
export function CookPill({ cook }: { cook: Cook }) {
  return (
    <span className="pill" style={{ background: cook.color + '22', color: cook.color }}>
      {cook.name}
    </span>
  );
}
