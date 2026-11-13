'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '../../../components/ui.js';

export default function RegisterPage() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/register', { method: 'POST', body: form });
      window.location.href = '/import';
    } catch (err) { setError(err.message); }
  };

  return (
    <form className="auth box" onSubmit={submit}>
      <h1>Register</h1>
      {error && <p className="error">{error}</p>}
      <label>Full name<input required value={form.fullName} onChange={set('fullName')} /></label>
      <label>Email<input type="email" required value={form.email} onChange={set('email')} /></label>
      <label>Password (8+ characters, a letter and a number)<input type="password" required value={form.password} onChange={set('password')} /></label>
      <button>Create account</button>
      <p>Already registered? <Link href="/login">Log in</Link></p>
    </form>
  );
}
