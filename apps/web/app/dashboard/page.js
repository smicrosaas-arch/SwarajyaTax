'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || '';

function useApi(url) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const token = localStorage.getItem('token');
        fetch(`${API}${url}`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.json()).then(setData).catch(() => { }).finally(() => setLoading(false));
    }, [url]);
    return { data, loading };
}

export default function DashboardPage() {
    const { data: stats, loading: statsLoading } = useApi('/api/dashboard/stats');
    const { data: upcoming } = useApi('/api/dashboard/upcoming');
    const { data: taskStats } = useApi('/api/tasks/stats');

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>Dashboard</h1>
                    <p>Overview of your compliance operations</p>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid-4" style={{ marginBottom: '32px' }}>
                {[
                    { label: 'Total Clients', value: stats?.totalClients ?? '—', icon: '⬡' },
                    { label: 'GSTINs Managed', value: stats?.totalGstins ?? '—', icon: '⟐' },
                    { label: 'Pending Tasks', value: stats?.pendingTasks ?? '—', icon: '⊛' },
                    { label: 'Open Notices', value: stats?.pendingNotices ?? '—', icon: '◉' },
                ].map((card, i) => (
                    <div key={i} className="glass stat-card animate-in" style={{ animationDelay: `${i * 60}ms` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div className="stat-label">{card.label}</div>
                            <span style={{ fontSize: '20px', color: 'var(--accent)', opacity: 0.6 }}>{card.icon}</span>
                        </div>
                        <div className="stat-value">{statsLoading ? '...' : card.value}</div>
                    </div>
                ))}
            </div>

            {/* Secondary stats */}
            <div className="grid-2" style={{ marginBottom: '32px' }}>
                <div className="glass stat-card">
                    <div className="stat-label">Returns Uploaded</div>
                    <div className="stat-value">{stats?.totalReturns ?? '—'}</div>
                    <div className="stat-subtitle">Total GST returns in system</div>
                </div>
                <div className="glass stat-card">
                    <div className="stat-label">Unresolved Mismatches</div>
                    <div className="stat-value" style={{ color: stats?.totalMismatches > 0 ? 'var(--warning)' : 'var(--success)' }}>
                        {stats?.totalMismatches ?? '—'}
                    </div>
                    <div className="stat-subtitle">Awaiting resolution</div>
                </div>
            </div>

            <div className="grid-2">
                {/* Upcoming Tasks */}
                <div className="glass" style={{ padding: '24px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>Upcoming Tasks</h3>
                    {upcoming?.upcomingTasks?.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {upcoming.upcomingTasks.map((task, i) => (
                                <div key={i} className="glass-sm" style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontSize: '14px', fontWeight: 500 }}>{task.title}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                            {task.assignee?.name || 'Unassigned'} • Due {new Date(task.dueDate).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <span className={`badge badge-${task.priority === 'HIGH' || task.priority === 'URGENT' ? 'danger' : 'neutral'}`}>
                                        {task.priority}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-state" style={{ padding: '32px' }}>
                            <p style={{ fontSize: '14px' }}>No upcoming tasks this week</p>
                        </div>
                    )}
                </div>

                {/* Task Progress */}
                <div className="glass" style={{ padding: '24px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>Task Progress</h3>
                    {taskStats ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {[
                                { label: 'To Do', value: taskStats.todo, color: 'var(--text-muted)' },
                                { label: 'In Progress', value: taskStats.inProgress, color: 'var(--info)' },
                                { label: 'Done', value: taskStats.done, color: 'var(--success)' },
                            ].map((item, i) => (
                                <div key={i}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{item.label}</span>
                                        <span style={{ fontSize: '13px', fontWeight: 600 }}>{item.value}</span>
                                    </div>
                                    <div style={{ height: '6px', background: 'var(--bg-glass)', borderRadius: '3px', overflow: 'hidden' }}>
                                        <div style={{
                                            height: '100%',
                                            width: `${taskStats.total > 0 ? (item.value / taskStats.total) * 100 : 0}%`,
                                            background: item.color,
                                            borderRadius: '3px',
                                            transition: 'width 0.5s ease'
                                        }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-state" style={{ padding: '32px' }}>
                            <p style={{ fontSize: '14px' }}>Create tasks to see progress</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
