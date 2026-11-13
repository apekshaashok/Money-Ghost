'use client';
import { useState } from 'react';
import { api, useApi, money, Message } from '../../../components/ui.js';

export default function BudgetsPage() {
  const { data, reload } = useApi('/api/budgets');
  const cats = useApi('/api/categories');
  const [form, setForm] = useState({ categoryId: '', monthlyLimit: '' });
  const [msg, setMsg] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/budgets', { method: 'POST', body: { categoryId: Number(form.categoryId), monthlyLimit: Number(form.monthlyLimit) } });
      setForm({ categoryId: '', monthlyLimit: '' }); setMsg({ ok: true, text: 'Budget added.' }); reload();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };
  const remove = async (b) => {
    try { await api(`/api/budgets/${b.budget_id}`, { method: 'DELETE' }); reload(); } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  return (
    <>
      <h1>Budgets (this month)</h1>
      <form className="box" onSubmit={add}>
        <select required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
          <option value="">Category</option>
          {cats.data?.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
        </select>
        <input type="number" required placeholder="Monthly limit" value={form.monthlyLimit} onChange={(e) => setForm({ ...form, monthlyLimit: e.target.value })} />
        <button>Add budget</button>
        <Message msg={msg} />
      </form>
      <table>
        <thead><tr><th>Category</th><th className="num">Limit</th><th className="num">Spent</th><th className="num">Used</th><th>Status</th><th /></tr></thead>
        <tbody>{data?.map((b) => (
          <tr key={b.budget_id}>
            <td>{b.category}</td><td className="num">{money(b.monthly_limit)}</td><td className="num">{money(b.spent_this_month)}</td>
            <td className="num">{b.pct_used}%</td><td className={b.state === 'over' ? 'error' : 'ok'}>{b.state === 'over' ? 'Over budget' : 'OK'}</td>
            <td><button onClick={() => remove(b)}>Delete</button></td>
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}
