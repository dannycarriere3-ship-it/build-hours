import { createRealtimeResponseController, type RealtimeResponseRequest } from '../realtime/realtimeResponseController';

export type SupplyResponseGateReason = 'tool' | 'user';

export interface SupplyResponseGateDrain {
  shouldCreateResponse: boolean;
  reason?: SupplyResponseGateReason;
}

export interface SupplyResponseGate {
  markResponseCreated(responseId?: string): void;
  markResponseRequestFailed(): void;
  markResponseDone(responseId?: string): SupplyResponseGateDrain;
  markToolCallStarted(callId?: string): void;
  markToolCallFinished(callId?: string): void;
  requestResponseForToolOutput(callId?: string): boolean;
  requestResponseForUserTurn(): boolean;
  reset(): void;
}

function toSupplyDrain(request: RealtimeResponseRequest): SupplyResponseGateDrain {
  if (!request.shouldCreateResponse) return { shouldCreateResponse: false };
  return {
    shouldCreateResponse: true,
    reason: request.reason === 'tool' ? 'tool' : 'user',
  };
}

export function createSupplyResponseGate(): SupplyResponseGate {
  const controller = createRealtimeResponseController();

  return {
    markResponseCreated(responseId?: string) {
      controller.markResponseCreated(responseId);
    },
    markResponseRequestFailed() {
      controller.markResponseRequestFailed();
    },
    markResponseDone(responseId?: string) {
      return toSupplyDrain(controller.markResponseDone(responseId));
    },
    markToolCallStarted(callId?: string) {
      controller.beginToolCall(callId);
    },
    markToolCallFinished(callId?: string) {
      controller.completeToolCall(callId);
    },
    requestResponseForToolOutput(callId?: string) {
      const completedTool = controller.completeToolCall(callId);
      if (completedTool.shouldCreateResponse) return true;
      return controller.requestToolContinuation().shouldCreateResponse;
    },
    requestResponseForUserTurn() {
      return controller.requestTextTurn('supply typed turn').shouldCreateResponse;
    },
    reset() {
      controller.reset();
    },
  };
}
