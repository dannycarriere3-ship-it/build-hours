import { useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";

import type { Tag, User } from "../api/types";
import { AssigneeCombobox } from "./assignee-combobox";

interface Props {
  tags: Tag[];
  users: User[];
  submitting: boolean;
  onClose: () => void;
  onCreate: (
    payload: {
      title: string;
      description: string;
      session_name: string;
      tag_ids: string[];
      assignee_id: string | null;
    },
    files: File[],
  ) => void;
}

export function CreateTaskModal({ tags, users, submitting, onClose, onCreate }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sessionName, setSessionName] = useState("Production Readiness for Long-Running Agents");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate(
      { title, description, session_name: sessionName, tag_ids: tagIds, assignee_id: assigneeId },
      files,
    );
  }

  function submitWithShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  function toggleTag(tagId: string) {
    setTagIds((current) =>
      current.includes(tagId) ? current.filter((item) => item !== tagId) : [...current, tagId],
    );
  }

  function addFiles(incomingFiles: FileList) {
    setFiles((current) => {
      const added = Array.from(incomingFiles).filter(
        (candidate) =>
          !current.some(
            (file) =>
              file.name === candidate.name &&
              file.size === candidate.size &&
              file.lastModified === candidate.lastModified,
          ),
      );
      return [...current, ...added];
    });
  }

  function handleDragEnter(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    dragDepth.current += 1;
    if (event.dataTransfer.types.includes("Files")) setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }

  return (
    <div className="modal-backdrop">
      <form
        className={`task-modal ${dragging ? "dragging" : ""}`}
        onSubmit={submit}
        onKeyDown={submitWithShortcut}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <header className="composer-header">
          <div className="composer-context">
            <span className="composer-context-pill">Conference Launch</span>
            <span className="composer-divider">/</span>
            <span className="composer-context-pill">Task</span>
          </div>
          <button type="button" className="composer-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </header>
        <section className="composer-body">
          <input
            className="composer-title"
            autoFocus
            required
            placeholder="Issue title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            className="composer-description"
            placeholder="Add description..."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </section>
        <div className="composer-properties">
          <span className="composer-pill">○ Queued</span>
          <AssigneeCombobox
            assignee={users.find((user) => user.id === assigneeId) ?? null}
            users={users}
            onSelect={setAssigneeId}
            variant="composer"
          />
          <label className="composer-pill composer-session">
            <span>Session</span>
            <input
              aria-label="Session"
              value={sessionName}
              onChange={(event) => setSessionName(event.target.value)}
            />
          </label>
          {tags.map((tag) => (
            <button
              type="button"
              className={`composer-pill composer-tag ${tag.color} ${
                tagIds.includes(tag.id) ? "active" : ""
              }`}
              onClick={() => toggleTag(tag.id)}
              key={tag.id}
            >
              {tag.name}
            </button>
          ))}
        </div>
        <footer className="composer-footer">
          <div className="composer-files">
            {files.length === 0 ? (
              <span className="composer-drop-hint">Drop files anywhere to attach</span>
            ) : (
              files.map((file) => (
                <span className="composer-file" key={`${file.name}-${file.size}-${file.lastModified}`}>
                  {file.name}
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setFiles((current) => current.filter((item) => item !== file))}
                  >
                    &times;
                  </button>
                </span>
              ))
            )}
          </div>
          <button type="button" className="quiet-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create issue"} {!submitting && <kbd>⌘↵</kbd>}
          </button>
        </footer>
        {dragging && <div className="composer-drop-overlay">Drop files to attach</div>}
      </form>
    </div>
  );
}
