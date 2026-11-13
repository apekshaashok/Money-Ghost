'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApp } from '../../../components/AppShell.js';
import { useApi, money, day } from '../../../components/ui.js';

export default function SubscriptionsPage() {
  const { accountId } = useApp();
  const [status, setStatus] = useState('');
  const { data, error } = useApi(accountId ? `/api/subscriptions?account=${accountId}&status=${status}` : null);

  return (
    <>
      <h1>Subscriptions</h1>
      <p>
        Show:{' '}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option><option value="active">Active</option><option value="dormant">Dormant</option>
        </select>
        {data?.totals && <> &nbsp; Total: {money(data.totals.monthly_total)} per month</>}
      </p>
      {error && <p className="error">{error}</p>}
      {data && (
        <table>
          <thead>
            <tr><th>Name</th><th>Category</th><th>How often</th><th className="num">Amount</th><th className="num">Per month</th><th>Last charge</th><th>Status</th></tr>
          </thead>
          <tbody>
            {data.subscriptions.map((s) => (
              <tr key={s.sub_id}>
                <td><Link href={`/subscriptions/${s.sub_id}`}>{s.display_name}</Link></td>
                <td>{s.category}</td>
                <td>{s.cadence}</td>
                <td className="num">{money(s.current_amount)}{s.price_alert && <span className="error"> (was {money(s.previous_amount)})</span>}</td>
                <td className="num">{money(s.monthly_equivalent)}</td>
                <td>{day(s.last_charge)}</td>
                <td>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.subscriptions.length === 0 && <p>No subscriptions found. Import a statement first.</p>}
    </>
  );
}
