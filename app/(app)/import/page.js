'use client';
import { useState } from 'react';
import { useApp } from '../../../components/AppShell.js';
import { api, useApi, Message } from '../../../components/ui.js';

export default function ImportPage() {
  const { accountId, account, canWrite } = useApp();
  const { data, reload } = useApi(accountId ? `/api/import?account=${accountId}` : null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api(`/api/import?account=${accountId}`, { method: 'POST', body: { filename: file.name, text: await file.text() } });
      setMsg({ ok: true, text: `Imported ${r.inserted} of ${r.total} rows (format: ${r.bank}). Skipped: ${r.credits} credits, ${r.duplicates} duplicates, ${r.invalid} invalid. Subscriptions in this account: ${r.subscriptions}.` });
      reload();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    setBusy(false);
    e.target.value = '';
  };

  return (
    <>
      <h1>Import a statement into {account?.name}</h1>
      <div className="box">
        {canWrite ? (
          <>
            <p>Choose a CSV or JSON bank statement. The bank format is detected automatically. Sample files are in the <code>sample/</code> folder.</p>
            <input type="file" accept=".csv,.json" onChange={upload} disabled={busy} />
            {busy && <p>Importing...</p>}
          </>
        ) : <p className="error">You have read-only access to this account, so you cannot import into it.</p>}
        <Message msg={msg} />
      </div>
      <div className="box">
        <h2>Import history</h2>
        <table>
          <thead><tr><th>Date</th><th>File</th><th>Format</th><th className="num">Rows</th><th className="num">Inserted</th><th className="num">Skipped</th></tr></thead>
          <tbody>{data?.imports.map((i) => (
            <tr key={i.import_id}><td>{String(i.imported_at).slice(0, 16).replace('T', ' ')}</td><td>{i.filename}</td><td>{i.bank_profile}</td>
              <td className="num">{i.rows_total}</td><td className="num">{i.rows_inserted}</td><td className="num">{i.rows_skipped}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="box">
        <h2>Raw files stored in MongoDB (aggregation by format)</h2>
        <table>
          <thead><tr><th>Format</th><th className="num">Files</th><th className="num">Rows</th><th className="num">Inserted</th></tr></thead>
          <tbody>{data?.summary.map((s) => (
            <tr key={s._id}><td>{s._id}</td><td className="num">{s.files}</td><td className="num">{s.rows}</td><td className="num">{s.inserted}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
