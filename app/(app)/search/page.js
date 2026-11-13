'use client';
import { useState } from 'react';
import { api, money, day } from '../../../components/ui.js';

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('meaning');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const search = async (e) => {
    e.preventDefault();
    try { setResult({ mode, ...(await api('/api/search', { method: 'POST', body: { q, mode } })) }); setError(''); }
    catch (err) { setError(err.message); }
  };

  return (
    <>
      <h1>Search transactions</h1>
      <form className="box" onSubmit={search}>
        <input style={{ width: 320 }} placeholder="e.g. video streaming, food delivery, gym" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="meaning">By meaning (vector search)</option>
          <option value="keyword">By keyword (full-text search)</option>
        </select>
        <button>Search</button>
      </form>
      {error && <p className="error">{error}</p>}
      {result && result.rows.length === 0 && <p>No results.</p>}
      {result?.mode === 'meaning' && result.rows.length > 0 && (
        <table>
          <thead><tr><th>Merchant</th><th>Account</th><th>Category</th><th className="num">Times</th><th className="num">Total</th><th className="num">Similarity</th></tr></thead>
          <tbody>{result.rows.map((r, i) => (
            <tr key={i}><td>{r.merchant_key}</td><td>{r.account}</td><td>{r.category}</td><td className="num">{r.times}</td><td className="num">{money(r.total)}</td><td className="num">{r.score}</td></tr>
          ))}</tbody>
        </table>
      )}
      {result?.mode === 'keyword' && result.rows.length > 0 && (
        <table>
          <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th className="num">Amount</th></tr></thead>
          <tbody>{result.rows.map((r, i) => (
            <tr key={i}><td>{day(r.txn_date)}</td><td><code>{r.raw_description}</code></td><td>{r.account}</td><td>{r.category}</td><td className="num">{money(r.amount)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}
