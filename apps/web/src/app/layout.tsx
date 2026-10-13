import type { ReactNode } from 'react';

export const metadata = {
  title: 'LabOps Copilot',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 40 }}>{children}</body>
    </html>
  );
}
