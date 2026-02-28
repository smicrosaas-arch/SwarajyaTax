'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || '';
function authHeaders() { return { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' }; }

const PRIORITY_COLORS = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', URGENT: 'danger' };
const STATUS_COLORS = { TODO: 'neutral', IN_PROGRESS: 'info', REVIEW: 'warning', DONE: 'success' };

export default function TasksPage() {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [filter, setFilter] = useState('');
    const [form, setForm] = useState({ title: '', description: '', priority: 'MEDIUM', dueDate: '' });

    const fetchTasks = async () => {
        try {
            const url = filter ? `/api/tasks?status=${filter}` : '/api/tasks';
            const res = await fetch(`${API}${url}`, { headers: authHeaders() });
            const data = await res.json();
            setTasks(data.tasks || []);
        } catch { } finally { setLoading(false); }
    };

    useEffect(() => { fetchTasks(); }, [filter]);

    const handleCreate = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`${API}/api/tasks`, {
                method: 'POST', headers: authHeaders(), body: JSON.stringify(form)
            });
            if (!res.ok) { const d = await res.json(); alert(d.error); return; }
            setShowModal(false);
            setForm({ title: '', description: '', priority: 'MEDIUM', dueDate: '' });
            fetchTasks();
        } catch (err) { alert(err.message); }
    };

    const updateStatus = async (id, status) => {
        await fetch(`${API}/api/tasks/${id}`, {
            method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status })
        });
        fetchTasks();
    };

    const statusFlow = { TODO: 'IN_PROGRESS', IN_PROGRESS: 'REVIEW', REVIEW: 'DONE' };
    const statusLabels = { TODO: 'To Do', IN_PROGRESS: 'In Progress', REVIEW: 'In Review', DONE: 'Done' };

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>Tasks</h1>
                    <p>Assign and track compliance tasks</p>
                </div>
                <div className="flex gap-sm">
                    <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '160px' }}>
                        <option value="">All Status</option>
                        <option value="TODO">To Do</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="REVIEW">In Review</option>
                        <option value="DONE">Done</option>
                    </select>
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Create Task</button>
                </div>
            </div>

            {tasks.length === 0 ? (
                <div className="glass empty-state">
                    <div className="empty-icon">⊛</div>
                    <h3>No tasks</h3>
                    <p>{filter ? 'No tasks with this status' : 'Create your first compliance task'}</p>
                    <button className="btn btn-primary mt-md" onClick={() => setShowModal(true)}>+ Create Task</button>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {tasks.map((task) => (
                        <div key={task.id} className="glass" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                                    <span style={{ fontWeight: 500, fontSize: '15px' }}>{task.title}</span>
                                    <span className={`badge badge-${PRIORITY_COLORS[task.priority]}`}>{task.priority}</span>
                                    <span className={`badge badge-${STATUS_COLORS[task.status]}`}>{statusLabels[task.status]}</span>
                                </div>
                                <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', gap: '16px' }}>
                                    {task.description && <span>{task.description}</span>}
                                    <span>Assigned: {task.assignee?.name || 'Unassigned'}</span>
                                    {task.dueDate && <span>Due: {new Date(task.dueDate).toLocaleDateString()}</span>}
                                    <span>By: {task.creator?.name}</span>
                                </div>
                            </div>
                            <div className="flex gap-sm">
                                {statusFlow[task.status] && (
                                    <button className="btn btn-sm btn-primary" onClick={() => updateStatus(task.id, statusFlow[task.status])}>
                                        → {statusLabels[statusFlow[task.status]]}
                                    </button>
                                )}
                                {task.status === 'DONE' && <span className="badge badge-success">✓ Complete</span>}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="glass modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Create Task</h2>
                        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div className="input-group">
                                <label>Title *</label>
                                <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="File GSTR-3B for Dec 2025" />
                            </div>
                            <div className="input-group">
                                <label>Description</label>
                                <textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Task details..." />
                            </div>
                            <div className="grid-2">
                                <div className="input-group">
                                    <label>Priority</label>
                                    <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                                        <option value="LOW">Low</option>
                                        <option value="MEDIUM">Medium</option>
                                        <option value="HIGH">High</option>
                                        <option value="URGENT">Urgent</option>
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label>Due Date</label>
                                    <input className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                                </div>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Create Task</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
