'use client';
import { useState } from 'react';
import { useApp } from '../../../components/AppShell.js';
import { api, useApi, Message } from '../../../components/ui.js';

function ShareForm({ account, onDone, setMsg }) {
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState('read_only');
  const share = async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/api/accounts/${account.account_id}/members`, { method: 'POST', body: { email, accessLevel: level } });
      setMsg({ ok: true, text: `Shared ${account.name} with ${r.name}.` });
      setEmail(''); onDone();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };
  return (
    <form onSubmit={share}>
      <input type="email" required placeholder="Email of family member" value={email} onChange={(e) => setEmail(e.target.value)} />
      <select value={level} onChange={(e) => setLevel(e.target.value)}>
        <option value="read_only">Read-only</option><option value="contributor">Contributor</option>
      </select>
      <button>Share</button>
    </form>
  );
}

export default function HouseholdPage() {
  const { refresh } = useApp();
  const { data, reload } = useApi('/api/accounts');
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({ name: '', bankName: '' });
  const done = () => { reload(); refresh(); };

  const create = async (e) => {
    e.preventDefault();
    try { await api('/api/accounts', { method: 'POST', body: form }); setForm({ name: '', bankName: '' }); setMsg({ ok: true, text: 'Account created.' }); done(); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
  };
  const removeMember = async (a, m) => {
    try { await api(`/api/accounts/${a.account_id}/members?user=${m.user_id}`, { method: 'DELETE' }); done(); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  const own = data?.filter((a) => a.access_level === 'owner') || [];
  const shared = data?.filter((a) => a.access_level !== 'owner') || [];

  return (
    <>
      <h1>Household</h1>
      <Message msg={msg} />
      <div className="box">
        <h2>My accounts</h2>
        {own.map((a) => (
          <div key={a.account_id} style={{ borderBottom: '1px solid #ddd', padding: '8px 0' }}>
            <b>{a.name}</b> {a.bank_name && `(${a.bank_name})`} - {a.txn_count} transactions
            <ul>
              {(a.members || []).map((m) => (
                <li key={m.user_id}>{m.name} ({m.email}) - {m.access_level} <button onClick={() => removeMember(a, m)}>Remove</button></li>
              ))}
            </ul>
            <ShareForm account={a} onDone={done} setMsg={setMsg} />
          </div>
        ))}
        <h2 style={{ marginTop: 14 }}>Add an account</h2>
        <form onSubmit={create}>
          <input required placeholder="Account name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="Bank" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
          <button>Add</button>
        </form>
      </div>
      <div className="box">
        <h2>Shared with me</h2>
        {shared.length === 0 ? <p>None.</p> : (
          <ul>{shared.map((a) => <li key={a.account_id}>{a.name} from {a.owner_name} - {a.access_level}</li>)}</ul>
        )}
      </div>
    </>
  );
}
