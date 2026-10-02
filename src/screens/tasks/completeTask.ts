import type { Dispatch } from 'react';
import { ingredientDeltasFor, type DisplayTask } from '../../lib/tasks';
import type { Action } from '../../store/reducer';
import { batchExpiry, expiryForBatch, validShelfLife, type BatchLabel } from '../../lib/expiry';
import type { AppState, Recipe } from '../../types';

/**
 * Applies a task's completion: computes the ingredient and product deltas at the given
 * multiplier and dispatches the right absolute-completion action for the task's source.
 *
 * A free-text task (no recipe) passes empty deltas — completing "clean the shelves" must not
 * touch stock.
 *
 * `today` is the day the batch is **made**, which sets its last good day when the recipe has a
 * shelf life. It comes from the caller, never the clock: the action is replayed on every device and
 * must land on the same date everywhere. Returns what to write on the container, if a date was set.
 *
 * In its own file, out of the row component, so it can be unit-tested against a fake dispatch
 * without standing up React: this is the one function in the task UI that changes inventory,
 * and the auto/manual branch below is exactly the kind of thing CLAUDE.md warns has to be got
 * right per `task.source`.
 */
export function completeTask(
  task: DisplayTask,
  recipe: Recipe | undefined,
  multiplier: number,
  state: AppState,
  dispatch: Dispatch<Action>,
  today: string,
): BatchLabel | undefined {
  const ingredientDeltas = recipe ? ingredientDeltasFor(recipe, multiplier, state) : [];
  const producedProductId = recipe?.producesProductId;
  const producedQty = recipe && producedProductId ? recipe.yieldQty * multiplier : undefined;
  const shelfLife = validShelfLife(recipe?.shelfLifeDays);
  const producedExpiresOn =
    shelfLife !== undefined && producedProductId && producedQty ? expiryForBatch(today, shelfLife) : undefined;

  if (task.source === 'manual') {
    dispatch({
      type: 'CONFIRM_TASK_COMPLETION',
      taskId: task.id,
      ingredientDeltas,
      producedProductId,
      producedQty,
      producedExpiresOn,
    });
  } else {
    dispatch({
      type: 'CONFIRM_AUTO_TASK_COMPLETION',
      id: task.id,
      productId: task.productId!,
      date: task.date,
      ingredientDeltas,
      producedProductId,
      producedQty,
      producedExpiresOn,
    });
  }

  const product = state.products.find((p) => p.id === producedProductId);
  if (!product || !producedExpiresOn) return undefined;
  const { after } = batchExpiry(product, producedExpiresOn);
  return {
    productName: product.name,
    preparedOn: today,
    expiresOn: producedExpiresOn,
    olderExpiresOn: after.expiresOn < producedExpiresOn ? after.expiresOn : undefined,
  };
}
