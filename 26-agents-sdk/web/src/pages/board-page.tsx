import { useEffect, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client";
import type { Status, Task } from "../api/types";
import { BoardColumn } from "../components/board-column";
import { CreateTaskModal } from "../components/create-task-modal";
import { TaskDrawer } from "../components/task-drawer";

const COLUMNS: Array<{ status: Status; label: string }> = [
  { status: "queued", label: "Queued" },
  { status: "in_progress", label: "In Progress" },
  { status: "ready_for_review", label: "Ready for Review" },
  { status: "done", label: "Done" },
  { status: "blocked", label: "Blocked" },
];

function hasRunningAgentTask(tasks: Task[] | undefined) {
  return tasks?.some((task) => task.runs.some((run) => run.status === "running")) ?? false;
}

export function BoardPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState<Status | null>(null);
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: api.tasks,
  });
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags });
  const users = useQuery({ queryKey: ["assignees"], queryFn: api.assignees });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }

  useEffect(() => {
    const changes = api.taskChanges();
    changes.addEventListener("tasks_changed", refresh);
    return () => changes.close();
  }, [queryClient]);

  const reset = useMutation({
    mutationFn: api.reset,
    onSuccess: (data) => {
      refresh();
      setSelectedId(data.find((task) => task.tags.some((tag) => tag.id === "editorial"))?.id ?? null);
    },
  });
  const createTask = useMutation({
    mutationFn: async ({
      payload,
      files,
    }: {
      payload: {
        title: string;
        description: string;
        session_name: string;
        tag_ids: string[];
        assignee_id: string | null;
      };
      files: File[];
    }) => {
      return api.createTask(payload, files);
    },
    onSuccess: (task) => {
      refresh();
      setCreating(false);
      setSelectedId(task.id);
    },
    onError: (error) => setMessage(error.message),
  });
  const selected = tasks.data?.find((task) => task.id === selectedId) ?? null;
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateTask(selected!.id, body),
    onSuccess: refresh,
  });
  const cloneTask = useMutation({
    mutationFn: () => api.cloneTask(selected!.id),
    onSuccess: (task) => {
      refresh();
      setSelectedId(task.id);
    },
    onError: (error) => setMessage(error.message),
  });
  const moveTask = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: Status }) =>
      api.updateTask(taskId, { status }),
    onMutate: async ({ taskId, status }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previous = queryClient.getQueryData<Task[]>(["tasks"]);
      queryClient.setQueryData<Task[]>(["tasks"], (current) =>
        current?.map((task) => (task.id === taskId ? { ...task, status } : task)),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(["tasks"], context?.previous);
      setMessage(error.message);
    },
    onSettled: refresh,
  });
  const comment = useMutation({
    mutationFn: (body: string) => api.addComment(selected!.id, body),
    onSuccess: refresh,
    onError: (error) => setMessage(error.message),
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.upload(selected!.id, file),
    onSuccess: refresh,
  });
  const approval = useMutation({
    mutationFn: (approved: boolean) => api.decideApproval(selected!.id, approved),
    onSuccess: () => {
      refresh();
    },
    onError: (error) => setMessage(error.message),
  });

  function handleDragStart(event: DragEvent<HTMLButtonElement>, task: Task) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    setDraggedTaskId(task.id);
  }

  function handleDragEnd() {
    setDraggedTaskId(null);
    setDropStatus(null);
  }

  function handleDrop(status: Status) {
    const task = tasks.data?.find((item) => item.id === draggedTaskId);
    if (task && task.status !== status) {
      moveTask.mutate({ taskId: task.id, status });
    }
    handleDragEnd();
  }

  const running = hasRunningAgentTask(selected ? [selected] : undefined);

  return (
    <main className={`board-page ${selected ? "has-drawer" : ""}`}>
      <section className="board-area">
        <header className="page-header">
          <div>
            <h1>Tasks</h1>
            <p>Summit 2026 conference production</p>
          </div>
          <div className="header-actions">
            <button className="quiet-button" onClick={() => reset.mutate("empty")}>
              Reset
            </button>
            <button className="primary-button" onClick={() => setCreating(true)}>
              + New issue
            </button>
          </div>
        </header>
        {tasks.isLoading && <div className="loading">Loading board...</div>}
        <div className={`board ${draggedTaskId ? "dragging-card" : ""}`}>
          {COLUMNS.map((column) => (
            <BoardColumn
              key={column.status}
              status={column.status}
              label={column.label}
              selectedId={selectedId}
              draggedTaskId={draggedTaskId}
              dropTarget={dropStatus === column.status}
              tasks={(tasks.data ?? []).filter((task) => task.status === column.status)}
              showEmptyState={
                !tasks.isLoading && tasks.data?.length === 0 && column.status === "queued"
              }
              onSelect={setSelectedId}
              onCardDragStart={handleDragStart}
              onCardDragEnd={handleDragEnd}
              onDragOver={setDropStatus}
              onDragLeave={(status) => {
                if (dropStatus === status) setDropStatus(null);
              }}
              onDrop={handleDrop}
            />
          ))}
        </div>
      </section>
      {selected && (
        <TaskDrawer
          task={selected}
          users={users.data ?? []}
          onClose={() => setSelectedId(null)}
          onClone={() => cloneTask.mutate()}
          cloning={cloneTask.isPending}
          onUpdate={(body) => update.mutate(body)}
          onComment={(body) => comment.mutate(body)}
          onUpload={(file) => upload.mutate(file)}
          onApproval={(approved) => approval.mutate(approved)}
          running={running}
        />
      )}
      {creating && (
        <CreateTaskModal
          tags={tags.data ?? []}
          users={users.data ?? []}
          submitting={createTask.isPending}
          onClose={() => setCreating(false)}
          onCreate={(payload, files) => createTask.mutate({ payload, files })}
        />
      )}
      {message && (
        <button className="toast" onClick={() => setMessage("")}>
          {message}
        </button>
      )}
    </main>
  );
}
