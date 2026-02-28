'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || '';

function getToken() { return localStorage.getItem('token'); }
function authHeaders() { return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }; }

export default function ClientsPage() {
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [search, setSearch] = useState('');
    const [form, setForm] = useState({ name: '', tradeName: '', email: '', phone: '', address: '', gstin: '' });
    const [error, setError] = useState('');

    const fetchClients = async () => {
        try {
            const url = search ? `/api/clients?search=${encodeURIComponent(search)}` : '/api/clients';
            const res = await fetch(`${API}${url}`, { headers: authHeaders() });
            const data = await res.json();
            setClients(data.clients || []);
        } catch { } finally { setLoading(false); }
    };

    useEffect(() => { fetchClients(); }, [search]);

    const handleCreate = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const res = await fetch(`${API}/api/clients`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(form) });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
            setShowModal(false);
            setForm({ name: '', tradeName: '', email: '', phone: '', address: '', gstin: '' });
            fetchClients();
        } catch (err) { setError(err.message); }
    };

    const handleDelete = async (id) => {
        if (!confirm('Remove this client?')) return;
        await fetch(`${API}/api/clients/${id}`, { method: 'DELETE', headers: authHeaders() });
        fetchClients();
    };

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>Clients</h1>
                    <p>Manage your client portfolio</p>
                </div>
                <div className="flex gap-sm">
                    <input className="input" placeholder="Search clients..." value={search}
                        onChange={(e) => setSearch(e.target.value)} style={{ width: '240px' }} />
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Client</button>
                </div>
            </div>

            {loading ? (
                <div className="empty-state"><p>Loading...</p></div>
            ) : clients.length === 0 ? (
                <div className="glass empty-state">
                    <div className="empty-icon">⬡</div>
                    <h3>No clients yet</h3>
                    <p>Add your first client to get started</p>
                    <button className="btn btn-primary mt-md" onClick={() => setShowModal(true)}>+ Add Client</button>
                </div>
            ) : (
                <div className="glass table-wrapper">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Client Name</th>
                                <th>Trade Name</th>
                                <th>Email</th>
                                <th>Phone</th>
                                <th>GSTINs</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {clients.map((client) => (
                                <tr key={client.id}>
                                    <td style={{ fontWeight: 500 }}>
                                        <a href={`/dashboard/clients?view=${client.id}`}>{client.name}</a>
                                    </td>
                                    <td style={{ color: 'var(--text-secondary)' }}>{client.tradeName || '—'}</td>
                                    <td style={{ color: 'var(--text-secondary)' }}>{client.email || '—'}</td>
                                    <td style={{ color: 'var(--text-secondary)' }}>{client.phone || '—'}</td>
                                    <td>
                                        <span className="badge badge-info">{client.gstins?.length || 0}</span>
                                    </td>
                                    <td>
                                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(client.id)}>Remove</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Add Client Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="glass modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Add New Client</h2>
                        {error && <div className="alert alert-error mb-md">⚠ {error}</div>}
                        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div className="input-group">
                                <label>Client Name *</label>
                                <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ABC Enterprises" />
                            </div>
                            <div className="input-group">
                                <label>Trade Name</label>
                                <input className="input" value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} placeholder="ABC Trading Co." />
                            </div>
                            <div className="grid-2">
                                <div className="input-group">
                                    <label>Email</label>
                                    <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="abc@example.com" />
                                </div>
                                <div className="input-group">
                                    <label>Phone</label>
                                    <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
                                </div>
                            </div>
                            <div className="input-group">
                                <label>Address</label>
                                <textarea className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Full address" />
                            </div>
                            <div className="input-group">
                                <label>Initial GSTIN (Optional)</label>
                                <input className="input" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="22AAAAA0000A1Z5" />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Add Client</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
