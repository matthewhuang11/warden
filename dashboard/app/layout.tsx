import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Warden Dashboard',
  description: 'Aggregate protection coverage for Warden teams.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
