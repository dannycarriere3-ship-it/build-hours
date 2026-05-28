import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client";

const LABELS: Record<string, string> = {
  docker_agent: "Program Editor / Docker sandbox",
  editorial_skill: "Conference editorial skill",
  modal: "Modal hosted sandbox",
  board_tools: "Workflow tools",
  completion_approval: "Human approval for Done",
  r2: "R2 task workspace",
};

export function AgentsPage() {
  const capabilities = useQuery({ queryKey: ["capabilities"], queryFn: api.capabilities });

  return (
    <main className="agents-page">
      <header className="page-header">
        <div>
          <h1>Agents</h1>
          <p>Wire capabilities in order during the demo.</p>
        </div>
      </header>
      <section className="agent-panel">
        <h2>Program Editor</h2>
        <p className="panel-description">
          This surface is complete; the Python integration points remain intentionally disabled.
        </p>
        {(capabilities.data ?? []).map((capability) => (
          <div className="capability-row" key={capability.key}>
            <div>
              <strong>{LABELS[capability.key]}</strong>
              <p>{capability.detail}</p>
            </div>
            <span className={capability.enabled ? "enabled" : "not-configured"}>
              {capability.enabled ? "Configured" : "Not configured"}
            </span>
          </div>
        ))}
        <div className="hook-note">
          The prepared server hooks are intentionally disabled until each demo step.
        </div>
      </section>
    </main>
  );
}
