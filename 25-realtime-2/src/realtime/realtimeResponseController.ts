export type RealtimeResponseRequestReason = 'transcript' | 'typed' | 'tool' | 'queued';

export interface RealtimeResponseRequest {
  shouldCreateResponse: boolean;
  reason?: RealtimeResponseRequestReason;
  text?: string;
}

export interface RealtimeResponseController {
  beginAudioTurn(): void;
  markSpeechStopped(): RealtimeResponseRequest;
  completeTranscript(text: string): RealtimeResponseRequest;
  requestTextTurn(text: string): RealtimeResponseRequest;
  markResponseCreated(responseId?: string): void;
  markResponseRequestFailed(): void;
  markResponseDone(responseId?: string): RealtimeResponseRequest;
  beginToolCall(callId?: string): void;
  completeToolCall(callId?: string): RealtimeResponseRequest;
  requestToolContinuation(): RealtimeResponseRequest;
  reset(): void;
}

const noResponse: RealtimeResponseRequest = { shouldCreateResponse: false };

export function createRealtimeResponseController(): RealtimeResponseController {
  let waitingForTranscript = false;
  let responseRequested = false;
  let responseActive = false;
  let activeResponseId: string | null = null;
  const activeToolCallIds = new Set<string>();
  let anonymousToolCallCount = 0;
  let continuationPending = false;
  let queuedTurnText: string | null = null;

  function hasActiveToolCalls() {
    return activeToolCallIds.size > 0 || anonymousToolCallCount > 0;
  }

  function canCreateResponse() {
    return !responseRequested && !responseActive && !hasActiveToolCalls();
  }

  function requestResponse(reason: RealtimeResponseRequestReason, text?: string): RealtimeResponseRequest {
    if (!canCreateResponse()) {
      if (text?.trim()) queuedTurnText = text.trim();
      return noResponse;
    }

    responseRequested = true;
    return {
      shouldCreateResponse: true,
      reason,
      ...(text ? { text } : {}),
    };
  }

  function drainPendingResponse(): RealtimeResponseRequest {
    if (hasActiveToolCalls()) return noResponse;
    if (responseRequested || responseActive) return noResponse;

    if (continuationPending) {
      continuationPending = false;
      responseRequested = true;
      return { shouldCreateResponse: true, reason: 'tool' };
    }

    if (queuedTurnText) {
      const text = queuedTurnText;
      queuedTurnText = null;
      responseRequested = true;
      return { shouldCreateResponse: true, reason: 'queued', text };
    }

    return noResponse;
  }

  return {
    beginAudioTurn() {
      waitingForTranscript = true;
    },
    markSpeechStopped() {
      return noResponse;
    },
    completeTranscript(text: string) {
      const trimmedText = text.trim();
      if (!waitingForTranscript || !trimmedText) {
        waitingForTranscript = false;
        return noResponse;
      }

      waitingForTranscript = false;
      return requestResponse('transcript', trimmedText);
    },
    requestTextTurn(text: string) {
      const trimmedText = text.trim();
      if (!trimmedText) return noResponse;
      return requestResponse('typed', trimmedText);
    },
    markResponseCreated(responseId?: string) {
      responseRequested = true;
      responseActive = true;
      activeResponseId = responseId ?? null;
    },
    markResponseRequestFailed() {
      responseRequested = false;
      if (!responseActive) {
        activeResponseId = null;
      }
    },
    markResponseDone(responseId?: string) {
      if (responseActive && activeResponseId && responseId && responseId !== activeResponseId) {
        return noResponse;
      }

      responseRequested = false;
      responseActive = false;
      activeResponseId = null;
      return drainPendingResponse();
    },
    beginToolCall(callId?: string) {
      if (callId) {
        activeToolCallIds.add(callId);
      } else {
        anonymousToolCallCount += 1;
      }
    },
    completeToolCall(callId?: string) {
      if (callId) {
        activeToolCallIds.delete(callId);
      } else {
        anonymousToolCallCount = Math.max(0, anonymousToolCallCount - 1);
      }
      return drainPendingResponse();
    },
    requestToolContinuation() {
      if (!canCreateResponse()) {
        continuationPending = true;
        return noResponse;
      }

      responseRequested = true;
      return { shouldCreateResponse: true, reason: 'tool' };
    },
    reset() {
      waitingForTranscript = false;
      responseRequested = false;
      responseActive = false;
      activeResponseId = null;
      activeToolCallIds.clear();
      anonymousToolCallCount = 0;
      continuationPending = false;
      queuedTurnText = null;
    },
  };
}
