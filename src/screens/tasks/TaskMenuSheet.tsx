import { BottomSheet } from '../../components/BottomSheet';
import { ShortageIcon, TrashIcon } from '../../components/icons';

/**
 * The "⋯" on a task row. Removing a task used to be a big ✕ beside the completion box, a thumb's
 * width from the control it is used all day, so it now takes two taps. The same sheet is also the
 * button route to the quick actions a left swipe opens: a gesture on its own is unreachable by
 * keyboard and screen reader, which is the problem the completion checkbox already had.
 */
export function TaskMenuSheet({
  title,
  hasRecipe,
  onDetails,
  onQuickActions,
  onDelete,
  onClose,
}: {
  title: string;
  hasRecipe: boolean;
  onDetails: () => void;
  onQuickActions: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet title={title} onClose={onClose}>
      <div className="stack-gap-2">
        {hasRecipe && (
          <>
            <button type="button" className="btn btn-block" onClick={onDetails}>
              מתכון ורכיבים
            </button>
            <button type="button" className="btn btn-block" onClick={onQuickActions}>
              <ShortageIcon size={20} />
              חסר חומר גלם או פחת
            </button>
          </>
        )}
        <button type="button" className="btn btn-block btn-danger" onClick={onDelete}>
          <TrashIcon size={20} />
          הסר משימה
        </button>
      </div>
    </BottomSheet>
  );
}
