import { useState, type FormEvent } from 'react';
import { useApp } from '../store/AppContext';
import { BottomSheet } from '../components/BottomSheet';
import { ContactActions } from '../components/ContactActions';
import { EmptyState } from '../components/EmptyState';
import { ScreenHeader } from '../components/ScreenHeader';
import { WeekdayPicker } from '../components/WeekdayPicker';
import { PencilIcon, TrashIcon } from '../components/icons';
import { newId } from '../lib/ids';
import { useUndo } from '../lib/undo';
import { todayStr } from '../lib/date';
import {
  ingredientCount,
  orderDaysLabel,
  ordersOn,
  supplierByName,
  supplierNameError,
  supplierNames,
  todayFirst,
} from '../lib/suppliers';
import type { Supplier, Weekday } from '../types';

/**
 * Suppliers (chef only, `ChefRoute`): who to call, on what number, and on which days an order goes
 * out. A card is linked to ingredients by name, so every supplier name already typed on an
 * ingredient is listed here from the start — tapping it just adds the details. Those details are
 * what make the morning order's WhatsApp button open the supplier's own chat, and what puts
 * "מזמינים היום" on the right supplier.
 */
export function Suppliers() {
  const { state } = useApp();
  const { deleteWithUndo } = useUndo();
  const today = todayStr();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const names = todayFirst(supplierNames(state), state, today);

  function openNew() {
    setEditing({ id: newId('supplier'), name: '' });
  }

  function openFor(name: string) {
    setEditing(supplierByName(state, name) ?? { id: newId('supplier'), name });
  }

  return (
    <div>
      <ScreenHeader
        title="ספקים"
        actions={
          <button type="button" className="btn btn-icon btn-primary" onClick={openNew} aria-label="הוסף ספק">
            +
          </button>
        }
      />
      {names.length === 0 ? (
        <EmptyState text="אין עדיין ספקים. הוסיפו ספק, או רשמו שם ספק על מצרך." />
      ) : (
        <div className="stack-gap-3">
          {names.map((name) => {
            const card = supplierByName(state, name);
            const count = ingredientCount(state, name);
            const orderToday = ordersOn(card, today);
            return (
              <div key={name} className="card supplier-card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <strong>
                      {name} {orderToday && <span className="pill green">מזמינים היום</span>}
                    </strong>
                    <span className="muted">
                      {count} מצרכים
                      {card?.contactName ? ` · ${card.contactName}` : ''}
                      {orderDaysLabel(card) ? ` · ימי הזמנה: ${orderDaysLabel(card)}` : ''}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 4, width: 'auto' }}>
                    <button type="button" className="btn btn-icon" aria-label={`עריכת ${name}`} onClick={() => openFor(name)}>
                      <PencilIcon size={20} />
                    </button>
                    {card && (
                      <button
                        type="button"
                        className="btn btn-icon"
                        aria-label={`מחיקת פרטי ${name}`}
                        onClick={() => deleteWithUndo({ type: 'DELETE_SUPPLIER', id: card.id }, `פרטי "${name}" נמחקו`)}
                      >
                        <TrashIcon size={20} />
                      </button>
                    )}
                  </div>
                </div>
                {card?.phone ? (
                  <ContactActions phone={card.phone} />
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => openFor(name)}>
                    הוספת טלפון וימי הזמנה
                  </button>
                )}
                {card?.email && (
                  <a className="contact-email" href={`mailto:${card.email}`} dir="ltr" style={{ textAlign: 'start' }}>
                    {card.email}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="muted" style={{ marginTop: 'var(--space-4)' }}>
        מחיקת ספק מוחקת רק את פרטי הקשר. המצרכים נשארים משויכים לשם שלו.
      </p>
      {editing && <SupplierSheet supplier={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SupplierSheet({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const exists = (state.suppliers ?? []).some((s) => s.id === supplier.id);
  const [name, setName] = useState(supplier.name);
  const [contactName, setContactName] = useState(supplier.contactName ?? '');
  const [phone, setPhone] = useState(supplier.phone ?? '');
  const [email, setEmail] = useState(supplier.email ?? '');
  const [orderDays, setOrderDays] = useState<Weekday[]>(supplier.orderDays ?? []);
  const [error, setError] = useState('');

  function save(e: FormEvent) {
    e.preventDefault();
    const problem = supplierNameError(name, state.suppliers, supplier.id);
    if (problem) {
      setError(problem);
      return;
    }
    const next: Supplier = { id: supplier.id, name: name.trim() };
    if (contactName.trim()) next.contactName = contactName.trim();
    if (phone.trim()) next.phone = phone.trim();
    if (email.trim()) next.email = email.trim();
    if (orderDays.length > 0) next.orderDays = orderDays;
    dispatch({ type: 'SAVE_SUPPLIER', supplier: next });
    onClose();
  }

  const renamed = exists && supplier.name.trim() !== name.trim() && name.trim() !== '';
  return (
    <BottomSheet title={exists ? `עריכת ${supplier.name}` : supplier.name ? `פרטי ${supplier.name}` : 'ספק חדש'} onClose={onClose}>
      <form className="stack-gap-3" onSubmit={save}>
        <div className="field">
          <label htmlFor="sup-name">שם הספק</label>
          <input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          {renamed && (
            <p className="muted">המצרכים של "{supplier.name}" יעברו לשם החדש.</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="sup-contact">איש קשר</label>
          <input id="sup-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="sup-phone">טלפון</label>
          <input id="sup-phone" type="tel" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sup-email">אימייל</label>
          <input id="sup-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>ימי הזמנה</label>
          <WeekdayPicker value={orderDays} onChange={setOrderDays} />
        </div>
        {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
        <button type="submit" className="btn btn-primary btn-block">
          שמירה
        </button>
      </form>
    </BottomSheet>
  );
}
