export type Status =
  | "queued"
  | "in_progress"
  | "ready_for_review"
  | "done"
  | "blocked";

export interface User {
  id: string;
  display_name: string;
  kind: "human" | "agent";
  title: string | null;
  avatar_initials: string;
  capabilities: string[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Attachment {
  id: string;
  kind: "input" | "output" | "handoff";
  file_name: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number;
  created_at: string;
}

export interface Comment {
  id: string;
  author: User;
  body_markdown: string;
  created_at: string;
}

export interface Activity {
  id: string;
  actor: User | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AgentRun {
  id: string;
  provider: string;
  status: string;
  workspace_backend: string;
  summary: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface Task {
  id: string;
  issue_key: string;
  title: string;
  description: string;
  status: Status;
  assignee: User | null;
  created_by: User;
  session_name: string | null;
  workspace_key: string;
  tags: Tag[];
  attachments: Attachment[];
  comments: Comment[];
  activity: Activity[];
  runs: AgentRun[];
  created_at: string;
  updated_at: string;
}

export interface Capability {
  key: string;
  enabled: boolean;
  detail: string | null;
}
