import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import './titanium-blue.css';
import './enterprise.css';

const manrope = localFont({ src: '../components/fonts/Manrope.ttf', variable: '--font-manrope', display: 'swap', weight: '200 800' });
export const metadata: Metadata = { title: 'Open Agent Bridge', description: 'The Open Agent Bridge owner workspace for secure project and agent coordination.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="light" className={manrope.variable} suppressHydrationWarning><body><a className="skip-link" href="#main-content">Skip to main content</a>{children}</body></html>;
}
