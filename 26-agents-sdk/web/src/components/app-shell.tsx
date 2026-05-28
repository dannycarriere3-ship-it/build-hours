import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="workspace">
          <span className="workspace-mark">C</span>
          <div>
            <strong>Conference</strong>
            <small>Summit 2026</small>
          </div>
        </div>
        <nav>
          <p className="nav-group">Workspace</p>
          <NavLink to="/">&#9633; Board</NavLink>
          <a className="inactive">&#9675; My tasks</a>
          <a className="inactive">&#9734; Sessions</a>
          <p className="nav-group">Automation</p>
          <NavLink to="/agents">&#9711; Agents</NavLink>
          <a className="inactive">&#8984; Runs</a>
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">SC</span>
          <span>Steve C</span>
        </div>
      </aside>
      <section className="content">
        <header className="topbar">
          <span className="crumb">Conference Launch Desk / Tasks</span>
          <div className="search">Search or jump to...</div>
          <span className="shortcut">&#8984; K</span>
        </header>
        {children}
      </section>
    </div>
  );
}
