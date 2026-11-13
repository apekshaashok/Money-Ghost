import './globals.css';

export const metadata = {
  title: 'Money Ghosts',
  description: 'Find forgotten subscriptions, price creep and double charges in your bank statements.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
