export const SUPPLY_REALTIME_DEBUG_LOG_KEY = 'supply-realtime-debug-log-v1';
const MAX_SUPPLY_REALTIME_DEBUG_ENTRIES = 500;

export type SupplyRealtimeDebugDirection = 'client' | 'server' | 'internal';

interface UnknownRecord {
  [key: string]: unknown;
}

export interface SupplyRealtimeDebugEntry {
  ts: string;
  direction: SupplyRealtimeDebugDirection;
  type: string;
  eventId?: string;
  note?: string;
  responseId?: string;
  itemId?: string;
  itemType?: string;
  callId?: string;
  toolName?: string;
  phase?: string;
  errorMessage?: string;
  responseOutputCount?: number;
  responseFunctionCalls?: Array<{
    itemId?: string;
    callId?: string;
    toolName?: string;
  }>;
  outputLength?: number;
  gateDecision?: string;
  reason?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDebugEntry(value: unknown): value is SupplyRealtimeDebugEntry {
  return isRecord(value) && typeof value.ts === 'string' && typeof value.direction === 'string' && typeof value.type === 'string';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getResponse(event: UnknownRecord) {
  return isRecord(event.response) ? event.response : undefined;
}

function getItem(event: UnknownRecord) {
  return isRecord(event.item) ? event.item : undefined;
}

function getError(event: UnknownRecord) {
  return isRecord(event.error) ? event.error : undefined;
}

function getResponseFunctionCalls(response: UnknownRecord | undefined) {
  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .filter(isRecord)
    .filter((item) => item.type === 'function_call')
    .map((item) => ({
      itemId: stringValue(item.id),
      callId: stringValue(item.call_id),
      toolName: stringValue(item.name),
    }));
}

export function createSupplyRealtimeDebugEntry(
  direction: SupplyRealtimeDebugDirection,
  event: unknown,
  metadata: Partial<Pick<SupplyRealtimeDebugEntry, 'note' | 'gateDecision' | 'reason'>> = {},
): SupplyRealtimeDebugEntry {
  const record = isRecord(event) ? event : {};
  const item = getItem(record);
  const response = getResponse(record);
  const error = getError(record);
  const responseFunctionCalls = getResponseFunctionCalls(response);
  const output = item?.output;

  return {
    ts: new Date().toISOString(),
    direction,
    type: stringValue(record.type) ?? metadata.note ?? 'unknown',
    eventId: stringValue(record.event_id),
    ...metadata,
    responseId: stringValue(response?.id) ?? stringValue(record.response_id),
    itemId: stringValue(record.item_id) ?? stringValue(item?.id),
    itemType: stringValue(item?.type),
    callId: stringValue(record.call_id) ?? stringValue(item?.call_id),
    toolName: stringValue(item?.name) ?? stringValue(record.name),
    phase: stringValue(item?.phase),
    errorMessage: stringValue(error?.message) ?? stringValue(record.message),
    responseOutputCount: Array.isArray(response?.output) ? response.output.length : undefined,
    responseFunctionCalls: responseFunctionCalls.length ? responseFunctionCalls : undefined,
    outputLength: typeof output === 'string' ? output.length : numberValue(record.outputLength),
  };
}

export function readSupplyRealtimeDebugLog(): SupplyRealtimeDebugEntry[] {
  const storage = globalThis.localStorage;
  if (!storage) return [];

  try {
    const parsed = JSON.parse(storage.getItem(SUPPLY_REALTIME_DEBUG_LOG_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isDebugEntry) : [];
  } catch {
    return [];
  }
}

export function appendSupplyRealtimeDebugLog(entry: SupplyRealtimeDebugEntry) {
  try {
    const next = [...readSupplyRealtimeDebugLog(), entry].slice(-MAX_SUPPLY_REALTIME_DEBUG_ENTRIES);
    globalThis.localStorage?.setItem(SUPPLY_REALTIME_DEBUG_LOG_KEY, JSON.stringify(next));
  } catch {
    // Debug logging must never affect the realtime session.
  }

  globalThis.console?.debug?.('[SupplyRealtime]', entry);
}

export function logSupplyRealtimeEvent(
  direction: SupplyRealtimeDebugDirection,
  event: unknown,
  metadata?: Partial<Pick<SupplyRealtimeDebugEntry, 'note' | 'gateDecision' | 'reason'>>,
) {
  appendSupplyRealtimeDebugLog(createSupplyRealtimeDebugEntry(direction, event, metadata));
}

export function clearSupplyRealtimeDebugLog() {
  globalThis.localStorage?.removeItem(SUPPLY_REALTIME_DEBUG_LOG_KEY);
}

export function installSupplyRealtimeDebugHelpers() {
  const target = globalThis as typeof globalThis & {
    __supplyRealtimeDebug?: {
      key: string;
      get: () => SupplyRealtimeDebugEntry[];
      clear: () => void;
    };
  };

  target.__supplyRealtimeDebug ??= {
    key: SUPPLY_REALTIME_DEBUG_LOG_KEY,
    get: readSupplyRealtimeDebugLog,
    clear: clearSupplyRealtimeDebugLog,
  };
}
