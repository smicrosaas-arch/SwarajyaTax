'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || '';

export default function LoginPage() {
    const router = useRouter();
    const [form, setForm] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await fetch(`${API}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Login failed');
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            router.push('/dashboard');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', position: 'relative' }}>
            <div style={{ position: 'fixed', top: '-200px', right: '-200px', width: '500px', height: '500px', background: 'rgba(124,124,245,0.05)', borderRadius: '50%', filter: 'blur(100px)', pointerEvents: 'none' }}></div>
            <div className="glass" style={{ width: '100%', maxWidth: '420px', padding: '40px' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{ fontSize: '28px', color: 'var(--accent)', marginBottom: '8px' }}>◈</div>
                    <h1 style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '-0.02em' }}>Welcome back</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>Sign in to Swarajaya TaxCompute</p>
                </div>

                {error && <div className="alert alert-error" style={{ marginBottom: '20px' }}>⚠ {error}</div>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="input-group">
                        <label>Email</label>
                        <input className="input" type="email" placeholder="you@firm.com" required
                            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                    <div className="input-group">
                        <label>Password</label>
                        <input className="input" type="password" placeholder="••••••••" required
                            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                    </div>
                    <button className="btn btn-primary" type="submit" disabled={loading}
                        style={{ width: '100%', marginTop: '8px', padding: '12px' }}>
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                    New to Swarajaya TaxCompute?{' '}
                    <a href="/auth/register" style={{ color: 'var(--accent)' }}>Create an account</a>
                </p>
            </div>
        </div>
    );
}
