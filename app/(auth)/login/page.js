'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '../../../components/ui.js';

export default function LoginPage() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/login', { method: 'POST', body: form });
      window.location.href = '/dashboard';
    } catch (err) { setError(err.message); }
  };

  return (
    <form className="auth box" onSubmit={submit}>
      <h1>Money Ghosts - Log in</h1>
      {error && <p className="error">{error}</p>}
      <label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
      <label>Password<input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
      <button>Log in</button>
      <p>No account? <Link href="/register">Register</Link></p>
      <p className="muted">Demo: apeksha@moneyghosts.dev / Demo@1234</p>
    </form>
  );
}
