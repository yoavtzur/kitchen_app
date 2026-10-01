import { useState, type FormEvent } from 'react';
import { useApp } from '../store/AppContext';
import { BottomSheet } from '../components/BottomSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PencilIcon, TrashIcon } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { newId } from '../lib/ids';
import { useUndo } from '../lib/undo';
import { stationOptions, UNASSIGNED_CATEGORY, UNASSIGNED_LABEL } from '../lib/recipeCategories';
import { stationImpact, stationNameError } from '../lib/stations';
import type { Station } from '../types';

/**
 * The kitchen's stations (פסים): add, rename, delete. Chef only — see `ChefRoute`.
 *
 * Deleting is the dangerous one, which is why it hides behind an explicit "עריכה" mode instead of
 * a swipe: a whole station is one stray gesture away from taking its prep lists with it. The red
 * bin then opens a confirmation that makes the chef say where the station's recipes (and with
 * them its prep tasks) go, so nothing is ever left pointing at a station that no longer exists.
 */
export function Stations() {
  const { state, dispatch } = useApp();
  const { deleteWithUndo } = useUndo();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [renaming, setRenaming] = useState<Station | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [deleting, setDeleting] = useState<Station | null>(null);
  const [moveTo, setMoveTo] = useState(UNASSIGNED_CATEGORY);

  function add(e: FormEvent) {
    e.preventDefault();
    const error = stationNameError(newName, state.stations);
    if (error) {
      setAddError(error);
      return;
    }
    dispatch({ type: 'ADD_STATION', station: { id: newId('station'), name: newName.trim(), createdAt: new Date().toISOString() } });
    setNewName('');
    setAddError('');
  }

  function openRename(station: Station) {
    setRenaming(station);
    setRenameValue(station.name);
    setRenameError('');
  }

  function saveRename(e: FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    const error = stationNameError(renameValue, state.stations, renaming.id);
    if (error) {
      setRenameError(error);
      return;
    }
    dispatch({ type: 'RENAME_STATION', id: renaming.id, name: renameValue });
    setRenaming(null);
  }

  function openDelete(station: Station) {
    setDeleting(station);
    setMoveTo(UNASSIGNED_CATEGORY);
  }

  function confirmDelete() {
    if (!deleting) return;
    deleteWithUndo({ type: 'DELETE_STATION', id: deleting.id, moveToId: moveTo }, `הפס "${deleting.name}" נמחק`);
    setDeleting(null);
  }

  const impact = deleting ? stationImpact(state, deleting.id) : null;
  const targets = deleting ? stationOptions(state.stations.filter((s) => s.id !== deleting.id)) : [];
  const targetLabel = targets.find((t) => t.value === moveTo)?.label ?? UNASSIGNED_LABEL;

  return (
    <div>
      <ScreenHeader
        title="ניהול פסים"
        actions={
          state.stations.length > 0 ? (
            <button type="button" className="btn" onClick={() => setEditing((v) => !v)}>
              {editing ? 'סיום' : 'עריכה'}
            </button>
          ) : undefined
        }
      />

      <form onSubmit={add} className="stack-gap-2" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="new-station">פס חדש</label>
          <input
            id="new-station"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setAddError('');
            }}
            placeholder="למשל: גריל"
            autoComplete="off"
          />
        </div>
        {addError && <p style={{ color: 'var(--color-red)' }}>{addError}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={!newName.trim()}>
          הוסף פס
        </button>
      </form>

      {state.stations.length === 0 ? (
        <p className="empty-state">עוד לא הוגדרו פסים. כל המתכונים והמשימות נמצאים תחת "{UNASSIGNED_LABEL}".</p>
      ) : (
        <div className="list-card">
          {state.stations.map((station) => {
            const { recipes } = stationImpact(state, station.id);
            return (
              <div key={station.id} className="menu-row" style={{ cursor: 'default' }}>
                <span className="menu-row-label">
                  {station.name}
                  <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                    {recipes === 0 ? 'אין מתכונים' : `${recipes} מתכונים`}
                  </span>
                </span>
                {editing && (
                  <>
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={`שינוי שם: ${station.name}`}
                      onClick={() => openRename(station)}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon btn-danger"
                      aria-label={`מחיקת הפס: ${station.name}`}
                      onClick={() => openDelete(station)}
                    >
                      <TrashIcon />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
        "{UNASSIGNED_LABEL}" תמיד קיים, ושם מתכנסים מתכונים ומשימות שאין להם פס.
      </p>

      {renaming && (
        <BottomSheet title="שינוי שם פס" onClose={() => setRenaming(null)}>
          <form onSubmit={saveRename} className="stack-gap-3">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="rename-station">שם הפס</label>
              <input
                id="rename-station"
                value={renameValue}
                onChange={(e) => {
                  setRenameValue(e.target.value);
                  setRenameError('');
                }}
                autoComplete="off"
                autoFocus
              />
            </div>
            {renameError && <p style={{ color: 'var(--color-red)' }}>{renameError}</p>}
            <button type="submit" className="btn btn-primary btn-block">
              שמור
            </button>
          </form>
        </BottomSheet>
      )}

      {deleting && impact && (
        <ConfirmDialog
          title={`מחיקת הפס "${deleting.name}"`}
          confirmLabel="מחק פס"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={confirmDelete}
        >
          <p>
            {impact.recipes === 0 && impact.manualTasks === 0
              ? 'אין מתכונים או משימות בפס הזה.'
              : `${impact.recipes} מתכונים${impact.manualTasks > 0 ? ` ו-${impact.manualTasks} משימות פתוחות` : ''} יועברו אל "${targetLabel}", ורשימות ההכנה שלהם יופיעו שם.`}
          </p>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="move-station-to">להעביר אל</label>
            <select id="move-station-to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              {targets.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <p className="muted">הפס יימחק לכל הצוות בכל המכשירים. אפשר לבטל מיד אחרי המחיקה.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
