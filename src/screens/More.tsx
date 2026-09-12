import { Link } from 'react-router-dom';

export function More() {
  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">עוד</h1>
      </div>
      <div className="card-list">
        <Link to="/consumption" className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          צריכה
        </Link>
        <Link to="/orders" className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          הזמנת אספקה
        </Link>
        <Link to="/settings" className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          הגדרות
        </Link>
      </div>
    </div>
  );
}
