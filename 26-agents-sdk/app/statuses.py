from enum import StrEnum


class TaskStatus(StrEnum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    READY_FOR_REVIEW = "ready_for_review"
    DONE = "done"
    BLOCKED = "blocked"
