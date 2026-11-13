'use client';
import { useState } from 'react';
import { useApp } from '../../../components/AppShell.js';
import { api, useApi, money, day, Message } from '../../../components/ui.js';

export default function TransactionsPage() {
  const { accountId, canWrite } = useApp();
  const [filters, setFilters] = useState({ q: '', category: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState(null);
  const cats = useApi('/api/categories');

  const params = new URLSearchParams({ account: accountId ?? '', page: String(page), ...applied });
  const { data, error, reload } = useApi(accountId ? `/api/transactions?${params}` : null);
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  const changeCategory = async (t, categoryId) => {
    try { await api(`/api/transactions/${t.txn_id}`, { method: 'PATCH', body: { categoryId: Number(categoryId) } }); reload(); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.raw_description}"?`)) return;
    try { await api(`/api/transactions/${t.txn_id}`, { method: 'DELETE' }); setMsg({ ok: true, text: 'Deleted.' }); reload(); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <h1>Transactions</h1>
      <form className="box" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(filters); }}>
        <input placeholder="Description contains" value={filters.q} onChange={set('q')} />
        <select value={filters.category} onChange={set('category')}>
          <option value="">All categories</option>
          {cats.data?.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
        </select>
        From <input type="date" value={filters.from} onChange={set('from')} />
        To <input type="date" value={filters.to} onChange={set('to')} />
        <button>Filter</button>
      </form>
      <Message msg={msg} />
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <p>
            {data.total} transactions. Page {page} of {pages}{' '}
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </p>
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Merchant</th><th>Category</th><th className="num">Amount</th>{canWrite && <th />}</tr></thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={t.txn_id}>
                  <td>{day(t.txn_date)}</td>
                  <td><code>{t.raw_description}</code></td>
                  <td>{t.merchant_key}</td>
                  <td>
                    {canWrite ? (
                      <select value={t.category_id ?? ''} onChange={(e) => changeCategory(t, e.target.value)}>
                        {cats.data?.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
                      </select>
                    ) : t.category}
                  </td>
                  <td className="num">{money(t.amount)}</td>
                  {canWrite && <td><button onClick={() => remove(t)}>Delete</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
