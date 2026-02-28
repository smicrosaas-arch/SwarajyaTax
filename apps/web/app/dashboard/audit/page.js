'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || '';
function authHeaders() { return { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' }; }

export default function AuditPage() {
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API}/api/dashboard/audit-log?page=${page}&limit=30`, { headers: authHeaders() });
            const data = await res.json();
            setLogs(data.logs || []);
            setTotal(data.total || 0);
        } catch { } finally { setLoading(false); }
    };

    useEffect(() => { fetchLogs(); }, [page]);

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>Audit Log</h1>
                    <p>Complete trail of all actions — {total} total entries</p>
                </div>
            </div>

            {logs.length === 0 ? (
                <div className="glass empty-state">
                    <div className="empty-icon">⬢</div>
                    <h3>No audit entries yet</h3>
                    <p>Actions will be recorded automatically as you use the platform</p>
                </div>
            ) : (
                <>
                    <div className="glass table-wrapper">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>User</th>
                                    <th>Action</th>
                                    <th>Entity</th>
                                    <th>Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((log) => (
                                    <tr key={log.id}>
                                        <td style={{ fontSize: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                            {new Date(log.createdAt).toLocaleString()}
                                        </td>
                                        <td>
                                            <div style={{ fontWeight: 500, fontSize: '14px' }}>{log.user?.name || '—'}</div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{log.user?.email}</div>
                                        </td>
                                        <td><span className="badge badge-neutral" style={{ fontFamily: 'monospace', fontSize: '12px' }}>{log.action}</span></td>
                                        <td style={{ color: 'var(--text-secondary)' }}>{log.entity}</td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '13px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {log.details || '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex justify-between items-center mt-lg">
                        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                            Page {page} · Showing {logs.length} of {total}
                        </span>
                        <div className="flex gap-sm">
                            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                            <button className="btn btn-sm" disabled={logs.length < 30} onClick={() => setPage(p => p + 1)}>Next →</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
