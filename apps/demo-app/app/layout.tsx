import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "Demo Order Manager — AgentBridge",
  description: "Fake order app exposing structured AgentBridge actions.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="brand">
            <strong>Demo Order Manager</strong>
            <span className="brand-sub">powered by AgentBridge</span>
          </div>
          <nav className="nav">
            <Link href="/">Home</Link>
            <Link href="/orders">Orders</Link>
            <Link href="/manifest">Manifest</Link>
            <Link href="/audit">Audit log</Link>
          </nav>
        </header>
        <main className="main">{children}</main>
        <footer className="footer">
          AgentBridge demo · simulated data only · no real payments
        </footer>
      </body>
    </html>
  );
}
