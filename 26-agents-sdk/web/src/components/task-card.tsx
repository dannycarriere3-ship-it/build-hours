import type { DragEvent } from "react";

import type { Task } from "../api/types";

interface Props {
  task: Task;
  selected: boolean;
  dragging: boolean;
  onSelect: (taskId: string) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, task: Task) => void;
  onDragEnd: () => void;
}

export function TaskCard({ task, selected, dragging, onSelect, onDragStart, onDragEnd }: Props) {
  const running = task.runs.some((run) => run.status === "running");

  return (
    <button
      className={`task-card ${selected ? "selected" : ""} ${dragging ? "dragging" : ""}`}
      draggable
      onClick={() => onSelect(task.id)}
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
    >
      <span className="issue-key">{task.issue_key}</span>
      <strong>{task.title}</strong>
      <div className="tag-row">
        {task.tags.map((tag) => (
          <span className={`tag ${tag.color}`} key={tag.id}>
            {tag.name}
          </span>
        ))}
      </div>
      <div className="card-meta">
        <span className="card-avatar">{task.assignee?.avatar_initials ?? "--"}</span>
        <label>{task.assignee?.display_name ?? "Unassigned"}</label>
        {running && <span className="agent-progress" aria-label="Agent running" title="Agent running" />}
        <small>{task.attachments.length} files</small>
      </div>
    </button>
  );
}
