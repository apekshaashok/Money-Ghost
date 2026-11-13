'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from './ui.js';

const Ctx = createContext(null);
/** { me, accounts, accountId, account, canWrite, setAccountId, refresh } */
export const useApp = () => useContext(Ctx);

const LINKS = [
  ['/dashboard', 'Dashboard'], ['/subscriptions', 'Subscriptions'], ['/transactions', 'Transactions'],
  ['/search', 'Search'], ['/import', 'Import'], ['/household', 'Household'], ['/budgets', 'Budgets'],
];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const [me, setMe] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(null);

  const refresh = useCallback(async () => {
    const d = await api('/api/auth/me');
    setMe(d.user);
    setAccounts(d.accounts);
    setAccountId((cur) => (d.accounts.some((a) => a.account_id === cur) ? cur : d.accounts[0]?.account_id ?? null));
  }, []);
  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  const account = accounts.find((a) => a.account_id === accountId) || null;
  const canWrite = account?.access_level === 'owner' || account?.access_level === 'contributor';

  return (
    <Ctx.Provider value={{ me, accounts, accountId, account, canWrite, setAccountId, refresh }}>
      <div className="nav">
        <span className="title">Money Ghosts</span>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className={pathname.startsWith(href) ? 'active' : ''}>{label}</Link>
        ))}
        <span className="right">
          Account:
          <select value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.name}{a.access_level !== 'owner' ? ` (${a.owner_name}, ${a.access_level})` : ''}
              </option>
            ))}
          </select>
          {me?.name}
          <button onClick={logout}>Log out</button>
        </span>
      </div>
      <div className="page">{me ? children : <p>Loading...</p>}</div>
    </Ctx.Provider>
  );
}
