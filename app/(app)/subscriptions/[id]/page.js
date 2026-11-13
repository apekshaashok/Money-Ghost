'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, useApi, money, day, Message } from '../../../../components/ui.js';

export default function SubscriptionDetail({ params }) {
  const { data, error, reload } = useApi(`/api/subscriptions/${params.id}`);
  const [shares, setShares] = useState({});
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!data) return;
    const s = {};
    data.split.forEach((x) => { s[x.user_id] = x.share_percent; });
    setShares(s);
  }, [data]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading...</p>;
  const s = data.subscription;
  const canWrite = data.level !== 'read_only';

  const saveSplit = async () => {
    try {
      const list = Object.entries(shares).filter(([, v]) => Number(v) > 0).map(([userId, v]) => ({ userId: Number(userId), percent: Number(v) }));
      await api(`/api/subscriptions/${params.id}/split`, { method: 'PUT', body: { shares: list } });
      setMsg({ ok: true, text: 'Split saved.' });
      reload();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  };

  return (
    <>
      <p><Link href="/subscriptions">&larr; Back</Link></p>
      <h1>{s.display_name}</h1>
      <div className="box">
        {s.category} | {s.cadence} | {money(s.current_amount)} | status: {s.status} | {s.charge_count} charges from {day(s.first_charge)} to {day(s.last_charge)}
      </div>

      <div className="row">
        <div className="box">
          <h2>Price history</h2>
          {data.prices.length === 0 ? <p>No price changes.</p> : (
            <table>
              <thead><tr><th>Date</th><th className="num">Old</th><th className="num">New</th><th className="num">Change</th></tr></thead>
              <tbody>{data.prices.map((p) => (
                <tr key={p.effective_date}><td>{day(p.effective_date)}</td><td className="num">{money(p.old_amount)}</td><td className="num">{money(p.new_amount)}</td><td className="num">{p.pct_change}%</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>

        <div className="box">
          <h2>Split the cost</h2>
          <table>
            <thead><tr><th>Person</th><th>Access</th><th>Share %</th></tr></thead>
            <tbody>{data.people.map((p) => (
              <tr key={p.user_id}>
                <td>{p.full_name}</td><td>{p.access_level}</td>
                <td><input type="number" style={{ width: 70 }} disabled={!canWrite} value={shares[p.user_id] ?? ''}
                  onChange={(e) => setShares({ ...shares, [p.user_id]: e.target.value })} /></td>
              </tr>
            ))}</tbody>
          </table>
          {canWrite && <button onClick={saveSplit}>Save split</button>}
          <Message msg={msg} />
        </div>
      </div>

      <div className="box">
        <h2>All charges</h2>
        <table>
          <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th className="num">Days since previous</th></tr></thead>
          <tbody>{data.charges.map((c) => (
            <tr key={c.txn_id}><td>{day(c.txn_date)}</td><td><code>{c.raw_description}</code></td><td className="num">{money(c.amount)}</td><td className="num">{c.days_since_previous ?? '-'}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
