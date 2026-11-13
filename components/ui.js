'use client';
import { useCallback, useEffect, useState } from 'react';

/** fetch wrapper: JSON in/out, throws Error(message) for non-2xx responses */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.location.href = '/login';
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Load data from an API path; path = null skips loading. */
export function useApi(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api(path)); setError(null); } catch (e) { setError(e.message); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load };
}

export const money = (v) => (v === null || v === undefined ? '-' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
export const day = (d) => (d ? String(d).slice(0, 10) : '-');

/** Shows a success or error message. msg = { ok: true/false, text } */
export function Message({ msg }) {
  if (!msg) return null;
  return <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>;
}
