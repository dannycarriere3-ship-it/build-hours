import type { DragEvent } from "react";

import type { Status, Task } from "../api/types";
import { TaskCard } from "./task-card";

interface Props {
  status: Status;
  label: string;
  tasks: Task[];
  selectedId: string | null;
  draggedTaskId: string | null;
  dropTarget: boolean;
  showEmptyState?: boolean;
  onSelect: (taskId: string) => void;
  onCardDragStart: (event: DragEvent<HTMLButtonElement>, task: Task) => void;
  onCardDragEnd: () => void;
  onDragOver: (status: Status) => void;
  onDragLeave: (status: Status) => void;
  onDrop: (status: Status) => void;
}

export function BoardColumn({
  status,
  label,
  tasks,
  selectedId,
  draggedTaskId,
  dropTarget,
  showEmptyState = false,
  onSelect,
  onCardDragStart,
  onCardDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: Props) {
  return (
    <section
      className={`column ${dropTarget ? "drop-target" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOver(status);
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) {
          onDragLeave(status);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(status);
      }}
    >
      <header>
        <span>{label}</span>
        <small>{tasks.length}</small>
        <button className="icon-button">+</button>
      </header>
      <div className="column-list">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            selected={selectedId === task.id}
            dragging={draggedTaskId === task.id}
            onSelect={onSelect}
            onDragStart={onCardDragStart}
            onDragEnd={onCardDragEnd}
          />
        ))}
        {showEmptyState && (
          <div className="column-empty">
            <strong>No tasks yet</strong>
            <p>Create a session task or seed the demo packet.</p>
          </div>
        )}
      </div>
    </section>
  );
}
