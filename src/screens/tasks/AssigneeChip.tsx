import { ProfileIcon } from '../../components/icons';
import { assigneeInitial } from '../../lib/taskRow';
import type { Cook } from '../../types';

/**
 * Who has this task, as a 44px circle: the cook's initial in their own colour, or a person glyph
 * while nobody does. The circle is what you see; a real `<select>` laid invisibly over it is what
 * you tap, so the platform's own picker opens (on a phone that is the native sheet, not a menu
 * built here) and keyboards and screen readers get a form control for free.
 */
export function AssigneeChip({
  cooks,
  value,
  onChange,
}: {
  cooks: Cook[];
  value: string | null | undefined;
  onChange: (cookId: string) => void;
}) {
  const cook = cooks.find((c) => c.id === value);
  return (
    <label
      className="assignee-chip no-print"
      title={cook ? cook.name : 'שיוך לטבח'}
      style={cook ? { background: cook.color + '22', color: cook.color, borderColor: cook.color } : undefined}
    >
      <span aria-hidden="true">{cook ? assigneeInitial(cook.name) : <ProfileIcon size={20} />}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label="שיוך לטבח">
        <option value="">— ללא —</option>
        {cooks.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
