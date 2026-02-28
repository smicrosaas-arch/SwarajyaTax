'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import styles from './layout.module.css';

const API = process.env.NEXT_PUBLIC_API_URL || '';

const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: '⊞' },
    { href: '/dashboard/clients', label: 'Clients', icon: '⬡' },
    { href: '/dashboard/gst-accounts', label: 'GST Accounts', icon: '⟁' },
    { href: '/dashboard/reconciliation', label: 'Reconciliation', icon: '⟐' },
    { href: '/dashboard/notices', label: 'Notices', icon: '◉' },
    { href: '/dashboard/tasks', label: 'Tasks', icon: '⊛' },
    { href: '/dashboard/audit', label: 'Audit Log', icon: '⬢' },
];

export default function DashboardLayout({ children }) {
    const router = useRouter();
    const pathname = usePathname();
    const [user, setUser] = useState(null);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        const token = localStorage.getItem('token');
        const userData = localStorage.getItem('user');
        if (!token) {
            router.push('/auth/login');
            return;
        }
        if (userData) {
            try { setUser(JSON.parse(userData)); } catch { }
        }
    }, [router]);

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        router.push('/auth/login');
    };

    if (!user) return null;

    return (
        <div className={styles.layout}>
            {/* Sidebar */}
            <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
                <div className={styles.sidebarHeader}>
                    <div className={styles.sidebarLogo}>
                        <span className={styles.logoIcon}>◈</span>
                        {!collapsed && <span className={styles.logoText}>Swarajaya TaxCompute</span>}
                    </div>
                    <button className={styles.collapseBtn} onClick={() => setCollapsed(!collapsed)}>
                        {collapsed ? '▸' : '◂'}
                    </button>
                </div>

                <nav className={styles.sidebarNav}>
                    {navItems.map((item) => (
                        <a
                            key={item.href}
                            href={item.href}
                            className={`${styles.navItem} ${pathname === item.href ? styles.navActive : ''}`}
                            title={item.label}
                        >
                            <span className={styles.navIcon}>{item.icon}</span>
                            {!collapsed && <span className={styles.navLabel}>{item.label}</span>}
                        </a>
                    ))}
                </nav>

                <div className={styles.sidebarFooter}>
                    <div className={styles.userInfo}>
                        <div className={styles.avatar}>{user.name?.[0]?.toUpperCase() || 'U'}</div>
                        {!collapsed && (
                            <div className={styles.userMeta}>
                                <div className={styles.userName}>{user.name}</div>
                                <div className={styles.userRole}>{user.role}</div>
                            </div>
                        )}
                    </div>
                    {!collapsed && (
                        <button className={styles.logoutBtn} onClick={handleLogout} title="Sign out">✕</button>
                    )}
                </div>
            </aside>

            {/* Main Content */}
            <main className={styles.main}>
                <header className={styles.topbar}>
                    <div className={styles.topbarLeft}>
                        <h2 className={styles.orgName}>{user.orgName}</h2>
                    </div>
                    <div className={styles.topbarRight}>
                        <span className="badge badge-info" style={{ fontSize: '12px' }}>{user.role}</span>
                    </div>
                </header>
                <div className={styles.content}>
                    {children}
                </div>
            </main>
        </div>
    );
}
