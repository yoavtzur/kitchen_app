import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { BottomSheet } from '../../components/BottomSheet';
import { ShortageIcon, WasteIcon } from '../../components/icons';
import { weightedRecipeItems } from '../../lib/calc';
import { stockAfterWaste, WASTE_SHARES } from '../../lib/quickActions';
import { unitLabel } from '../../lib/units';
import { useUndo } from '../../lib/undo';
import type { DisplayTask } from '../../lib/tasks';
import type { Ingredient, Recipe } from '../../types';

type Step = { kind: 'menu' } | { kind: 'short' } | { kind: 'waste' } | { kind: 'waste-share'; ingredient: Ingredient };

/**
 * What a left swipe on a task card opens: the two things a cook needs mid-prep that are not "done"
 * — "we are out of this" and "this went in the bin" — as big targets, with nothing to type.
 *
 *   חסר חומר גלם   one tap on the ingredient flags it short; it then shows on the morning order.
 *   פחת            pick the ingredient, then ¼ / ½ / הכל of what is on hand is taken off stock.
 *
 * Both finish by closing the sheet and offering "בטל" (the shared 4s toast), which is what makes
 * it safe to have no confirmation step: a mis-tap is a tap to put back.
 */
export function QuickActionsSheet({
  task,
  recipe,
  onClose,
}: {
  task: DisplayTask;
  recipe: Recipe;
  onClose: () => void;
}) {
  const { state, dispatch } = useApp();
  const { showUndo } = useUndo();
  const [step, setStep] = useState<Step>({ kind: 'menu' });

  // The recipe's own raw ingredients (one level — a prepared product it consumes is not something
  // a cook reports as short from here). Read live from state so a flag set a moment ago shows.
  const ingredients = weightedRecipeItems(recipe, task.multiplier, state)
    .filter((line) => line.refType === 'ingredient')
    .map((line) => state.ingredients.find((i) => i.id === line.refId))
    .filter((i): i is Ingredient => i !== undefined);

  function markShort(ingredient: Ingredient) {
    const previous = Boolean(ingredient.shortFlag);
    dispatch({ type: 'SET_INGREDIENT_SHORT', id: ingredient.id, short: !previous });
    onClose();
    showUndo(
      previous ? `"${ingredient.name}" אינו חסר יותר` : `"${ingredient.name}" סומן כחסר — יעלה להזמנת הבוקר`,
      () => dispatch({ type: 'SET_INGREDIENT_SHORT', id: ingredient.id, short: previous }),
    );
  }

  function wasteShare(ingredient: Ingredient, share: number, label: string) {
    const previous = ingredient.currentQty;
    dispatch({ type: 'SET_INGREDIENT_QTY', id: ingredient.id, qty: stockAfterWaste(previous, share) });
    onClose();
    showUndo(`פחת ${label} מ"${ingredient.name}"`, () =>
      dispatch({ type: 'SET_INGREDIENT_QTY', id: ingredient.id, qty: previous }),
    );
  }

  const title =
    step.kind === 'menu' ? 'פעולות מהירות' : step.kind === 'short' ? 'מה חסר?' : step.kind === 'waste' ? 'מה התקלקל?' : `כמה פחת מ"${step.ingredient.name}"?`;

  return (
    <BottomSheet title={title} onClose={onClose}>
      {step.kind === 'menu' && (
        <div className="quick-grid">
          <button type="button" className="quick-tile" onClick={() => setStep({ kind: 'short' })}>
            <ShortageIcon size={44} />
            חסר חומר גלם
          </button>
          <button type="button" className="quick-tile" onClick={() => setStep({ kind: 'waste' })}>
            <WasteIcon size={44} />
            דיווח פחת
          </button>
        </div>
      )}

      {(step.kind === 'short' || step.kind === 'waste') && (
        <div className="stack-gap-2">
          {ingredients.length === 0 && <p className="muted">למתכון הזה אין מצרכים.</p>}
          {ingredients.map((ing) => (
            <button
              key={ing.id}
              type="button"
              className="quick-row"
              onClick={() => (step.kind === 'short' ? markShort(ing) : setStep({ kind: 'waste-share', ingredient: ing }))}
            >
              <span>{ing.name}</span>
              <span className="muted">
                {step.kind === 'short' && ing.shortFlag ? 'מסומן כחסר ✓' : `במלאי: ${ing.currentQty} ${unitLabel(ing.unit)}`}
              </span>
            </button>
          ))}
          <button type="button" className="btn btn-block" onClick={() => setStep({ kind: 'menu' })}>
            חזרה
          </button>
        </div>
      )}

      {step.kind === 'waste-share' && (
        <div className="stack-gap-3">
          <p className="muted">
            במלאי: {step.ingredient.currentQty} {unitLabel(step.ingredient.unit)}
          </p>
          <div className="quick-grid quick-grid-3">
            {WASTE_SHARES.map(({ share, label }) => (
              <button
                key={share}
                type="button"
                className="quick-tile"
                onClick={() => wasteShare(step.ingredient, share, label)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-block" onClick={() => setStep({ kind: 'waste' })}>
            חזרה
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
