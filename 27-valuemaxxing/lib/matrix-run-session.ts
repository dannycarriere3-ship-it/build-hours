export class MatrixRunSession {
  private nextRunId = 0;
  private activeRunId: number | null = null;
  private displayedRunId: number | null = null;

  start() {
    const runId = ++this.nextRunId;
    this.activeRunId = runId;
    this.displayedRunId = runId;
    return runId;
  }

  isActive(runId: number) {
    return this.activeRunId === runId;
  }

  isDisplayed(runId: number) {
    return this.displayedRunId === runId;
  }

  detach() {
    this.displayedRunId = null;
  }

  finish(runId: number) {
    if (!this.isActive(runId)) return null;

    this.activeRunId = null;
    return this.isDisplayed(runId);
  }

  cancel() {
    this.activeRunId = null;
    this.displayedRunId = null;
  }
}
