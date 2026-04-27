import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "AgentBridge Studio",
  description: "Inspect, score, and exercise AgentBridge manifests.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="brand">
            <strong>AgentBridge Studio</strong>
            <span className="brand-sub">developer dashboard</span>
          </div>
          <nav className="nav">
            <Link href="/">Scan</Link>
            <Link href="/actions">Actions</Link>
            <Link href="/manifest">Manifest</Link>
            <Link href="/audit">Audit log</Link>
            <Link href="/spec">Spec</Link>
          </nav>
        </header>
        <main className="main">{children}</main>
        <footer className="footer">
          AgentBridge Studio · default target: http://localhost:3000
        </footer>
      </body>
    </html>
  );
}
