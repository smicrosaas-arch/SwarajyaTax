'use client';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className={styles.landing}>
      {/* Ambient light effects */}
      <div className={styles.ambientOrb1}></div>
      <div className={styles.ambientOrb2}></div>

      {/* Nav */}
      <nav className={styles.nav}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>◈</span>
          <span className={styles.logoText}>Swarajaya TaxCompute</span>
        </div>
        <div className={styles.navLinks}>
          <button className="btn btn-sm" onClick={() => router.push('/auth/login')}>
            Sign In
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => router.push('/auth/register')}>
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <span className={styles.heroBadge}>Built for CA Firms</span>
          <h1 className={styles.heroTitle}>
            GST Compliance,<br />
            <span className={styles.heroAccent}>Simplified.</span>
          </h1>
          <p className={styles.heroDesc}>
            Manage multiple clients, reconcile returns automatically, track notices,
            and keep your entire team in sync — all from one secure platform.
          </p>
          <div className={styles.heroCTA}>
            <button className="btn btn-primary btn-lg" onClick={() => router.push('/auth/register')}>
              Start Free Trial
            </button>
            <button className="btn btn-lg" onClick={() => router.push('/auth/login')}>
              Sign In →
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className={styles.features}>
        <h2 className={styles.sectionTitle}>Everything you need</h2>
        <div className={styles.featureGrid}>
          {[
            { icon: '⬡', title: 'Client Management', desc: 'Organize all your clients and their GSTINs in one place with full activity history.' },
            { icon: '⟐', title: 'Auto Reconciliation', desc: 'Upload GSTR-1, 2A/2B, 3B and instantly detect mismatches with our comparison engine.' },
            { icon: '◉', title: 'Notice Tracking', desc: 'Track demands, scrutiny notices, and assessments with status management and deadlines.' },
            { icon: '⊞', title: 'Task Assignment', desc: 'Assign compliance tasks to team members, set priorities, and track progress in real-time.' },
            { icon: '⊛', title: 'Audit Trail', desc: 'Every action is logged. Full visibility into who did what and when for compliance audits.' },
            { icon: '⬢', title: 'Secure & Multi-Tenant', desc: 'Enterprise-grade security with complete data isolation between firms and role-based access.' },
          ].map((feature, i) => (
            <div key={i} className={`glass ${styles.featureCard}`} style={{ animationDelay: `${i * 80}ms` }}>
              <span className={styles.featureIcon}>{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className={styles.statsSection}>
        <div className={styles.statsGrid}>
          {[
            { value: '10,000+', label: 'GSTINs Managed' },
            { value: '99.9%', label: 'Uptime' },
            { value: '85%', label: 'Time Saved' },
            { value: '500+', label: 'CA Firms' },
          ].map((stat, i) => (
            <div key={i} className={`glass ${styles.statItem}`}>
              <div className={styles.statValue}>{stat.value}</div>
              <div className={styles.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer  */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerLogo}>
            <span className={styles.logoIcon}>◈</span>
            <span>Swarajaya TaxCompute</span>
          </div>
          <p className={styles.footerText}>© 2026 Swarajaya TaxCompute. Secure GST compliance for modern CA firms.</p>
        </div>
      </footer>
    </div>
  );
}
