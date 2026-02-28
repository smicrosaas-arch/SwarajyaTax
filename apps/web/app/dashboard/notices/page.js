'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || '';
function authHeaders() { return { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' }; }

const STATUS_COLORS = { PENDING: 'warning', IN_PROGRESS: 'info', RESPONDED: 'success', CLOSED: 'neutral' };
const TYPE_LABELS = { DEMAND: 'Demand', SCRUTINY: 'Scrutiny', ASSESSMENT: 'Assessment', OTHER: 'Other' };

export default function NoticesPage() {
    const [notices, setNotices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [filter, setFilter] = useState('');
    const [form, setForm] = useState({ title: '', description: '', noticeType: 'DEMAND', dueDate: '' });

    const fetchNotices = async () => {
        try {
            const url = filter ? `/api/notices?status=${filter}` : '/api/notices';
            const res = await fetch(`${API}${url}`, { headers: authHeaders() });
            const data = await res.json();
            setNotices(data.notices || []);
        } catch { } finally { setLoading(false); }
    };

    useEffect(() => { fetchNotices(); }, [filter]);

    const handleCreate = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`${API}/api/notices`, {
                method: 'POST', headers: authHeaders(), body: JSON.stringify(form)
            });
            if (!res.ok) { const d = await res.json(); alert(d.error); return; }
            setShowModal(false);
            setForm({ title: '', description: '', noticeType: 'DEMAND', dueDate: '' });
            fetchNotices();
        } catch (err) { alert(err.message); }
    };

    const updateStatus = async (id, status) => {
        await fetch(`${API}/api/notices/${id}`, {
            method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status })
        });
        fetchNotices();
    };

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>Notices</h1>
                    <p>Track GST demands, scrutiny, and assessments</p>
                </div>
                <div className="flex gap-sm">
                    <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '160px' }}>
                        <option value="">All Statuses</option>
                        <option value="PENDING">Pending</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="RESPONDED">Responded</option>
                        <option value="CLOSED">Closed</option>
                    </select>
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Notice</button>
                </div>
            </div>

            {notices.length === 0 ? (
                <div className="glass empty-state">
                    <div className="empty-icon">◉</div>
                    <h3>No notices</h3>
                    <p>{filter ? 'No notices with this status' : 'Track your first notice'}</p>
                </div>
            ) : (
                <div className="glass table-wrapper">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Title</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th>Client</th>
                                <th>Due Date</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {notices.map((notice) => (
                                <tr key={notice.id}>
                                    <td>
                                        <div style={{ fontWeight: 500 }}>{notice.title}</div>
                                        {notice.description && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{notice.description}</div>}
                                    </td>
                                    <td><span className="badge badge-neutral">{TYPE_LABELS[notice.noticeType] || notice.noticeType}</span></td>
                                    <td><span className={`badge badge-${STATUS_COLORS[notice.status] || 'neutral'}`}>{notice.status}</span></td>
                                    <td style={{ color: 'var(--text-secondary)' }}>{notice.client?.name || '—'}</td>
                                    <td style={{ color: notice.dueDate && new Date(notice.dueDate) < new Date() ? 'var(--danger)' : 'var(--text-secondary)', fontSize: '13px' }}>
                                        {notice.dueDate ? new Date(notice.dueDate).toLocaleDateString() : '—'}
                                    </td>
                                    <td>
                                        <div className="flex gap-sm">
                                            {notice.status === 'PENDING' && (
                                                <button className="btn btn-sm" onClick={() => updateStatus(notice.id, 'IN_PROGRESS')}>Start</button>
                                            )}
                                            {notice.status === 'IN_PROGRESS' && (
                                                <button className="btn btn-sm btn-primary" onClick={() => updateStatus(notice.id, 'RESPONDED')}>Respond</button>
                                            )}
                                            {notice.status !== 'CLOSED' && (
                                                <button className="btn btn-sm" onClick={() => updateStatus(notice.id, 'CLOSED')}>Close</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="glass modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Add Notice</h2>
                        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div className="input-group">
                                <label>Title *</label>
                                <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Demand notice for FY 2024-25" />
                            </div>
                            <div className="grid-2">
                                <div className="input-group">
                                    <label>Type</label>
                                    <select className="input" value={form.noticeType} onChange={(e) => setForm({ ...form, noticeType: e.target.value })}>
                                        <option value="DEMAND">Demand</option>
                                        <option value="SCRUTINY">Scrutiny</option>
                                        <option value="ASSESSMENT">Assessment</option>
                                        <option value="OTHER">Other</option>
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label>Due Date</label>
                                    <input className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                                </div>
                            </div>
                            <div className="input-group">
                                <label>Description</label>
                                <textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Details about the notice..." />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Add Notice</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
