'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || '';
function authHeaders() { return { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' }; }

const SYNC_COLORS = { SYNCED: 'success', READY: 'info', NEVER_SYNCED: 'neutral', IN_PROGRESS: 'warning', DISCONNECTED: 'danger' };

export default function GSTAccountsPage() {
    const [accounts, setAccounts] = useState([]);
    const [clients, setClients] = useState([]);
    const [gstins, setGstins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showConnect, setShowConnect] = useState(false);
    const [showReports, setShowReports] = useState(null); // gstinId
    const [reports, setReports] = useState([]);
    const [syncingId, setSyncingId] = useState(null);
    const [bulkSyncing, setBulkSyncing] = useState(false);
    const [syncJobs, setSyncJobs] = useState([]);
    const [connectForm, setConnectForm] = useState({ gstinId: '', username: '', password: '' });
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    const fetchAccounts = async () => {
        try {
            const res = await fetch(`${API}/api/gst-accounts`, { headers: authHeaders() });
            const data = await res.json();
            setAccounts(data.accounts || []);
        } catch { } finally { setLoading(false); }
    };

    const fetchClients = async () => {
        try {
            const res = await fetch(`${API}/api/clients`, { headers: authHeaders() });
            const data = await res.json();
            setClients(data.clients || []);
            const all = [];
            (data.clients || []).forEach(c => (c.gstins || []).forEach(g => all.push({ ...g, clientName: c.name })));
            setGstins(all);
        } catch { }
    };

    const fetchSyncJobs = async () => {
        try {
            const res = await fetch(`${API}/api/gst-accounts/sync-jobs`, { headers: authHeaders() });
            const data = await res.json();
            setSyncJobs(data.jobs || []);
        } catch { }
    };

    useEffect(() => { fetchAccounts(); fetchClients(); fetchSyncJobs(); }, []);

    const handleConnect = async (e) => {
        e.preventDefault();
        setError(''); setSuccessMsg('');
        try {
            const res = await fetch(`${API}/api/gst-accounts/connect`, {
                method: 'POST', headers: authHeaders(), body: JSON.stringify(connectForm)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setShowConnect(false);
            setConnectForm({ gstinId: '', username: '', password: '' });
            setSuccessMsg('GST account connected successfully!');
            fetchAccounts();
        } catch (err) { setError(err.message); }
    };

    const handleSync = async (accountId) => {
        setSyncingId(accountId); setSuccessMsg('');
        try {
            const res = await fetch(`${API}/api/gst-accounts/${accountId}/sync`, {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({ reportTypes: ['GSTR1', 'GSTR2A', 'GSTR2B', 'GSTR3B'] })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setSuccessMsg(`Downloaded ${data.downloadedReturns.length} reports — ${data.downloadedReturns.map(r => r.returnType).join(', ')}`);
            fetchAccounts(); fetchSyncJobs();
        } catch (err) { setError(err.message); }
        finally { setSyncingId(null); }
    };

    const handleBulkSync = async () => {
        setBulkSyncing(true); setSuccessMsg(''); setError('');
        try {
            const res = await fetch(`${API}/api/gst-accounts/sync-all`, {
                method: 'POST', headers: authHeaders(), body: JSON.stringify({})
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setSuccessMsg(`Synced ${data.totalAccounts} accounts — ${data.results.map(r => `${r.clientName}: ${r.reportsDownloaded} reports`).join(', ')}`);
            fetchAccounts(); fetchSyncJobs();
        } catch (err) { setError(err.message); }
        finally { setBulkSyncing(false); }
    };

    const handleDisconnect = async (id) => {
        if (!confirm('Disconnect this GST account?')) return;
        await fetch(`${API}/api/gst-accounts/${id}`, { method: 'DELETE', headers: authHeaders() });
        fetchAccounts();
    };

    const viewReports = async (gstinId) => {
        setShowReports(gstinId);
        try {
            const res = await fetch(`${API}/api/gst-accounts/reports/${gstinId}`, { headers: authHeaders() });
            const data = await res.json();
            setReports(data.reports || []);
        } catch { setReports([]); }
    };

    const downloadReport = (returnId) => {
        const token = localStorage.getItem('token');
        window.open(`${API}/api/gst-accounts/reports/download/${returnId}?token=${token}`, '_blank');
    };

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>GST Accounts</h1>
                    <p>Connect GSTINs to auto-download returns, notices & reports from the GST portal</p>
                </div>
                <div className="flex gap-sm">
                    {accounts.length > 0 && (
                        <button className="btn" onClick={handleBulkSync} disabled={bulkSyncing}>
                            {bulkSyncing ? '⟳ Syncing All...' : '⟳ Sync All Accounts'}
                        </button>
                    )}
                    <button className="btn btn-primary" onClick={() => setShowConnect(true)}>+ Connect GSTIN</button>
                </div>
            </div>

            {successMsg && <div className="alert alert-success mb-lg">✓ {successMsg}</div>}
            {error && !showConnect && <div className="alert alert-error mb-lg">⚠ {error}</div>}

            {/* Connected Accounts */}
            {loading ? (
                <div className="empty-state"><p>Loading...</p></div>
            ) : accounts.length === 0 ? (
                <div className="glass empty-state">
                    <div className="empty-icon">⟁</div>
                    <h3>No GST accounts connected</h3>
                    <p>Connect a GSTIN to start auto-downloading GST returns and reports from the portal</p>
                    <button className="btn btn-primary mt-md" onClick={() => setShowConnect(true)}>+ Connect GSTIN</button>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
                    {accounts.map((acct) => (
                        <div key={acct.id} className="glass" style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 600, letterSpacing: '0.03em' }}>
                                        {acct.gstin?.gstin}
                                    </span>
                                    <span className={`badge badge-${SYNC_COLORS[acct.syncStatus]}`}>{acct.syncStatus.replace('_', ' ')}</span>
                                    {acct.isConnected && <span className="badge badge-success">● Connected</span>}
                                </div>
                                <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                    <span>Client: <strong style={{ color: 'var(--text-secondary)' }}>{acct.gstin?.client?.name}</strong></span>
                                    <span>Username: {acct.username}</span>
                                    {acct.lastSyncAt && <span>Last Sync: {new Date(acct.lastSyncAt).toLocaleString()}</span>}
                                    <span>Sync Jobs: {acct._count?.syncJobs || 0}</span>
                                </div>
                            </div>
                            <div className="flex gap-sm">
                                <button className="btn btn-sm" onClick={() => viewReports(acct.gstin.id)}>📋 Reports</button>
                                <button className="btn btn-sm btn-primary" onClick={() => handleSync(acct.id)} disabled={syncingId === acct.id}>
                                    {syncingId === acct.id ? '⟳ Downloading...' : '⟳ Sync Now'}
                                </button>
                                <button className="btn btn-sm btn-danger" onClick={() => handleDisconnect(acct.id)}>Disconnect</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Reports Viewer */}
            {showReports && (
                <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Downloaded Reports</h3>
                        <button className="btn btn-sm" onClick={() => setShowReports(null)}>✕ Close</button>
                    </div>
                    {reports.length === 0 ? (
                        <div className="empty-state" style={{ padding: '24px' }}>
                            <p>No reports downloaded yet. Click "Sync Now" to fetch data from the GST portal.</p>
                        </div>
                    ) : (
                        <div className="table-wrapper">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Return Type</th>
                                        <th>Period</th>
                                        <th>Invoices</th>
                                        <th>Taxable Value</th>
                                        <th>IGST</th>
                                        <th>CGST</th>
                                        <th>SGST</th>
                                        <th>Downloaded</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reports.map((r) => (
                                        <tr key={r.id}>
                                            <td><span className="badge badge-info">{r.returnType}</span></td>
                                            <td style={{ fontWeight: 500 }}>{r.period}</td>
                                            <td>{r.invoiceCount}</td>
                                            <td style={{ fontFamily: 'monospace' }}>₹{r.summary?.totalTaxableValue?.toLocaleString() || '—'}</td>
                                            <td style={{ fontFamily: 'monospace' }}>₹{r.summary?.totalIGST?.toLocaleString() || '—'}</td>
                                            <td style={{ fontFamily: 'monospace' }}>₹{r.summary?.totalCGST?.toLocaleString() || '—'}</td>
                                            <td style={{ fontFamily: 'monospace' }}>₹{r.summary?.totalSGST?.toLocaleString() || '—'}</td>
                                            <td style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{new Date(r.uploadedAt).toLocaleString()}</td>
                                            <td>
                                                <button className="btn btn-sm" onClick={() => downloadReport(r.id)}>⬇ Download JSON</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Sync History */}
            {syncJobs.length > 0 && (
                <div className="glass" style={{ padding: '20px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '14px' }}>Sync History</h3>
                    <div className="table-wrapper">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>GSTIN</th>
                                    <th>Type</th>
                                    <th>Reports</th>
                                    <th>Status</th>
                                    <th>Period</th>
                                    <th>Started</th>
                                    <th>Completed</th>
                                </tr>
                            </thead>
                            <tbody>
                                {syncJobs.slice(0, 20).map((job) => {
                                    let reportList = [];
                                    try { reportList = JSON.parse(job.reportTypes); } catch { }
                                    return (
                                        <tr key={job.id}>
                                            <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>{job.account?.gstin?.gstin || '—'}</td>
                                            <td><span className="badge badge-neutral">{job.jobType}</span></td>
                                            <td style={{ fontSize: '13px' }}>{reportList.join(', ')}</td>
                                            <td><span className={`badge badge-${job.status === 'COMPLETED' ? 'success' : job.status === 'FAILED' ? 'danger' : 'warning'}`}>{job.status}</span></td>
                                            <td>{job.period || '—'}</td>
                                            <td style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}</td>
                                            <td style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{job.completedAt ? new Date(job.completedAt).toLocaleString() : '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Connect GSTIN Modal */}
            {showConnect && (
                <div className="modal-overlay" onClick={() => setShowConnect(false)}>
                    <div className="glass modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Connect GST Account</h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
                            Enter the GST portal credentials for a GSTIN. We'll use these to auto-download returns, reports, and notices.
                        </p>
                        {error && showConnect && <div className="alert alert-error mb-md">⚠ {error}</div>}
                        <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div className="input-group">
                                <label>Select GSTIN</label>
                                <select className="input" required value={connectForm.gstinId}
                                    onChange={(e) => setConnectForm({ ...connectForm, gstinId: e.target.value })}>
                                    <option value="">Choose a GSTIN to connect...</option>
                                    {gstins.map(g => (
                                        <option key={g.id} value={g.id}>{g.gstin} — {g.clientName}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="input-group">
                                <label>GST Portal Username</label>
                                <input className="input" required value={connectForm.username}
                                    onChange={(e) => setConnectForm({ ...connectForm, username: e.target.value })}
                                    placeholder="Your GST portal username" />
                            </div>
                            <div className="input-group">
                                <label>GST Portal Password</label>
                                <input className="input" type="password" required value={connectForm.password}
                                    onChange={(e) => setConnectForm({ ...connectForm, password: e.target.value })}
                                    placeholder="••••••••" />
                            </div>
                            <div className="glass-sm" style={{ padding: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>
                                🔒 Credentials are used to authenticate with the GST portal and fetch your data. They are transmitted securely.
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn" onClick={() => setShowConnect(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Connect & Verify</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
