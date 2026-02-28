import './globals.css';

export const metadata = {
  title: 'Swarajaya TaxCompute — GST Compliance Management',
  description: 'Centralized GST compliance platform for CA firms. Manage clients, reconcile returns, track notices, and streamline tax workflows.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
