'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || '';

export default function RegisterPage() {
    const router = useRouter();
    const [form, setForm] = useState({ name: '', email: '', password: '', orgName: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await fetch(`${API}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Registration failed');
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
            <div style={{ position: 'fixed', bottom: '-200px', left: '-200px', width: '500px', height: '500px', background: 'rgba(90,171,245,0.04)', borderRadius: '50%', filter: 'blur(120px)', pointerEvents: 'none' }}></div>
            <div className="glass" style={{ width: '100%', maxWidth: '420px', padding: '40px' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{ fontSize: '28px', color: 'var(--accent)', marginBottom: '8px' }}>◈</div>
                    <h1 style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '-0.02em' }}>Create your account</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>Start managing GST compliance today</p>
                </div>

                {error && <div className="alert alert-error" style={{ marginBottom: '20px' }}>⚠ {error}</div>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="input-group">
                        <label>Firm / Organization Name</label>
                        <input className="input" type="text" placeholder="Sharma & Associates" required
                            value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} />
                    </div>
                    <div className="input-group">
                        <label>Your Name</label>
                        <input className="input" type="text" placeholder="Rajesh Sharma" required
                            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="input-group">
                        <label>Email</label>
                        <input className="input" type="email" placeholder="rajesh@sharma.com" required
                            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                    <div className="input-group">
                        <label>Password</label>
                        <input className="input" type="password" placeholder="Min 6 characters" required minLength={6}
                            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                    </div>
                    <button className="btn btn-primary" type="submit" disabled={loading}
                        style={{ width: '100%', marginTop: '8px', padding: '12px' }}>
                        {loading ? 'Creating account...' : 'Create Account'}
                    </button>
                </form>

                <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                    Already have an account?{' '}
                    <a href="/auth/login" style={{ color: 'var(--accent)' }}>Sign in</a>
                </p>
            </div>
        </div>
    );
}
