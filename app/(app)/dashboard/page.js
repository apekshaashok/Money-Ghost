'use client';
import { useApp } from '../../../components/AppShell.js';
import { useApi, money, day } from '../../../components/ui.js';

export default function Dashboard() {
  const { accountId, account } = useApp();
  const { data, error } = useApi(accountId ? `/api/dashboard?account=${accountId}` : null);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading...</p>;

  return (
    <>
      <h1>Dashboard - {account?.name}</h1>
      <div className="box">
        <b>Active subscriptions:</b> {data.cost?.active_subscriptions ?? 0} &nbsp;|&nbsp;
        <b>Cost per month:</b> {money(data.cost?.monthly_total ?? 0)} &nbsp;|&nbsp;
        <b>Cost per year:</b> {money(data.cost?.yearly_total ?? 0)}
      </div>

      <div className="box">
        <h2>Alerts</h2>
        <ul>
          {data.priceRises.map((p) => (
            <li key={p.display_name}>Price increase: <b>{p.display_name}</b> went from {money(p.previous_amount)} to {money(p.current_amount)} (+{p.last_pct_change}%) on {day(p.price_changed_on)}</li>
          ))}
          {data.dormant.map((d) => (
            <li key={d.display_name}>Dormant: <b>{d.display_name}</b> ({money(d.current_amount)}) has not charged since {day(d.last_charge)}</li>
          ))}
          {data.dejaVu.map((d, i) => (
            <li key={i}>Possible double charge: <code>{d.raw_description}</code> {money(d.amount)} on {day(d.prev_date)} and {day(d.txn_date)}</li>
          ))}
          {data.household.map((h, i) => (
            <li key={i}>Household duplicate: <b>{h.display_name}</b> is paid in both {h.account} and {h.other_account}</li>
          ))}
        </ul>
        {data.priceRises.length + data.dormant.length + data.dejaVu.length + data.household.length === 0 && <p>No alerts.</p>}
      </div>

      <div className="row">
        <div className="box">
          <h2>Upcoming charges (next 30 days)</h2>
          <table>
            <thead><tr><th>Date</th><th>Subscription</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {data.upcoming.map((u, i) => <tr key={i}><td>{day(u.due_date)}</td><td>{u.display_name}</td><td className="num">{money(u.amount)}</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="box">
          <h2>Monthly spending</h2>
          <table>
            <thead><tr><th>Month</th><th className="num">Transactions</th><th className="num">Total</th></tr></thead>
            <tbody>
              {data.monthly.map((m) => <tr key={m.month}><td>{m.month.slice(0, 7)}</td><td className="num">{m.txn_count}</td><td className="num">{money(m.total_spend)}</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="box">
          <h2>Spending by category (last 3 months)</h2>
          <table>
            <thead><tr><th>Category</th><th className="num">Total</th></tr></thead>
            <tbody>
              {data.categories.map((c) => <tr key={c.category}><td>{c.category}</td><td className="num">{money(c.total)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
