import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { Status, Task, User } from "../api/types";
import { AssigneeCombobox } from "./assignee-combobox";

const STATUSES: Array<{ value: Status; label: string }> = [
  { value: "queued", label: "Queued" },
  { value: "in_progress", label: "In Progress" },
  { value: "ready_for_review", label: "Ready for Review" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked" },
];

type Tab = "files" | "activity" | "output" | "preview";

interface Props {
  task: Task;
  users: User[];
  onClose: () => void;
  onClone: () => void;
  cloning: boolean;
  onUpdate: (body: Record<string, unknown>) => void;
  onComment: (body: string) => void;
  onUpload: (file: File) => void;
  onApproval: (approved: boolean) => void;
  running: boolean;
}

function eventText(task: Task, type: string, payload: Record<string, unknown>): string {
  if (type === "task_created") return `Created ${task.issue_key}.`;
  if (type === "status_changed") return `Moved from ${payload.from} to ${payload.to}.`;
  if (type === "assignee_changed") return `Assigned from ${payload.from} to ${payload.to}.`;
  if (type === "file_added") return `Added ${payload.file_name}.`;
  return String(payload.body ?? type.replaceAll("_", " "));
}

function serverTimestamp(value: string): Date {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  return new Date(hasTimezone ? value : `${value}Z`);
}

function relativeTime(value: string): string {
  const date = serverTimestamp(value);
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (elapsedSeconds < 60) return "Just now";
  if (elapsedSeconds < 60 * 60) return `${Math.floor(elapsedSeconds / 60)}m ago`;
  if (elapsedSeconds < 24 * 60 * 60) return `${Math.floor(elapsedSeconds / (60 * 60))}h ago`;
  if (elapsedSeconds < 48 * 60 * 60) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function outputText(task: Task, type: string, payload: Record<string, unknown>): string {
  if (type === "agent_output") return String(payload.body ?? "");
  if (type === "agent_run_started") return String(payload.body ?? "Agent run started.");
  if (type === "agent_run_completed") return String(payload.body ?? "Agent run completed.");
  if (type === "agent_run_failed") return String(payload.body ?? "Agent run failed.");
  if (type === "agent_approval_requested") return String(payload.body ?? "Approval requested.");
  if (type === "agent_approval_resolved") return String(payload.body ?? "Approval resolved.");
  if (type === "file_added") return `Added file: ${String(payload.file_name ?? "")}`;
  if (type === "status_changed") return `Moved from ${payload.from} to ${payload.to}.`;
  if (type === "assignee_changed") return `Assigned from ${payload.from} to ${payload.to}.`;
  return eventText(task, type, payload);
}

export function TaskDrawer({
  task,
  users,
  onClose,
  onClone,
  cloning,
  onUpdate,
  onComment,
  onUpload,
  onApproval,
  running,
}: Props) {
  const [tab, setTab] = useState<Tab>("activity");
  const [comment, setComment] = useState("");
  useEffect(() => setTab("activity"), [task.id]);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  const assignedAgent = task.assignee?.kind === "agent" ? task.assignee : null;
  const preview = useMemo(
    () => task.attachments.find((file) => file.kind === "output" && file.file_name.endsWith(".html")),
    [task.attachments],
  );
  const outputEvents = useMemo(
    () =>
      task.activity
        .filter(
          (event) =>
            event.event_type !== "comment_added" &&
            (event.event_type.startsWith("agent_") || event.actor?.kind === "agent"),
        ),
    [task.activity],
  );
  const latestRun = task.runs[0];
  const awaitingApproval = latestRun?.status === "awaiting_approval";
  const outputStatus = latestRun?.status.replaceAll("_", " ");

  function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    if (assignedAgent) {
      setTab("output");
    }
    onComment(comment);
    setComment("");
  }

  return (
    <aside className="drawer">
      <header className="drawer-header">
        <div className="drawer-issue">{task.issue_key}</div>
        <div className="drawer-actions">
          <button className="quiet-button" disabled={cloning} onClick={onClone}>
            {cloning ? "Cloning..." : "Clone task"}
          </button>
          <button className="icon-button" onClick={onClose}>
            x
          </button>
        </div>
        <h2>{task.title}</h2>
        {task.description && <p className="drawer-description">{task.description}</p>}
        <div className="tag-row">
          {task.tags.map((tag) => (
            <span className={`tag ${tag.color}`} key={tag.id}>
              {tag.name}
            </span>
          ))}
        </div>
      </header>
      <div className="property-list">
        <label>Status</label>
        <select value={task.status} onChange={(event) => onUpdate({ status: event.target.value })}>
          {STATUSES.map((status) => (
            <option value={status.value} key={status.value}>
              {status.label}
            </option>
          ))}
        </select>
        <label>Assignee</label>
        <AssigneeCombobox
          assignee={task.assignee}
          users={users}
          onSelect={(assigneeId) => onUpdate({ assignee_id: assigneeId })}
        />
        <label>Workspace</label>
        <code>{task.workspace_key}</code>
      </div>
      <nav className="drawer-tabs">
        {(["files", "activity", "output", "preview"] as Tab[]).map((item) => (
          <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      <div className="drawer-body">
        {tab === "files" && (
          <>
            <label className="upload-button">
              + Attach source file
              <input
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                }}
              />
            </label>
            <div className="file-list">
              {task.attachments.map((file) => (
                <a
                  key={file.id}
                  href={`/api/tasks/${task.id}/attachments/${file.id}/download`}
                  className="file-row"
                >
                  <span>{file.kind}</span>
                  <strong>{file.file_name}</strong>
                  <small>{Math.max(1, Math.round(file.size_bytes / 1024))} KB</small>
                </a>
              ))}
            </div>
          </>
        )}
        {tab === "activity" && (
          <>
            <form className="comment-form" onSubmit={submitComment}>
              <textarea
                value={comment}
                placeholder={
                  assignedAgent
                    ? `Send instructions to ${assignedAgent.display_name}...`
                    : "Leave a comment as Steve C..."
                }
                onChange={(event) => setComment(event.target.value)}
              />
              <button className="quiet-button" type="submit">
                {assignedAgent ? "Send" : "Comment"}
              </button>
            </form>
            {assignedAgent && (
              <p className="agent-dispatch-note">
                Commenting dispatches this task to {assignedAgent.display_name}.
              </p>
            )}
            <div className="timeline">
              {task.activity
                .filter((event) => event.event_type !== "agent_output")
                .map((event) =>
                  event.event_type === "comment_added" ? (
                    <div className="comment-row" key={event.id}>
                      <span className="avatar">{event.actor?.avatar_initials ?? "--"}</span>
                      <div className="comment-bubble">
                        <header>
                          <strong>{event.actor?.display_name ?? "System"}</strong>
                          <small>{relativeTime(event.created_at)}</small>
                        </header>
                        <p>{eventText(task, event.event_type, event.payload)}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="activity-row" key={event.id}>
                      <span className="activity-dot" />
                      <p>
                        <span>{event.actor?.display_name ?? "System"}</span>{" "}
                        {eventText(task, event.event_type, event.payload)}
                      </p>
                      <small>{relativeTime(event.created_at)}</small>
                    </div>
                  ),
                )}
            </div>
          </>
        )}
        {tab === "output" && (
          <section className="output-panel">
            <header className="output-header">
              <span>Task output</span>
              {running ? (
                <small className="output-status running">
                  <span className="agent-progress" aria-hidden="true" />
                  Running
                </small>
              ) : latestRun ? (
                <small className={`output-status ${latestRun.status}`}>{outputStatus}</small>
              ) : null}
            </header>
            {awaitingApproval && (
              <div className="approval-prompt">
                <strong>Approve completion?</strong>
                <p>The agent wants to move this task to Done.</p>
                <div>
                  <button className="quiet-button" type="button" onClick={() => onApproval(false)}>
                    Decline
                  </button>
                  <button className="primary-button" type="button" onClick={() => onApproval(true)}>
                    Approve
                  </button>
                </div>
              </div>
            )}
            {outputEvents.length ? (
              <div className="output-feed">
                {running && <div className="output-cursor">Working...</div>}
                {outputEvents.map((event) => (
                  <div
                    className={`output-line ${String(event.payload.kind ?? event.event_type)}`}
                    key={event.id}
                  >
                    <small>{relativeTime(event.created_at)}</small>
                    <pre>{outputText(task, event.event_type, event.payload)}</pre>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-panel">
                Assign an agent and send a comment to watch its work appear here.
              </div>
            )}
          </section>
        )}
        {tab === "preview" && (
          <div className="empty-panel">
            {preview ? (
              <a href={`/api/tasks/${task.id}/attachments/${preview.id}/download`}>
                Open generated preview
              </a>
            ) : (
              "No preview artifact yet. The Asset Producer will write one to output/."
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
