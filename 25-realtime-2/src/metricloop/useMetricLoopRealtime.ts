import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMetricLoopAgent } from './MetricLoopAgentContext';
import {
  createMetricLoopCompactResponseContext,
  createMetricLoopContextItem,
  createMetricLoopResponsePayload,
  getInitialMetricLoopVoiceMode,
} from './metricLoopRealtimePayload';
import { createMetricLoopRealtimeSessionConfig, METRIC_LOOP_REALTIME_MODEL } from './metricLoopRealtimeConfig';
import { classifyMetricLoopTurn } from './voiceToActionPolicy';
import { createRealtimeResponseController, type RealtimeResponseRequest } from '../realtime/realtimeResponseController';
import { REALTIME_TRANSCRIPTION_MODEL } from '../realtimeSessionConfig';
import {
  completeRealtimeCostTraceSession,
  recordRealtimeResponseUsage,
  recordRealtimeTranscriptionUsage,
  registerRealtimeCostTraceSession,
} from '../realtime/realtimeCostTrace';
import type {
  MetricLoopActionResponse,
  MetricLoopActivityTrace,
  MetricLoopApplyFilterRequest,
  MetricLoopComparePeriodsRequest,
  MetricLoopConnectionStatus,
  MetricLoopDashboardFilters,
  MetricLoopDeveloperEvent,
  MetricLoopForensicsTrace,
  MetricLoopGenerateBoardRequest,
  MetricLoopNoOpRequest,
  MetricLoopOpenInsightRequest,
  MetricLoopRealtimePhase,
  MetricLoopRootCauseInvestigationRequest,
  MetricLoopSegmentFilterRequest,
  MetricLoopSetBreakdownRequest,
  MetricLoopSessionReplayRequest,
  MetricLoopSwitchVisualizationRequest,
  MetricLoopToolActivity,
  MetricLoopTurnPolicy,
  MetricLoopTranscriptMessage,
  MetricLoopVoiceMode,
} from './metricLoopContracts';

type ToolRequest =
  | MetricLoopApplyFilterRequest
  | MetricLoopComparePeriodsRequest
  | MetricLoopGenerateBoardRequest
  | MetricLoopNoOpRequest
  | MetricLoopOpenInsightRequest
  | MetricLoopRootCauseInvestigationRequest
  | MetricLoopSegmentFilterRequest
  | MetricLoopSetBreakdownRequest
  | MetricLoopSessionReplayRequest
  | MetricLoopSwitchVisualizationRequest
  | Record<string, unknown>;

interface PendingFunctionCall {
  name: string;
  callId: string;
  argumentsText: string;
}

interface MetricLoopServerToolOutput {
  source: 'server';
  action: MetricLoopActionResponse;
}

interface ServerEvent {
  type?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  usage?: {
    type?: string;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: {
      text_tokens?: number;
      audio_tokens?: number;
    };
  };
  response?: {
    id?: string;
    usage?: {
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
      input_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
        image_tokens?: number;
        cached_tokens?: number;
        cached_tokens_details?: {
          text_tokens?: number;
          audio_tokens?: number;
          image_tokens?: number;
        };
      };
      output_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
      };
    };
  };
  error?: {
    message?: string;
  };
  item?: {
    id?: string;
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    phase?: MetricLoopRealtimePhase;
    content?: Array<{
      text?: string;
      transcript?: string;
    }>;
  };
}

function createId(prefix: string) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function nowMs() {
  return Math.round(performance.now());
}

function cloneActivityTrace(trace: MetricLoopActivityTrace): MetricLoopActivityTrace {
  return {
    preambleText: trace.preambleText,
    toolActivities: trace.toolActivities.map((activity) => ({
      ...activity,
      details: activity.details ? [...activity.details] : undefined,
      forensics: activity.forensics ? cloneForensicsTrace(activity.forensics) : undefined,
    })),
    errorText: trace.errorText,
  };
}

function hasActivityTrace(trace: MetricLoopActivityTrace) {
  return Boolean(trace.preambleText || trace.toolActivities.length || trace.errorText);
}

function parseToolArguments(value: string): ToolRequest {
  if (!value.trim()) return {};
  return JSON.parse(value) as ToolRequest;
}

function formatToolChip(name: string): string {
  if (name === 'get_dashboard_state') return 'Reading dashboard state';
  if (name === 'open_activation_funnel' || name === 'open_insight') return 'Opening analytics insight';
  if (name === 'apply_segment_filter' || name === 'apply_filter') return 'Applying dashboard filters';
  if (name === 'set_breakdown') return 'Setting breakdown';
  if (name === 'switch_visualization') return 'Switching visualization';
  if (name === 'compare_periods') return 'Comparing periods';
  if (name === 'check_release_notes') return 'Checking releases';
  if (name === 'cluster_support_tickets') return 'Clustering support tickets';
  if (name === 'open_session_replays' || name === 'open_session_replay') return 'Opening session replay';
  if (name === 'generate_investigation_board' || name === 'start_root_cause_investigation') return 'Generating investigation notebook';
  if (name === 'update_investigation_notebook') return 'Updating investigation notebook';
  if (name === 'get_analytics_schema') return 'Reading analytics schema';
  if (name === 'run_cohort_query') return 'Running cohort query';
  if (name === 'run_instrumentation_check') return 'Checking instrumentation';
  if (name === 'run_analysis_code') return 'Running generated analysis code';
  if (name === 'render_forensics_chart') return 'Rendering forensics chart';
  if (name === 'apply_forensics_result') return 'Applying forensics result';
  if (name === 'no_op') return 'Ignored background turn';
  return 'Running analytics tool';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneForensicsTrace(trace: MetricLoopForensicsTrace): MetricLoopForensicsTrace {
  return {
    ...trace,
    operation: trace.operation
      ? {
          ...trace.operation,
          validation: trace.operation.validation ? [...trace.operation.validation] : undefined,
          execution: trace.operation.execution ? [...trace.operation.execution] : undefined,
        }
      : undefined,
    evidence: trace.evidence?.map((item) => ({ ...item })),
    previewRows: trace.previewRows?.map((row) => ({ ...row })),
    schema: trace.schema
      ? {
          tables: trace.schema.tables.map((table) => ({
            ...table,
            fields: [...table.fields],
          })),
          dimensions: [...trace.schema.dimensions],
          measures: [...trace.schema.measures],
        }
      : undefined,
    chart: trace.chart
      ? {
          ...trace.chart,
          rows: trace.chart.rows.map((row) => ({ ...row })),
        }
      : undefined,
  };
}

function collectToolDetails(output: unknown): string[] {
  if (!isObjectRecord(output)) return [];
  if (isObjectRecord(output.action)) return collectToolDetails(output.action);

  const details: string[] = [];
  if (typeof output.message === 'string') details.push(output.message);
  if (isObjectRecord(output.forensics)) {
    const forensics = output.forensics;
    if (typeof forensics.validationError === 'string') {
      details.push('Validation issue: ' + forensics.validationError);
    }
    if (typeof forensics.repairSource === 'string') {
      details.push('Repair source: ' + forensics.repairSource.replace(/_/g, ' '));
    }
    if (typeof forensics.fallbackExplanation === 'string') {
      details.push(forensics.fallbackExplanation);
    }
  }
  if (details.length > 0) return details.slice(0, 3);

  if (isObjectRecord(output.board)) {
    const board = output.board;
    const details = [
      typeof board.conclusion === 'string' ? board.conclusion : null,
      isObjectRecord(board.dropOffStep) && typeof board.dropOffStep.step === 'string'
        ? 'Drop-off: ' + board.dropOffStep.step
        : null,
    ];
    return details.filter((detail): detail is string => Boolean(detail)).slice(0, 2);
  }

  return [];
}

function getCompletedToolActivityStatus(output: MetricLoopServerToolOutput): MetricLoopToolActivity['status'] {
  if (output.action.status === 'failed') return 'failed';
  if (output.action.status === 'needs_rewrite') return 'needs_rewrite';
  const repairSource = output.action.forensics?.repairSource;
  if (repairSource === 'external_model') return 'repaired';
  if (repairSource === 'deterministic_fallback') return 'fallback_used';
  return 'done';
}

function collectForensicsTrace(output: unknown): MetricLoopForensicsTrace | undefined {
  if (!isObjectRecord(output)) return undefined;
  if (isObjectRecord(output.action)) return collectForensicsTrace(output.action);
  if (!isObjectRecord(output.forensics)) return undefined;
  return cloneForensicsTrace(output.forensics as unknown as MetricLoopForensicsTrace);
}

function createForensicsInvestigationRequest(
  dashboardFilters: MetricLoopDashboardFilters,
): MetricLoopRootCauseInvestigationRequest {
  return {
    question: 'Cohort forensics investigation',
    mode:
      dashboardFilters.breakdown === 'browser' ||
      dashboardFilters.browser === 'mobile_safari'
        ? 'browser_comparison'
        : 'initial',
    excludePaidAds: dashboardFilters.excludePaidAds,
    interaction: dashboardFilters.interaction,
    dateRange: dashboardFilters.dateRange,
    comparison: dashboardFilters.comparison,
    segment: dashboardFilters.segment,
    region: dashboardFilters.region,
    trafficSource: dashboardFilters.trafficSource,
    browser: dashboardFilters.browser,
    device: dashboardFilters.device,
    productCategory: dashboardFilters.productCategory,
  };
}

async function waitForDataChannelOpen(dataChannel: RTCDataChannel): Promise<void> {
  if (dataChannel.readyState === 'open') return;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('MetricLoop connection timed out.'));
    }, 15000);

    dataChannel.addEventListener(
      'open',
      () => {
        window.clearTimeout(timeoutId);
        resolve();
      },
      { once: true },
    );

    dataChannel.addEventListener(
      'error',
      () => {
        window.clearTimeout(timeoutId);
        reject(new Error('MetricLoop connection had trouble opening.'));
      },
      { once: true },
    );
  });
}

function getClientSecretValue(payload: unknown): string | null {
  if (!isObjectRecord(payload)) return null;
  if (typeof payload.value === 'string') return payload.value;
  if (typeof payload.client_secret === 'string') return payload.client_secret;
  if (isObjectRecord(payload.client_secret) && typeof payload.client_secret.value === 'string') {
    return payload.client_secret.value;
  }
  return null;
}

function getRealtimeCallId(location: string | null): string | null {
  if (!location) return null;
  const match = location.match(/\/(rtc_[^/?#]+)/);
  return match?.[1] ?? null;
}

export function useMetricLoopRealtime() {
  const agent = useMetricLoopAgent();
  const agentRef = useRef(agent);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const connectPromiseRef = useRef<Promise<void> | null>(null);
  const pendingFunctionCallsRef = useRef<Map<string, PendingFunctionCall>>(new Map());
  const toolActivityStartMsRef = useRef<Map<string, number>>(new Map());
  const itemPhaseByIdRef = useRef<Map<string, MetricLoopRealtimePhase>>(new Map());
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const assistantMessageIdByItemIdRef = useRef<Map<string, string>>(new Map());
  const bufferedTextByItemIdRef = useRef<Map<string, string>>(new Map());
  const responseControllerRef = useRef(createRealtimeResponseController());
  const metricLoopSessionIdRef = useRef(createId('metricloop-session'));
  const metricLoopCallIdRef = useRef<string | null>(null);
  const currentTurnPolicyRef = useRef<MetricLoopTurnPolicy>({
    mode: 'action',
    shouldSpeak: false,
  });
  const audioTurnPreparedRef = useRef(false);
  const pendingAudioUserMessageIdRef = useRef<string | null>(null);
  const currentTurnUserMessageIdRef = useRef<string | null>(null);
  const lastUserTextRef = useRef('');
  const lastAssistantTextRef = useRef('');
  const turnTraceRef = useRef<MetricLoopActivityTrace>({
    preambleText: '',
    toolActivities: [],
    errorText: null,
  });
  const [messages, setMessages] = useState<MetricLoopTranscriptMessage[]>([]);
  const [toolActivities, setToolActivities] = useState<MetricLoopToolActivity[]>([]);
  const [developerEvents, setDeveloperEvents] = useState<MetricLoopDeveloperEvent[]>([]);
  const [status, setStatus] = useState<MetricLoopConnectionStatus>('idle');
  const [preambleText, setPreambleText] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [micAvailable, setMicAvailable] = useState(true);
  const [voiceMode, setVoiceModeState] = useState<MetricLoopVoiceMode>(() => getInitialMetricLoopVoiceMode());
  const voiceModeRef = useRef<MetricLoopVoiceMode>(voiceMode);

  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  const addDeveloperEvent = useCallback((event: Omit<MetricLoopDeveloperEvent, 'id' | 'timestampMs'>) => {
    setDeveloperEvents((current) =>
      [
        ...current,
        {
          ...event,
          id: createId('event'),
          timestampMs: nowMs(),
        },
      ].slice(-80),
    );
  }, []);

  const sendClientEvent = useCallback((event: unknown) => {
    const dataChannel = dataChannelRef.current;

    if (!dataChannel || dataChannel.readyState !== 'open') return false;
    dataChannel.send(JSON.stringify(event));
    return true;
  }, []);

  const setVoiceMode = useCallback((nextMode: MetricLoopVoiceMode) => {
    setVoiceModeState(nextMode);
    voiceModeRef.current = nextMode;

    const nextUrl = new URL(window.location.href);
    if (nextMode === 'action_only') {
      nextUrl.searchParams.set('voice', 'action-only');
    } else {
      nextUrl.searchParams.delete('voice');
    }
    window.history.replaceState(null, '', nextUrl);
  }, []);

  const classifyTurn = useCallback((text: string) => (
    classifyMetricLoopTurn(text, { actionOnly: voiceModeRef.current === 'action_only' })
  ), []);

  const sendMetricLoopResponse = useCallback(
    (policy: MetricLoopTurnPolicy, label: string) => {
      const context = createMetricLoopCompactResponseContext(agentRef.current.getDashboardState());
      const contextSent = sendClientEvent(createMetricLoopContextItem(context));
      const responseSent = contextSent && sendClientEvent(createMetricLoopResponsePayload(policy));

      if (!responseSent) {
        responseControllerRef.current.markResponseRequestFailed();
        return false;
      }

      addDeveloperEvent({
        type: 'response.requested',
        label,
      });
      return true;
    },
    [addDeveloperEvent, sendClientEvent],
  );

  const requestControlledResponse = useCallback(
    (request: RealtimeResponseRequest, label?: string) => {
      if (!request.shouldCreateResponse) return false;

      const policy =
        request.reason === 'tool'
          ? currentTurnPolicyRef.current
          : classifyTurn(request.text ?? lastUserTextRef.current);
      currentTurnPolicyRef.current = policy;

      const responseLabel =
        label ??
        (request.reason === 'tool'
          ? policy.shouldSpeak
            ? 'Continuing with audio response'
            : 'Continuing with text-only response'
          : policy.shouldSpeak
            ? 'Audio response requested'
            : 'Text-only response requested');

      return sendMetricLoopResponse(policy, responseLabel);
    },
    [classifyTurn, sendMetricLoopResponse],
  );

  const requestResponseForTurn = useCallback(
    (text: string) => {
      const request = responseControllerRef.current.requestTextTurn(text);
      if (!request.shouldCreateResponse) {
        const policy = classifyTurn(text);
        addDeveloperEvent({
          type: 'turn.queued',
          label: policy.shouldSpeak ? 'Queued wake-word explanation' : 'Queued action turn',
        });
      }
      return requestControlledResponse(request);
    },
    [addDeveloperEvent, classifyTurn, requestControlledResponse],
  );

  const syncActiveAssistantTrace = useCallback((trace: MetricLoopActivityTrace) => {
    const activeMessageId = activeAssistantMessageIdRef.current;
    if (!activeMessageId || !hasActivityTrace(trace)) return;

    setMessages((current) =>
      current.map((message) =>
        message.id === activeMessageId
          ? {
              ...message,
              activityTrace: cloneActivityTrace(trace),
            }
          : message,
      ),
    );
  }, []);

  const setTracePreambleText = useCallback(
    (updater: (current: string) => string) => {
      const nextTrace = {
        ...turnTraceRef.current,
        preambleText: updater(turnTraceRef.current.preambleText),
      };
      turnTraceRef.current = nextTrace;
      setPreambleText(nextTrace.preambleText);
      syncActiveAssistantTrace(nextTrace);
    },
    [syncActiveAssistantTrace],
  );

  const setTraceToolActivities = useCallback(
    (updater: (current: MetricLoopToolActivity[]) => MetricLoopToolActivity[]) => {
      const nextTrace = {
        ...turnTraceRef.current,
        toolActivities: updater(
          turnTraceRef.current.toolActivities.map((activity) => ({
            ...activity,
            details: activity.details ? [...activity.details] : undefined,
            forensics: activity.forensics ? cloneForensicsTrace(activity.forensics) : undefined,
          })),
        ),
      };
      turnTraceRef.current = nextTrace;
      setToolActivities(nextTrace.toolActivities);
      syncActiveAssistantTrace(nextTrace);
    },
    [syncActiveAssistantTrace],
  );

  const setTraceErrorText = useCallback(
    (nextErrorText: string | null) => {
      const nextTrace = {
        ...turnTraceRef.current,
        errorText: nextErrorText,
      };
      turnTraceRef.current = nextTrace;
      setErrorText(nextErrorText);
      syncActiveAssistantTrace(nextTrace);
    },
    [syncActiveAssistantTrace],
  );

  const resetTurnTrace = useCallback(() => {
    turnTraceRef.current = {
      preambleText: '',
      toolActivities: [],
      errorText: null,
    };
    setPreambleText('');
    setToolActivities([]);
    setErrorText(null);
  }, []);

  const appendAssistantDelta = useCallback((delta: string, itemId?: string) => {
    if (!delta) return;

    const existingMessageId = itemId
      ? assistantMessageIdByItemIdRef.current.get(itemId)
      : activeAssistantMessageIdRef.current;
    if (!existingMessageId) {
      const newMessageId = createId('assistant');
      activeAssistantMessageIdRef.current = newMessageId;
      lastAssistantTextRef.current = delta;
      if (itemId) {
        assistantMessageIdByItemIdRef.current.set(itemId, newMessageId);
      }
      setMessages((current) => [
        ...current,
        {
          id: newMessageId,
          role: 'assistant',
          text: delta,
          activityTrace: hasActivityTrace(turnTraceRef.current) ? cloneActivityTrace(turnTraceRef.current) : undefined,
        },
      ]);
      return;
    }

    activeAssistantMessageIdRef.current = existingMessageId;
    lastAssistantTextRef.current = lastAssistantTextRef.current + delta;
    setMessages((current) =>
      current.map((message) => (message.id === existingMessageId ? { ...message, text: message.text + delta } : message)),
    );
  }, []);

  const addUserMessage = useCallback((text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;
    const messageId = createId('user');
    lastUserTextRef.current = trimmedText;
    currentTurnUserMessageIdRef.current = messageId;
    setMessages((current) => [...current, { id: messageId, role: 'user', text: trimmedText }]);
  }, []);

  const startPendingAudioUserMessage = useCallback(() => {
    if (pendingAudioUserMessageIdRef.current) return;

    const messageId = createId('user');
    pendingAudioUserMessageIdRef.current = messageId;
    currentTurnUserMessageIdRef.current = messageId;
    setMessages((current) => [...current, { id: messageId, role: 'user', text: '' }]);
  }, []);

  const completePendingAudioUserMessage = useCallback((text: string) => {
    const trimmedText = text.trim();
    const pendingMessageId = pendingAudioUserMessageIdRef.current;
    pendingAudioUserMessageIdRef.current = null;

    if (!trimmedText) {
      if (pendingMessageId) {
        setMessages((current) => current.filter((message) => message.id !== pendingMessageId));
      }
      return;
    }

    lastUserTextRef.current = trimmedText;

    if (!pendingMessageId) {
      const userMessage: MetricLoopTranscriptMessage = {
        id: createId('user'),
        role: 'user',
        text: trimmedText,
      };
      currentTurnUserMessageIdRef.current = userMessage.id;
      setMessages((current) => [...current, userMessage]);
      return;
    }

    currentTurnUserMessageIdRef.current = pendingMessageId;
    setMessages((current) =>
      current.map((message) => (message.id === pendingMessageId ? { ...message, text: trimmedText } : message)),
    );
  }, []);

  const prepareNewTurn = useCallback(() => {
    resetTurnTrace();
    activeAssistantMessageIdRef.current = null;
    currentTurnUserMessageIdRef.current = null;
  }, [resetTurnTrace]);

  const removePrematureAssistantMessagesForToolTurn = useCallback(() => {
    const currentTurnUserMessageId = currentTurnUserMessageIdRef.current;
    if (!currentTurnUserMessageId) return;

    setMessages((current) => {
      const userMessageIndex = current.findIndex((message) => message.id === currentTurnUserMessageId);
      if (userMessageIndex < 0) return current;

      const nextMessages = current.filter(
        (message, index) => index <= userMessageIndex || message.role !== 'assistant',
      );
      if (nextMessages.length === current.length) return current;

      activeAssistantMessageIdRef.current = null;
      assistantMessageIdByItemIdRef.current.clear();
      bufferedTextByItemIdRef.current.clear();
      return nextMessages;
    });
  }, []);

  const updateToolActivity = useCallback(
    (id: string, patch: Partial<MetricLoopToolActivity>) => {
      setTraceToolActivities((current) =>
        current.map((activity) => (activity.id === id ? { ...activity, ...patch } : activity)),
      );
    },
    [setTraceToolActivities],
  );

  const startToolActivity = useCallback(
    (id: string, name: string, args?: unknown) => {
      const startedAtMs = nowMs();
      toolActivityStartMsRef.current.set(id, startedAtMs);
      setTraceToolActivities((current) => {
        if (current.some((activity) => activity.id === id)) return current;
        return [
          ...current,
          {
            id,
            name,
            label: formatToolChip(name),
            status: 'running',
            args,
            startedAtMs,
          },
        ];
      });
    },
    [setTraceToolActivities],
  );

  const runServerMetricLoopTool = useCallback(async (toolName: string, args: ToolRequest) => {
    const response = await fetch('/api/metricloop/tools', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: metricLoopSessionIdRef.current,
        toolName,
        args,
        dashboardFilters: agentRef.current.getDashboardState().dashboardFilters,
      }),
    });

    if (!response.ok) {
      throw new Error('MetricLoop server tool runtime rejected the action.');
    }

    return (await response.json()) as MetricLoopServerToolOutput;
  }, []);

  const applyMetricLoopUiTool = useCallback((toolName: string, args: ToolRequest): MetricLoopActionResponse | null => {
    if (toolName === 'get_dashboard_state') {
      return {
        status: 'done',
        message: 'Dashboard state read.',
        ...agentRef.current.getDashboardState(),
      };
    }
    if (toolName === 'open_activation_funnel') return agentRef.current.openActivationFunnel();
    if (toolName === 'open_insight') return agentRef.current.openInsight(args as MetricLoopOpenInsightRequest);
    if (toolName === 'apply_segment_filter') return agentRef.current.applySegmentFilter(args as MetricLoopSegmentFilterRequest);
    if (toolName === 'apply_filter') return agentRef.current.applyFilter(args as MetricLoopApplyFilterRequest);
    if (toolName === 'set_breakdown') return agentRef.current.setBreakdown(args as MetricLoopSetBreakdownRequest);
    if (toolName === 'switch_visualization') return agentRef.current.switchVisualization(args as MetricLoopSwitchVisualizationRequest);
    if (toolName === 'compare_periods') return agentRef.current.comparePeriods(args as MetricLoopComparePeriodsRequest);
    if (toolName === 'check_release_notes') return agentRef.current.checkReleaseNotes();
    if (toolName === 'cluster_support_tickets') return agentRef.current.clusterSupportTickets();
    if (toolName === 'open_session_replays') return agentRef.current.openSessionReplays(args as MetricLoopSessionReplayRequest);
    if (toolName === 'open_session_replay') return agentRef.current.openSessionReplay(args as MetricLoopSessionReplayRequest);
    if (toolName === 'generate_investigation_board') {
      return agentRef.current.generateInvestigationBoard(args as MetricLoopGenerateBoardRequest);
    }
    if (toolName === 'start_root_cause_investigation') {
      return agentRef.current.startRootCauseInvestigation(args as MetricLoopRootCauseInvestigationRequest);
    }
    if (toolName === 'update_investigation_notebook') {
      return agentRef.current.updateInvestigationNotebook(args as MetricLoopRootCauseInvestigationRequest);
    }
    if (toolName === 'no_op') return agentRef.current.noOp(args as MetricLoopNoOpRequest);
    return null;
  }, []);

  const runFunctionCall = useCallback(
    async (itemId: string, call: PendingFunctionCall) => {
      removePrematureAssistantMessagesForToolTurn();
      responseControllerRef.current.beginToolCall(call.callId);
      const startedAtMs = toolActivityStartMsRef.current.get(itemId) ?? nowMs();

      let args: ToolRequest = {};
      try {
        args = parseToolArguments(call.argumentsText);
      } catch {
        args = {};
      }

      if (!toolActivityStartMsRef.current.has(itemId)) {
        toolActivityStartMsRef.current.set(itemId, startedAtMs);
        startToolActivity(itemId, call.name, args);
      } else {
        updateToolActivity(itemId, {
          args,
          status: 'running',
        });
      }
      addDeveloperEvent({
        type: 'tool.started',
        label: formatToolChip(call.name),
      });

      try {
        const output = await runServerMetricLoopTool(call.name, args);
        applyMetricLoopUiTool(call.name, args);
        if (call.name === 'apply_forensics_result' && output.action.dashboardFilters) {
          agentRef.current.startRootCauseInvestigation(
            createForensicsInvestigationRequest(output.action.dashboardFilters),
          );
        }

        sendClientEvent({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.callId,
            output: JSON.stringify(output),
          },
        });
        if (call.name !== 'no_op') {
          const didRequest = requestControlledResponse(responseControllerRef.current.requestToolContinuation());
          if (didRequest) setStatus('speaking');
        }

        const completedAtMs = nowMs();
        updateToolActivity(itemId, {
          status: getCompletedToolActivityStatus(output),
          result: output,
          completedAtMs,
          durationMs: completedAtMs - startedAtMs,
          details: collectToolDetails(output),
          forensics: collectForensicsTrace(output),
        });
        addDeveloperEvent({
          type: 'tool.completed',
          label: formatToolChip(call.name) + ' completed',
        });
        if (call.name === 'no_op') {
          setStatus('listening');
        }
      } catch {
        const output = { error: 'That analytics action could not be completed.' };
        sendClientEvent({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.callId,
            output: JSON.stringify(output),
          },
        });
        const didRequest = requestControlledResponse(responseControllerRef.current.requestToolContinuation());
        if (didRequest) setStatus('speaking');
        const completedAtMs = nowMs();
        updateToolActivity(itemId, {
          status: 'failed',
          result: output,
          completedAtMs,
          durationMs: completedAtMs - startedAtMs,
        });
        addDeveloperEvent({
          type: 'tool.failed',
          label: formatToolChip(call.name) + ' failed',
        });
      } finally {
        const drainedRequest = responseControllerRef.current.completeToolCall(call.callId);
        const didDrain = requestControlledResponse(
          drainedRequest,
          drainedRequest.reason === 'queued' ? 'Queued turn started' : undefined,
        );
        if (didDrain) setStatus('speaking');
        toolActivityStartMsRef.current.delete(itemId);
      }
    },
    [
      addDeveloperEvent,
      applyMetricLoopUiTool,
      removePrematureAssistantMessagesForToolTurn,
      requestControlledResponse,
      runServerMetricLoopTool,
      sendClientEvent,
      startToolActivity,
      updateToolActivity,
    ],
  );

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === 'session.updated') {
        setStatus('listening');
        addDeveloperEvent({ type: 'session.updated', label: 'Assistant session updated' });
        return;
      }

      if (event.type === 'response.created') {
        responseControllerRef.current.markResponseCreated(event.response?.id);
        setStatus('speaking');
        activeAssistantMessageIdRef.current = null;
        addDeveloperEvent({ type: 'response.created', label: 'Response started' });
        return;
      }

      if (event.type === 'input_audio_buffer.speech_started') {
        if (!pendingAudioUserMessageIdRef.current) {
          prepareNewTurn();
          startPendingAudioUserMessage();
        }
        responseControllerRef.current.beginAudioTurn();
        audioTurnPreparedRef.current = true;
        return;
      }

      if (event.type === 'input_audio_buffer.speech_stopped') {
        setStatus('speaking');
        responseControllerRef.current.markSpeechStopped();
        return;
      }

      if (event.type === 'response.output_item.added' && event.item?.id) {
        const phase = event.item.phase ?? 'final_answer';
        itemPhaseByIdRef.current.set(event.item.id, phase);
        addDeveloperEvent({
          type: event.item.type === 'function_call' ? 'tool.call.added' : 'message.added',
          label: event.item.name ? 'Queued ' + event.item.name : 'Output item added',
          phase,
        });

        if (event.item.type === 'function_call' && event.item.call_id && event.item.name) {
          pendingFunctionCallsRef.current.set(event.item.id, {
            name: event.item.name,
            callId: event.item.call_id,
            argumentsText: event.item.arguments ?? '',
          });
          startToolActivity(event.item.id, event.item.name, event.item.arguments ? { partial: event.item.arguments } : undefined);
        }
        return;
      }

      if (event.type === 'response.function_call_arguments.delta' && event.item_id && event.delta) {
        const call = pendingFunctionCallsRef.current.get(event.item_id);
        if (!call) return;
        const argumentsText = call.argumentsText + event.delta;
        pendingFunctionCallsRef.current.set(event.item_id, {
          ...call,
          argumentsText,
        });
        updateToolActivity(event.item_id, {
          args: argumentsText.trim() ? { partial: argumentsText } : undefined,
        });
        return;
      }

      if (
        (event.type === 'response.output_audio_transcript.delta' || event.type === 'response.output_text.delta') &&
        event.delta &&
        event.item_id
      ) {
        const phase = itemPhaseByIdRef.current.get(event.item_id);
        if (phase === 'commentary') {
          setTracePreambleText((current) => current + event.delta);
        } else if (event.type === 'response.output_audio_transcript.delta') {
          appendAssistantDelta(event.delta, event.item_id);
        } else {
          bufferedTextByItemIdRef.current.set(
            event.item_id,
            (bufferedTextByItemIdRef.current.get(event.item_id) ?? '') + event.delta,
          );
        }
        return;
      }

      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        recordRealtimeTranscriptionUsage({
          sessionKey: metricLoopSessionIdRef.current,
          usage: event.usage,
        });
        if (!audioTurnPreparedRef.current && !pendingAudioUserMessageIdRef.current) {
          prepareNewTurn();
        }
        audioTurnPreparedRef.current = false;
        const transcript = event.transcript ?? '';
        completePendingAudioUserMessage(transcript);
        const didRequest = requestControlledResponse(responseControllerRef.current.completeTranscript(transcript));
        if (didRequest) setStatus('speaking');
        return;
      }

      if (event.type === 'response.output_item.done' && event.item?.type === 'function_call' && event.item.id && event.item.call_id && event.item.name) {
        const pendingCall = pendingFunctionCallsRef.current.get(event.item.id) ?? {
          name: event.item.name,
          callId: event.item.call_id,
          argumentsText: event.item.arguments ?? '',
        };
        pendingFunctionCallsRef.current.delete(event.item.id);
        void runFunctionCall(event.item.id, pendingCall);
        return;
      }

      if (
        event.type === 'response.output_item.done' &&
        event.item?.type === 'message' &&
        event.item.phase !== 'commentary' &&
        event.item.id
      ) {
        if (!assistantMessageIdByItemIdRef.current.has(event.item.id)) {
          const fallbackText =
            bufferedTextByItemIdRef.current.get(event.item.id)?.trim() ||
            event.item.content
              ?.map((part) => part.transcript ?? part.text ?? '')
              .join('')
              .trim() ||
            '';
          if (fallbackText) appendAssistantDelta(fallbackText, event.item.id);
        }
        bufferedTextByItemIdRef.current.delete(event.item.id);
        return;
      }

      if (event.type === 'response.done') {
        recordRealtimeResponseUsage({
          sessionKey: metricLoopSessionIdRef.current,
          usage: event.response?.usage,
        });
        setStatus('listening');
        addDeveloperEvent({ type: 'response.done', label: 'Response completed' });
        const didRequest = requestControlledResponse(responseControllerRef.current.markResponseDone(event.response?.id));
        if (didRequest) setStatus('speaking');
        return;
      }

      if (event.type === 'error') {
        setStatus('error');
        setTraceErrorText(event.error?.message ?? 'The analyst had trouble responding.');
        addDeveloperEvent({ type: 'error', label: event.error?.message ?? 'Assistant error' });
      }
    },
    [
      addDeveloperEvent,
      appendAssistantDelta,
      completePendingAudioUserMessage,
      prepareNewTurn,
      requestControlledResponse,
      runFunctionCall,
      setTraceErrorText,
      setTracePreambleText,
      startPendingAudioUserMessage,
      startToolActivity,
      updateToolActivity,
    ],
  );

  const sendSessionUpdate = useCallback(() => {
    registerRealtimeCostTraceSession({
      app: 'metricloop',
      sessionKey: metricLoopSessionIdRef.current,
      realtimeModel: METRIC_LOOP_REALTIME_MODEL,
      transcriptionModel: REALTIME_TRANSCRIPTION_MODEL,
    });
    sendClientEvent({
      type: 'session.update',
      session: createMetricLoopRealtimeSessionConfig(),
    });
  }, [sendClientEvent]);

  const disconnect = useCallback(() => {
    void completeRealtimeCostTraceSession(metricLoopSessionIdRef.current);
    connectPromiseRef.current = null;
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current.remove();
      remoteAudioRef.current = null;
    }
    pendingFunctionCallsRef.current.clear();
    toolActivityStartMsRef.current.clear();
    itemPhaseByIdRef.current.clear();
    assistantMessageIdByItemIdRef.current.clear();
    bufferedTextByItemIdRef.current.clear();
    responseControllerRef.current.reset();
    metricLoopCallIdRef.current = null;
    currentTurnPolicyRef.current = {
      mode: 'action',
      shouldSpeak: false,
    };
    audioTurnPreparedRef.current = false;
    if (pendingAudioUserMessageIdRef.current) {
      const pendingMessageId = pendingAudioUserMessageIdRef.current;
      setMessages((current) => current.filter((message) => message.id !== pendingMessageId));
    }
    pendingAudioUserMessageIdRef.current = null;
    currentTurnUserMessageIdRef.current = null;
    lastUserTextRef.current = '';
    lastAssistantTextRef.current = '';
    setTraceToolActivities((current) =>
      current.map((activity) => (activity.status === 'running' ? { ...activity, status: 'failed' } : activity)),
    );
    activeAssistantMessageIdRef.current = null;
    setStatus('idle');
  }, [setTraceToolActivities]);

  const connect = useCallback(async (options: { useMic?: boolean } = {}) => {
    if (dataChannelRef.current?.readyState === 'open') return;
    if (connectPromiseRef.current) return connectPromiseRef.current;

    connectPromiseRef.current = (async () => {
      setStatus('connecting');
      setTraceErrorText(null);
      const shouldUseMic = options.useMic ?? true;

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      const remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      remoteAudioRef.current = remoteAudio;

      peerConnection.ontrack = (trackEvent) => {
        const [remoteStream] = trackEvent.streams;
        if (remoteStream) {
          remoteAudio.srcObject = remoteStream;
        }
      };

      if (shouldUseMic) {
        try {
          const localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          localStreamRef.current = localStream;
          localStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, localStream);
          });
          setMicAvailable(true);
        } catch {
          peerConnection.addTransceiver('audio', { direction: 'recvonly' });
          setMicAvailable(false);
        }
      } else {
        peerConnection.addTransceiver('audio', { direction: 'recvonly' });
        setMicAvailable(false);
      }

      const dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;

      dataChannel.addEventListener('message', (messageEvent: MessageEvent<string>) => {
        try {
          handleServerEvent(JSON.parse(messageEvent.data) as ServerEvent);
        } catch {
          setStatus('error');
          setTraceErrorText('The analyst had trouble reading a response.');
        }
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const clientSecretResponse = await fetch('/api/realtime/metricloop/client-secret', {
        method: 'POST',
      });

      if (!clientSecretResponse.ok) {
        throw new Error('MetricLoop voice is unavailable right now.');
      }

      const clientSecretValue = getClientSecretValue(await clientSecretResponse.json());
      if (!clientSecretValue) {
        throw new Error('MetricLoop voice is unavailable right now.');
      }

      let sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: 'Bearer ' + clientSecretValue,
          'Content-Type': 'application/sdp',
        },
      });

      let callId = getRealtimeCallId(sdpResponse.headers.get('Location'));

      if (!sdpResponse.ok) {
        sdpResponse = await fetch('/api/realtime/metricloop/calls', {
          method: 'POST',
          body: offer.sdp,
          headers: {
            'Content-Type': 'application/sdp',
          },
        });
        callId = null;
        addDeveloperEvent({
          type: 'connection.fallback',
          label: 'Using local Realtime call proxy',
        });
      }

      if (!sdpResponse.ok) {
        throw new Error('MetricLoop voice is unavailable right now.');
      }

      metricLoopCallIdRef.current = callId;
      if (callId) {
        void fetch('/api/realtime/metricloop/sideband/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ callId }),
        }).then((sidebandResponse) => {
          addDeveloperEvent({
            type: sidebandResponse.ok ? 'sideband.registered' : 'sideband.unavailable',
            label: sidebandResponse.ok ? 'Server sideband attached' : 'Server sideband could not attach',
          });
        }).catch(() => {
          addDeveloperEvent({
            type: 'sideband.unavailable',
            label: 'Server sideband could not attach',
          });
        });
      }

      await peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: await sdpResponse.text(),
      });
      await waitForDataChannelOpen(dataChannel);
      sendSessionUpdate();
    })();

    try {
      await connectPromiseRef.current;
    } catch (error) {
      disconnect();
      setStatus('error');
      setTraceErrorText(error instanceof Error ? error.message : 'MetricLoop voice is unavailable right now.');
      throw error;
    } finally {
      connectPromiseRef.current = null;
    }
  }, [addDeveloperEvent, disconnect, handleServerEvent, sendSessionUpdate, setTraceErrorText]);

  const sendTextMessage = useCallback(
    async (text: string) => {
      const trimmedText = text.trim();
      if (!trimmedText) return;

      await connect({ useMic: false });
      prepareNewTurn();
      addUserMessage(trimmedText);
      sendClientEvent({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: trimmedText,
            },
          ],
        },
      });
      requestResponseForTurn(trimmedText);
      setStatus('speaking');
    },
    [addUserMessage, connect, prepareNewTurn, requestResponseForTurn, sendClientEvent],
  );

  useEffect(() => () => disconnect(), [disconnect]);

  const statusLabel = useMemo(() => {
    if (status === 'idle') return 'Ask Lighthouse';
    if (status === 'connecting') return 'Connecting';
    if (status === 'listening') return 'Listening';
    if (status === 'speaking') return 'Running investigation';
    return 'Connection issue';
  }, [status]);

  const currentRouteHint = useMemo(() => {
    if (agent.snapshot.activeView === 'board') return 'Ask for a follow-up filter or an explanation.';
    if (agent.snapshot.activeView === 'replays') return 'Ask to compare sessions or update the board.';
    if (agent.snapshot.activeView === 'releases') return 'Ask to correlate releases with activation.';
    return 'Ask Lighthouse a product analytics question.';
  }, [agent.snapshot.activeView]);

  return {
    messages,
    toolActivities,
    developerEvents,
    status,
    statusLabel,
    preambleText,
    errorText,
    micAvailable,
    voiceMode,
    currentRouteHint,
    connect,
    disconnect,
    setVoiceMode,
    sendTextMessage,
  };
}
