'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || '';
function authHeaders() { return { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' }; }

export default function ReconciliationPage() {
    const [returns, setReturns] = useState([]);
    const [mismatches, setMismatches] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showUpload, setShowUpload] = useState(false);
    const [reconcileIds, setReconcileIds] = useState({ id1: '', id2: '' });
    const [reconcileResult, setReconcileResult] = useState(null);
    const [uploadForm, setUploadForm] = useState({ returnType: 'GSTR1', period: '', gstinId: '', data: '' });
    const [gstins, setGstins] = useState([]);
    const [clients, setClients] = useState([]);

    const fetchReturns = async () => {
        try {
            const res = await fetch(`${API}/api/returns`, { headers: authHeaders() });
            const data = await res.json();
            setReturns(data.returns || []);
        } catch { } finally { setLoading(false); }
    };

    const fetchClients = async () => {
        try {
            const res = await fetch(`${API}/api/clients`, { headers: authHeaders() });
            const data = await res.json();
            setClients(data.clients || []);
            const allGstins = [];
            (data.clients || []).forEach(c => (c.gstins || []).forEach(g => allGstins.push({ ...g, clientName: c.name })));
            setGstins(allGstins);
        } catch { }
    };

    useEffect(() => { fetchReturns(); fetchClients(); }, []);

    const handleUpload = async (e) => {
        e.preventDefault();
        try {
            let parsedData;
            try { parsedData = JSON.parse(uploadForm.data); } catch { alert('Invalid JSON data'); return; }
            const res = await fetch(`${API}/api/returns/upload`, {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({ ...uploadForm, data: parsedData })
            });
            if (!res.ok) { const d = await res.json(); alert(d.error); return; }
            setShowUpload(false);
            setUploadForm({ returnType: 'GSTR1', period: '', gstinId: '', data: '' });
            fetchReturns();
        } catch (err) { alert(err.message); }
    };

    const handleReconcile = async () => {
        if (!reconcileIds.id1 || !reconcileIds.id2) { alert('Select two returns to compare'); return; }
        try {
            const res = await fetch(`${API}/api/returns/reconcile`, {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({ returnId1: reconcileIds.id1, returnId2: reconcileIds.id2 })
            });
            const data = await res.json();
            setReconcileResult(data);
        } catch (err) { alert(err.message); }
    };

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>Reconciliation</h1>
                    <p>Upload returns and detect mismatches</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowUpload(true)}>+ Upload Return</button>
            </div>

            {/* Reconcile Controls */}
            <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '14px' }}>Compare Returns</h3>
                <div className="flex gap-md items-center" style={{ flexWrap: 'wrap' }}>
                    <select className="input" style={{ flex: 1, minWidth: '200px' }} value={reconcileIds.id1}
                        onChange={(e) => setReconcileIds({ ...reconcileIds, id1: e.target.value })}>
                        <option value="">Select Return 1 (Filed)...</option>
                        {returns.map(r => (
                            <option key={r.id} value={r.id}>{r.returnType} — {r.period} — {r.gstin?.gstin || ''}</option>
                        ))}
                    </select>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>vs</span>
                    <select className="input" style={{ flex: 1, minWidth: '200px' }} value={reconcileIds.id2}
                        onChange={(e) => setReconcileIds({ ...reconcileIds, id2: e.target.value })}>
                        <option value="">Select Return 2 (Matched)...</option>
                        {returns.map(r => (
                            <option key={r.id} value={r.id}>{r.returnType} — {r.period} — {r.gstin?.gstin || ''}</option>
                        ))}
                    </select>
                    <button className="btn btn-primary" onClick={handleReconcile}>Run Reconciliation</button>
                </div>
            </div>

            {/* Reconcile Results */}
            {reconcileResult && (
                <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '14px' }}>Reconciliation Results</h3>
                    <div className="grid-2" style={{ marginBottom: '16px' }}>
                        <div className="glass-sm" style={{ padding: '16px', textAlign: 'center' }}>
                            <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--success)' }}>{reconcileResult.totalMatched}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Matched</div>
                        </div>
                        <div className="glass-sm" style={{ padding: '16px', textAlign: 'center' }}>
                            <div style={{ fontSize: '28px', fontWeight: 700, color: reconcileResult.totalMismatches > 0 ? 'var(--danger)' : 'var(--success)' }}>
                                {reconcileResult.totalMismatches}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Mismatches</div>
                        </div>
                    </div>
                    {reconcileResult.mismatches?.length > 0 && (
                        <div className="table-wrapper">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Invoice No</th>
                                        <th>Supplier GSTIN</th>
                                        <th>Field</th>
                                        <th>Filed</th>
                                        <th>Matched</th>
                                        <th>Difference</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reconcileResult.mismatches.map((m, i) => (
                                        <tr key={i}>
                                            <td style={{ fontWeight: 500 }}>{m.invoiceNo}</td>
                                            <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{m.supplierGstin || '—'}</td>
                                            <td><span className="badge badge-neutral">{m.field}</span></td>
                                            <td>{m.filed}</td>
                                            <td>{m.matched}</td>
                                            <td style={{ color: 'var(--danger)', fontWeight: 500 }}>{m.difference}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Uploaded Returns List */}
            <div className="glass" style={{ padding: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '14px' }}>Uploaded Returns</h3>
                {returns.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">⟐</div>
                        <h3>No returns uploaded</h3>
                        <p>Upload your first GST return to begin reconciliation</p>
                    </div>
                ) : (
                    <div className="table-wrapper">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Period</th>
                                    <th>GSTIN</th>
                                    <th>Client</th>
                                    <th>File</th>
                                    <th>Mismatches</th>
                                    <th>Uploaded</th>
                                </tr>
                            </thead>
                            <tbody>
                                {returns.map((r) => (
                                    <tr key={r.id}>
                                        <td><span className="badge badge-info">{r.returnType}</span></td>
                                        <td>{r.period}</td>
                                        <td style={{ fontSize: '13px', fontFamily: 'monospace' }}>{r.gstin?.gstin || '—'}</td>
                                        <td>{r.gstin?.client?.name || '—'}</td>
                                        <td style={{ color: 'var(--text-secondary)' }}>{r.fileName}</td>
                                        <td>
                                            {r._count?.mismatches > 0
                                                ? <span className="badge badge-danger">{r._count.mismatches}</span>
                                                : <span className="badge badge-success">0</span>}
                                        </td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                                            {new Date(r.uploadedAt).toLocaleDateString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Upload Modal */}
            {showUpload && (
                <div className="modal-overlay" onClick={() => setShowUpload(false)}>
                    <div className="glass modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Upload GST Return</h2>
                        <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div className="grid-2">
                                <div className="input-group">
                                    <label>Return Type</label>
                                    <select className="input" value={uploadForm.returnType}
                                        onChange={(e) => setUploadForm({ ...uploadForm, returnType: e.target.value })}>
                                        <option value="GSTR1">GSTR-1</option>
                                        <option value="GSTR2A">GSTR-2A</option>
                                        <option value="GSTR2B">GSTR-2B</option>
                                        <option value="GSTR3B">GSTR-3B</option>
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label>Period (e.g. 012026)</label>
                                    <input className="input" required value={uploadForm.period}
                                        onChange={(e) => setUploadForm({ ...uploadForm, period: e.target.value })} placeholder="MMYYYY" />
                                </div>
                            </div>
                            <div className="input-group">
                                <label>GSTIN</label>
                                <select className="input" required value={uploadForm.gstinId}
                                    onChange={(e) => setUploadForm({ ...uploadForm, gstinId: e.target.value })}>
                                    <option value="">Select GSTIN...</option>
                                    {gstins.map(g => (
                                        <option key={g.id} value={g.id}>{g.gstin} — {g.clientName}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="input-group">
                                <label>Return Data (JSON)</label>
                                <textarea className="input" required rows={6} value={uploadForm.data}
                                    onChange={(e) => setUploadForm({ ...uploadForm, data: e.target.value })}
                                    placeholder='{"invoices": [{"invoiceNo": "INV001", "taxableValue": 10000, "igst": 1800}]}' />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn" onClick={() => setShowUpload(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Upload Return</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
