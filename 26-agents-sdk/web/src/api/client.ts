import type { Capability, Tag, Task, User } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail ?? "Request failed.");
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  tasks: () => request<Task[]>("/api/tasks"),
  taskChanges: () => new EventSource("/api/events/tasks"),
  tags: () => request<Tag[]>("/api/tags"),
  assignees: () => request<User[]>("/api/assignees"),
  capabilities: () => request<Capability[]>("/api/demo/capabilities"),
  reset: (state: "empty" | "ready_for_agent_demo") =>
    request<Task[]>("/api/demo/reset", json({ state })),
  createTask: (
    body: {
      title: string;
      description: string;
      session_name: string;
      tag_ids: string[];
      assignee_id: string | null;
    },
    files: File[],
  ) => {
    const form = new FormData();
    form.append("payload", JSON.stringify(body));
    for (const file of files) form.append("files", file);
    return request<Task>("/api/tasks", { method: "POST", body: form });
  },
  updateTask: (taskId: string, body: Record<string, unknown>) =>
    request<Task>(`/api/tasks/${taskId}`, {
      ...json(body),
      method: "PATCH",
    }),
  cloneTask: (taskId: string) =>
    request<Task>(`/api/tasks/${taskId}/clone`, { method: "POST" }),
  addComment: (taskId: string, body_markdown: string) =>
    request<Task>(`/api/tasks/${taskId}/comments`, json({ body_markdown })),
  decideApproval: (taskId: string, approved: boolean) =>
    request<Task>(`/api/tasks/${taskId}/approval`, json({ approved })),
  upload: (taskId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "input");
    return request<Task>(`/api/tasks/${taskId}/attachments`, {
      method: "POST",
      body: form,
    });
  },
};
