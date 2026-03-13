'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminDashboard() {
    const [stats, setStats] = useState(null);
    const [tenants, setTenants] = useState([]);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('stats');
    const router = useRouter();

    const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    const fetchAdminData = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            router.push('/login');
            return;
        }

        const headers = { 'Authorization': `Bearer ${token}` };

        try {
            const [statsRes, tenantsRes, logsRes] = await Promise.all([
                fetch(`${API}/api/admin/stats`, { headers }),
                fetch(`${API}/api/admin/tenants`, { headers }),
                fetch(`${API}/api/admin/audit-logs`, { headers })
            ]);

            if (statsRes.status === 403) {
                alert('Access Denied: You are not a system administrator.');
                router.push('/dashboard');
                return;
            }

            const statsData = await statsRes.json();
            const tenantsData = await tenantsRes.json();
            const logsData = await logsRes.json();

            setStats(statsData);
            setTenants(tenantsData.tenants || []);
            setLogs(logsData.logs || []);
        } catch (err) {
            console.error('Admin fetch error:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAdminData();
    }, []);

    if (loading) return <div className="p-xl">Loading Admin Portal...</div>;

    return (
        <div className="p-xl" style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div className="flex justify-between items-center mb-xl">
                <div>
                    <h1 className="text-2xl font-bold">Super Admin Portal</h1>
                    <p className="text-muted">Platform-wide management and analytics</p>
                </div>
                <button className="btn" onClick={() => router.push('/dashboard')}>← Back to Dashboard</button>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-4 gap-md mb-xl">
                <div className="glass p-lg text-center">
                    <div className="text-2xl font-bold">{stats?.tenants}</div>
                    <div className="text-sm text-muted">Total Tenants</div>
                </div>
                <div className="glass p-lg text-center">
                    <div className="text-2xl font-bold">{stats?.users}</div>
                    <div className="text-sm text-muted">Total Users</div>
                </div>
                <div className="glass p-lg text-center">
                    <div className="text-2xl font-bold">{stats?.syncJobs?.successRate}</div>
                    <div className="text-sm text-muted">Sync Success Rate</div>
                </div>
                <div className="glass p-lg text-center">
                    <div className="text-2xl font-bold text-success">{stats?.syncJobs?.success}</div>
                    <div className="text-sm text-muted">Successful Syncs</div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-md mb-lg border-b border-glass pb-sm">
                <button className={`btn btn-sm ${activeTab === 'stats' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('stats')}>Tenants</button>
                <button className={`btn btn-sm ${activeTab === 'logs' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('logs')}>Audit Logs</button>
            </div>

            {activeTab === 'stats' ? (
                <div className="glass overflow-hidden">
                    <table className="table w-full">
                        <thead>
                            <tr className="bg-glass-dark">
                                <th className="p-md text-left">Tenant Name</th>
                                <th className="p-md text-left">Email</th>
                                <th className="p-md text-center">Users</th>
                                <th className="p-md text-center">Clients</th>
                                <th className="p-md text-right">Created At</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tenants.map(t => (
                                <tr key={t.id} className="border-t border-glass">
                                    <td className="p-md font-bold">{t.name}</td>
                                    <td className="p-md text-muted">{t.email}</td>
                                    <td className="p-md text-center">{t._count.users}</td>
                                    <td className="p-md text-center">{t._count.clients}</td>
                                    <td className="p-md text-right text-sm">{new Date(t.createdAt).toLocaleDateString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="glass overflow-hidden">
                    <table className="table w-full">
                        <thead>
                            <tr className="bg-glass-dark">
                                <th className="p-md text-left">User</th>
                                <th className="p-md text-left">Tenant</th>
                                <th className="p-md text-left">Action</th>
                                <th className="p-md text-right">Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map(log => (
                                <tr key={log.id} className="border-t border-glass">
                                    <td className="p-md">
                                        <div className="font-bold">{log.user.name}</div>
                                        <div className="text-xs text-muted">{log.user.email}</div>
                                    </td>
                                    <td className="p-md">{log.tenant.name}</td>
                                    <td className="p-md"><code className="bg-glass px-sm rounded">{log.action}</code></td>
                                    <td className="p-md text-right text-xs">{new Date(log.createdAt).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
