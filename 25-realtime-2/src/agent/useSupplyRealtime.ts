import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getToolDelayMs } from '../demoExperience';
import { createRealtimeSessionConfig, REALTIME_TRANSCRIPTION_MODEL } from '../realtimeSessionConfig';
import {
  completeRealtimeCostTraceSession,
  recordRealtimeResponseUsage,
  recordRealtimeTranscriptionUsage,
  registerRealtimeCostTraceSession,
} from '../realtime/realtimeCostTrace';
import { useSupplyAgent } from './SupplyAgentContext';
import {
  SUPPLY_REALTIME_INSTRUCTIONS,
  SUPPLY_REALTIME_TOOLS,
} from './supplyPrompt';
import {
  SUPPLY_REALTIME_MODEL,
  SUPPLY_REALTIME_REASONING,
  SUPPLY_REALTIME_TURN_DETECTION,
} from './supplyRealtimeConfig';
import {
  installSupplyRealtimeDebugHelpers,
  logSupplyRealtimeEvent,
} from './supplyRealtimeDebugLog';
import { createSupplyResponseGate } from './supplyResponseGate';
import type {
  AddToCartRequest,
  ApplyFiltersRequest,
  GetScreenStateRequest,
  HighlightProductsRequest,
  SupplyActionResponse,
  SupplyActivityTrace,
  SupplyConnectionStatus,
  SupplyHighlightResponse,
  SupplyRealtimePhase,
  SupplyToolActivity,
  SupplyTranscriptMessage,
  OpenProductRequest,
  SearchProductsRequest,
  SearchWeatherWebRequest,
  SelectQuantityRequest,
  SelectShoeSizeRequest,
  SummarizeProductReviewsRequest,
} from './contracts';

type ToolRequest =
  | AddToCartRequest
  | ApplyFiltersRequest
  | GetScreenStateRequest
  | HighlightProductsRequest
  | OpenProductRequest
  | SearchProductsRequest
  | SearchWeatherWebRequest
  | SelectQuantityRequest
  | SelectShoeSizeRequest
  | SummarizeProductReviewsRequest
  | Record<string, never>;

interface PendingFunctionCall {
  name: string;
  callId: string;
  argumentsText: string;
}

interface ServerEvent {
  type?: string;
  event_id?: string;
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
    code?: string;
    message?: string;
    type?: string;
  };
  item?: {
    id?: string;
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    phase?: SupplyRealtimePhase;
    content?: Array<{
      text?: string;
      transcript?: string;
    }>;
  };
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getActiveResponseIdFromError(message: string | undefined) {
  return message?.match(/active response in progress:\s*(resp_[A-Za-z0-9]+)/i)?.[1];
}

function cloneActivityTrace(trace: SupplyActivityTrace): SupplyActivityTrace {
  return {
    preambleText: trace.preambleText,
    toolActivities: trace.toolActivities.map((activity) => ({
      ...activity,
      details: activity.details ? [...activity.details] : undefined,
    })),
    errorText: trace.errorText,
  };
}

function hasActivityTrace(trace: SupplyActivityTrace) {
  return Boolean(trace.preambleText || trace.toolActivities.length || trace.errorText);
}

function parseToolArguments(value: string): ToolRequest {
  if (!value.trim()) return {};
  return JSON.parse(value) as ToolRequest;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatToolChip(name: string): string {
  if (name === 'get_hiking_needs') return 'Planning hiking essentials';
  if (name === 'get_saved_profile') return 'Checking saved preferences';
  if (name === 'get_screen_state') return 'Checking the current page';
  if (name === 'search_products') return 'Searching Supply Co.';
  if (name === 'apply_filters') return 'Narrowing the results';
  if (name === 'highlight_products') return 'Pointing out options';
  if (name === 'open_product') return 'Opening product details';
  if (name === 'select_quantity') return 'Setting quantity';
  if (name === 'select_shoe_size') return 'Selecting size';
  if (name === 'open_size_guide') return 'Opening the size guide';
  if (name === 'close_size_guide') return 'Closing the size guide';
  if (name === 'add_to_cart') return 'Adding to cart';
  if (name === 'summarize_product_reviews') return 'Scanning product reviews';
  if (name === 'search_weather_web') return 'Checking weather sources';
  if (name === 'go_to_cart') return 'Opening the cart';
  if (name === 'go_home') return 'Returning home';
  if (name === 'clear_filters') return 'Clearing filters';
  return 'Working on that';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectToolDetails(output: unknown): string[] {
  if (!isObjectRecord(output)) return [];

  if (isObjectRecord(output.profile) && typeof output.profile.preferredShoeSize === 'string') {
    return ['Saved shoe size ' + output.profile.preferredShoeSize];
  }

  if (Array.isArray(output.products)) {
    return output.products
      .map((product) => (isObjectRecord(product) && typeof product.title === 'string' ? product.title : null))
      .filter((title): title is string => Boolean(title))
      .slice(0, 2);
  }

  if (Array.isArray(output.criticalThemes)) {
    return output.criticalThemes
      .map((theme) => (isObjectRecord(theme) && typeof theme.label === 'string' ? theme.label : null))
      .filter((label): label is string => Boolean(label))
      .slice(0, 2);
  }

  if (typeof output.stormRisk === 'string' && typeof output.summary === 'string') {
    return [output.stormRisk + ' storm risk', output.summary];
  }

  if (isObjectRecord(output.product) && typeof output.product.title === 'string') {
    return [output.product.title];
  }

  if (Array.isArray(output.applied)) {
    return output.applied
      .map((result) => (isObjectRecord(result) && typeof result.label === 'string' ? result.label : null))
      .filter((label): label is string => Boolean(label))
      .slice(0, 3);
  }

  if (typeof output.label === 'string') return [output.label];
  if (typeof output.message === 'string') return [output.message];

  return [];
}

function isExplicitAddToCartIntent(userText: string, assistantText: string): boolean {
  const normalizedUserText = userText.trim().toLowerCase();
  const normalizedAssistantText = assistantText.trim().toLowerCase();

  const directAddIntent =
    /\b(add|put|place)\b.*\b(cart|basket|bag)\b/.test(normalizedUserText) ||
    /\b(cart|basket|bag)\b.*\b(add|put|place)\b/.test(normalizedUserText) ||
    /\b(add|put|place)\s+(it|this|that|one)\b/.test(normalizedUserText) ||
    /\b(buy|purchase)\b/.test(normalizedUserText);
  const browseIntent = /\b(open|show|view|check out|look at|see)\b/.test(normalizedUserText);
  const confirmationIntent = /^(yes|yeah|yep|sure|ok|okay|do it|go ahead|sounds good)\b/.test(
    normalizedUserText,
  );
  const assistantAskedForCartConfirmation = /\b(add|cart|basket|bag)\b/.test(normalizedAssistantText);

  return directAddIntent || (confirmationIntent && assistantAskedForCartConfirmation && !browseIntent);
}

async function waitForDataChannelOpen(dataChannel: RTCDataChannel): Promise<void> {
  if (dataChannel.readyState === 'open') return;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Assistant connection timed out.'));
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
        reject(new Error('Assistant connection had trouble opening.'));
      },
      { once: true },
    );
  });
}

export function useSupplyRealtime() {
  const agent = useSupplyAgent();
  const agentRef = useRef(agent);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const connectPromiseRef = useRef<Promise<void> | null>(null);
  const pendingFunctionCallsRef = useRef<Map<string, PendingFunctionCall>>(new Map());
  const itemPhaseByIdRef = useRef<Map<string, SupplyRealtimePhase>>(new Map());
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const assistantMessageIdByItemIdRef = useRef<Map<string, string>>(new Map());
  const bufferedTextByItemIdRef = useRef<Map<string, string>>(new Map());
  const responseGateRef = useRef(createSupplyResponseGate());
  const supplySessionIdRef = useRef(createMessageId('supply-session'));
  const currentTurnToolNamesRef = useRef<Set<string>>(new Set());
  const audioTurnPreparedRef = useRef(false);
  const pendingAudioUserMessageIdRef = useRef<string | null>(null);
  const currentTurnUserMessageIdRef = useRef<string | null>(null);
  const lastUserTextRef = useRef('');
  const lastAssistantTextRef = useRef('');
  const assistantTextBeforeCurrentTurnRef = useRef('');
  const turnTraceRef = useRef<SupplyActivityTrace>({
    preambleText: '',
    toolActivities: [],
    errorText: null,
  });
  const [messages, setMessages] = useState<SupplyTranscriptMessage[]>([]);
  const [toolActivities, setToolActivities] = useState<SupplyToolActivity[]>([]);
  const [status, setStatus] = useState<SupplyConnectionStatus>('idle');
  const [preambleText, setPreambleText] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [micAvailable, setMicAvailable] = useState(true);

  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    installSupplyRealtimeDebugHelpers();
  }, []);

  const sendClientEvent = useCallback((event: unknown) => {
    const dataChannel = dataChannelRef.current;
    if (!dataChannel || dataChannel.readyState !== 'open') {
      logSupplyRealtimeEvent('client', event, { gateDecision: 'not_sent', reason: 'data_channel_not_open' });
      return false;
    }
    logSupplyRealtimeEvent('client', event, { gateDecision: 'sent' });
    dataChannel.send(JSON.stringify(event));
    return true;
  }, []);

  const sendResponseCreate = useCallback(() => {
    const sent = sendClientEvent({
      event_id: createMessageId('supply-response-create'),
      type: 'response.create',
    });
    if (!sent) {
      logSupplyRealtimeEvent('internal', { type: 'supply.response_create_failed' });
      responseGateRef.current.markResponseRequestFailed();
    }
    return sent;
  }, [sendClientEvent]);

  const requestResponseForToolOutput = useCallback((callId?: string) => {
    if (!responseGateRef.current.requestResponseForToolOutput(callId)) {
      logSupplyRealtimeEvent('internal', { type: 'supply.tool_continuation_deferred', call_id: callId });
      return false;
    }
    logSupplyRealtimeEvent('internal', { type: 'supply.tool_continuation_allowed', call_id: callId });
    return sendResponseCreate();
  }, [sendResponseCreate]);

  const requestResponseForUserTurn = useCallback(() => {
    if (!responseGateRef.current.requestResponseForUserTurn()) {
      logSupplyRealtimeEvent('internal', { type: 'supply.user_turn_deferred' });
      return false;
    }
    logSupplyRealtimeEvent('internal', { type: 'supply.user_turn_allowed' });
    return sendResponseCreate();
  }, [sendResponseCreate]);

  const syncActiveAssistantTrace = useCallback((trace: SupplyActivityTrace) => {
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
    (updater: (current: SupplyToolActivity[]) => SupplyToolActivity[]) => {
      const nextTrace = {
        ...turnTraceRef.current,
        toolActivities: updater(
          turnTraceRef.current.toolActivities.map((activity) => ({
            ...activity,
            details: activity.details ? [...activity.details] : undefined,
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
      const newMessageId = createMessageId('assistant');
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
    lastAssistantTextRef.current = `${lastAssistantTextRef.current}${delta}`;
    setMessages((current) =>
      current.map((message) => (message.id === existingMessageId ? { ...message, text: `${message.text}${delta}` } : message)),
    );
  }, []);

  const addUserMessage = useCallback((text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;
    const messageId = createMessageId('user');
    lastUserTextRef.current = trimmedText;
    currentTurnUserMessageIdRef.current = messageId;
    setMessages((current) => [...current, { id: messageId, role: 'user', text: trimmedText }]);
  }, []);

  const startPendingAudioUserMessage = useCallback(() => {
    if (pendingAudioUserMessageIdRef.current) return;

    const messageId = createMessageId('user');
    pendingAudioUserMessageIdRef.current = messageId;
    currentTurnUserMessageIdRef.current = messageId;
    setMessages((current) => [...current, { id: messageId, role: 'user', text: '' }]);
  }, []);

  const completePendingAudioUserMessage = useCallback(
    (text: string) => {
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
        const userMessage: SupplyTranscriptMessage = {
          id: createMessageId('user'),
          role: 'user',
          text: trimmedText,
        };
        currentTurnUserMessageIdRef.current = userMessage.id;
        setMessages((current) => {
          const activeAssistantMessageId = activeAssistantMessageIdRef.current;
          if (activeAssistantMessageId) {
            const activeAssistantIndex = current.findIndex((message) => message.id === activeAssistantMessageId);
            if (activeAssistantIndex >= 0) {
              return [
                ...current.slice(0, activeAssistantIndex),
                userMessage,
                ...current.slice(activeAssistantIndex),
              ];
            }
          }

          let trailingAssistantIndex = current.length;
          while (trailingAssistantIndex > 0 && current[trailingAssistantIndex - 1].role === 'assistant') {
            trailingAssistantIndex -= 1;
          }

          if (trailingAssistantIndex < current.length) {
            return [
              ...current.slice(0, trailingAssistantIndex),
              userMessage,
              ...current.slice(trailingAssistantIndex),
            ];
          }

          return [...current, userMessage];
        });
        return;
      }

      currentTurnUserMessageIdRef.current = pendingMessageId;
      setMessages((current) =>
        current.map((message) => (message.id === pendingMessageId ? { ...message, text: trimmedText } : message)),
      );
    },
    [],
  );

  const prepareNewTurn = useCallback(() => {
    assistantTextBeforeCurrentTurnRef.current = lastAssistantTextRef.current;
    resetTurnTrace();
    activeAssistantMessageIdRef.current = null;
    currentTurnUserMessageIdRef.current = null;
    currentTurnToolNamesRef.current.clear();
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
    (id: string, patch: Partial<SupplyToolActivity>) => {
      setTraceToolActivities((current) =>
        current.map((activity) => (activity.id === id ? { ...activity, ...patch } : activity)),
      );
    },
    [setTraceToolActivities],
  );

  const runFunctionCall = useCallback(
    async (itemId: string, call: PendingFunctionCall) => {
      logSupplyRealtimeEvent('internal', {
        type: 'supply.tool_started',
        item_id: itemId,
        call_id: call.callId,
        name: call.name,
      });
      responseGateRef.current.markToolCallStarted(call.callId);
      removePrematureAssistantMessagesForToolTurn();
      const isAddToCartCall = call.name === 'add_to_cart';
      const relevantAssistantText = `${assistantTextBeforeCurrentTurnRef.current} ${lastAssistantTextRef.current}`;
      const hasAddToCartIntent =
        !isAddToCartCall || isExplicitAddToCartIntent(lastUserTextRef.current, relevantAssistantText);
      const shouldShowToolActivity = !isAddToCartCall || hasAddToCartIntent;

      if (shouldShowToolActivity) {
        setTraceToolActivities((current) => [
          ...current,
          {
            id: itemId,
            name: call.name,
            label: formatToolChip(call.name),
            status: 'running',
          },
        ]);
      }

      try {
        const args = parseToolArguments(call.argumentsText);
        let output: unknown;
        currentTurnToolNamesRef.current.add(call.name);

        if (shouldShowToolActivity) {
          await delay(getToolDelayMs(call.name));
        }

        if (call.name === 'get_hiking_needs') {
          output = agentRef.current.getHikingNeeds();
        } else if (call.name === 'get_saved_profile') {
          output = agentRef.current.getSavedProfile();
        } else if (call.name === 'get_screen_state') {
          output = agentRef.current.getScreenState(args as GetScreenStateRequest);
        } else if (call.name === 'search_products') {
          output = agentRef.current.searchProducts(args as SearchProductsRequest);
        } else if (call.name === 'apply_filters') {
          output = agentRef.current.applyFilters(args as ApplyFiltersRequest);
        } else if (call.name === 'highlight_products') {
          output = await agentRef.current.highlightProducts(args as HighlightProductsRequest);
        } else if (call.name === 'open_product') {
          output = await agentRef.current.openProduct(args as OpenProductRequest);
        } else if (call.name === 'select_quantity') {
          output = agentRef.current.selectQuantity(args as SelectQuantityRequest);
        } else if (call.name === 'select_shoe_size') {
          output = agentRef.current.selectShoeSize(args as SelectShoeSizeRequest);
        } else if (call.name === 'open_size_guide') {
          output = agentRef.current.openSizeGuide();
        } else if (call.name === 'close_size_guide') {
          output = agentRef.current.closeSizeGuide();
        } else if (call.name === 'add_to_cart') {
          if (!hasAddToCartIntent) {
            const snapshot = agentRef.current.getScreenState({ includeProducts: false, includeTargets: false });
            output = {
              status: 'blocked',
              message: 'The shopper has not confirmed adding this item. Ask whether they want it added to cart without calling add_to_cart again.',
              product: snapshot.selectedProduct ?? undefined,
            } satisfies SupplyActionResponse;
          } else {
            output = agentRef.current.addToCart(args as AddToCartRequest);
          }
        } else if (call.name === 'summarize_product_reviews') {
          output = agentRef.current.summarizeProductReviews(args as SummarizeProductReviewsRequest);
        } else if (call.name === 'search_weather_web') {
          output = await agentRef.current.searchWeatherWeb(args as SearchWeatherWebRequest);
        } else if (call.name === 'go_to_cart') {
          output = agentRef.current.goToCart();
        } else if (call.name === 'go_home') {
          output = agentRef.current.goHome();
        } else if (call.name === 'clear_filters') {
          output = agentRef.current.clearFilters();
        } else {
          const fallback: SupplyActionResponse = {
            status: 'blocked',
            message: 'That action is not available.',
          };
          output = fallback;
        }

        sendClientEvent({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.callId,
            output: JSON.stringify(output),
          },
        });
        logSupplyRealtimeEvent('internal', {
          type: 'supply.tool_output_sent',
          item_id: itemId,
          call_id: call.callId,
          name: call.name,
          outputLength: JSON.stringify(output).length,
        });
        requestResponseForToolOutput(call.callId);
        if (shouldShowToolActivity) {
          updateToolActivity(itemId, {
            status: 'done',
            details: collectToolDetails(output),
          });
        }
      } catch {
        const output = { error: 'That action could not be completed.' };
        sendClientEvent({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.callId,
            output: JSON.stringify(output),
          },
        });
        logSupplyRealtimeEvent('internal', {
          type: 'supply.tool_output_sent',
          item_id: itemId,
          call_id: call.callId,
          name: call.name,
          outputLength: JSON.stringify(output).length,
          reason: 'tool_failed',
        });
        requestResponseForToolOutput(call.callId);
        if (shouldShowToolActivity) {
          updateToolActivity(itemId, { status: 'failed' });
        }
      } finally {
        responseGateRef.current.markToolCallFinished(call.callId);
      }
    },
    [
      removePrematureAssistantMessagesForToolTurn,
      requestResponseForToolOutput,
      sendClientEvent,
      setTraceToolActivities,
      updateToolActivity,
    ],
  );

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      logSupplyRealtimeEvent('server', event);

      if (event.type === 'session.updated') {
        setStatus('listening');
        return;
      }

      if (event.type === 'response.created') {
        responseGateRef.current.markResponseCreated(event.response?.id);
        setStatus('speaking');
        activeAssistantMessageIdRef.current = null;
        return;
      }

      if (event.type === 'input_audio_buffer.speech_started') {
        if (!pendingAudioUserMessageIdRef.current) {
          prepareNewTurn();
          startPendingAudioUserMessage();
        }
        audioTurnPreparedRef.current = true;
        return;
      }

      if (event.type === 'input_audio_buffer.speech_stopped') {
        setStatus('speaking');
        return;
      }

      if (event.type === 'response.output_item.added' && event.item?.id) {
        itemPhaseByIdRef.current.set(event.item.id, event.item.phase ?? 'final_answer');

        if (event.item.type === 'function_call' && event.item.call_id && event.item.name) {
          pendingFunctionCallsRef.current.set(event.item.id, {
            name: event.item.name,
            callId: event.item.call_id,
            argumentsText: event.item.arguments ?? '',
          });
        }
        return;
      }

      if (event.type === 'response.function_call_arguments.delta' && event.item_id && event.delta) {
        const call = pendingFunctionCallsRef.current.get(event.item_id);
        if (!call) return;
        pendingFunctionCallsRef.current.set(event.item_id, {
          ...call,
          argumentsText: `${call.argumentsText}${event.delta}`,
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
          setTracePreambleText((current) => `${current}${event.delta}`);
        } else if (event.type === 'response.output_audio_transcript.delta') {
          appendAssistantDelta(event.delta, event.item_id);
        } else {
          bufferedTextByItemIdRef.current.set(
            event.item_id,
            `${bufferedTextByItemIdRef.current.get(event.item_id) ?? ''}${event.delta}`,
          );
        }
        return;
      }

      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        recordRealtimeTranscriptionUsage({
          sessionKey: supplySessionIdRef.current,
          usage: event.usage,
        });
        if (!audioTurnPreparedRef.current && !pendingAudioUserMessageIdRef.current) {
          prepareNewTurn();
        }
        audioTurnPreparedRef.current = false;
        const transcript = event.transcript ?? '';
        completePendingAudioUserMessage(transcript);
        if (transcript.trim()) {
          const sent = requestResponseForUserTurn();
          if (sent) setStatus('speaking');
        }
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
          sessionKey: supplySessionIdRef.current,
          usage: event.response?.usage,
        });
        const pendingResponse = responseGateRef.current.markResponseDone(event.response?.id);
        logSupplyRealtimeEvent('internal', {
          type: 'supply.response_done_gate',
          response_id: event.response?.id,
          reason: pendingResponse.reason,
          gateDecision: pendingResponse.shouldCreateResponse ? 'create_response' : 'no_response',
        });
        if (pendingResponse.shouldCreateResponse) {
          const sent = sendResponseCreate();
          setStatus(sent ? 'speaking' : 'listening');
        } else {
          setStatus('listening');
        }
        return;
      }

      if (event.type === 'error') {
        const errorMessage = event.error?.message ?? 'The assistant had trouble responding.';
        const activeResponseId = getActiveResponseIdFromError(errorMessage);
        if (activeResponseId) {
          responseGateRef.current.markResponseCreated(activeResponseId);
          setStatus('speaking');
          logSupplyRealtimeEvent('internal', {
            type: 'supply.active_response_error_resynced',
            response_id: activeResponseId,
            event_id: event.event_id,
          });
          return;
        }

        responseGateRef.current.markResponseRequestFailed();
        setStatus('error');
        setTraceErrorText(errorMessage);
      }
    },
    [
      appendAssistantDelta,
      completePendingAudioUserMessage,
      prepareNewTurn,
      runFunctionCall,
      requestResponseForUserTurn,
      sendResponseCreate,
      setTraceErrorText,
      setTracePreambleText,
      startPendingAudioUserMessage,
    ],
  );

  const sendSessionUpdate = useCallback(() => {
    registerRealtimeCostTraceSession({
      app: 'supply-co',
      sessionKey: supplySessionIdRef.current,
      realtimeModel: SUPPLY_REALTIME_MODEL,
      transcriptionModel: REALTIME_TRANSCRIPTION_MODEL,
    });
    sendClientEvent({
      type: 'session.update',
      session: createRealtimeSessionConfig({
        model: SUPPLY_REALTIME_MODEL,
        reasoning: SUPPLY_REALTIME_REASONING,
        instructions: SUPPLY_REALTIME_INSTRUCTIONS,
        tools: SUPPLY_REALTIME_TOOLS,
        turnDetection: SUPPLY_REALTIME_TURN_DETECTION,
      }),
    });
  }, [sendClientEvent]);

  const disconnect = useCallback(() => {
    void completeRealtimeCostTraceSession(supplySessionIdRef.current);
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
    itemPhaseByIdRef.current.clear();
    assistantMessageIdByItemIdRef.current.clear();
    bufferedTextByItemIdRef.current.clear();
    responseGateRef.current.reset();
    currentTurnToolNamesRef.current.clear();
    audioTurnPreparedRef.current = false;
    if (pendingAudioUserMessageIdRef.current) {
      const pendingMessageId = pendingAudioUserMessageIdRef.current;
      setMessages((current) => current.filter((message) => message.id !== pendingMessageId));
    }
    pendingAudioUserMessageIdRef.current = null;
    currentTurnUserMessageIdRef.current = null;
    lastUserTextRef.current = '';
    lastAssistantTextRef.current = '';
    assistantTextBeforeCurrentTurnRef.current = '';
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
          setTraceErrorText('The assistant had trouble reading a response.');
        }
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const sdpResponse = await fetch('/api/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          'Content-Type': 'application/sdp',
        },
      });

      if (!sdpResponse.ok) {
        throw new Error('Assistant connection is unavailable right now.');
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
      setTraceErrorText(error instanceof Error ? error.message : 'Assistant connection is unavailable right now.');
      throw error;
    } finally {
      connectPromiseRef.current = null;
    }
  }, [disconnect, handleServerEvent, sendSessionUpdate, setTraceErrorText]);

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
      requestResponseForUserTurn();
      setStatus('speaking');
    },
    [addUserMessage, connect, prepareNewTurn, requestResponseForUserTurn, sendClientEvent],
  );

  useEffect(() => () => disconnect(), [disconnect]);

  const statusLabel = useMemo(() => {
    if (status === 'idle') return 'Connect voice to shop';
    if (status === 'connecting') return 'Connecting';
    if (status === 'listening') return micAvailable ? 'Listening' : 'Ready for typed shopping';
    if (status === 'speaking') return 'Responding';
    return 'Connection issue';
  }, [micAvailable, status]);

  const currentRouteHint = useMemo(() => {
    if (agent.snapshot.screen === 'results') return 'Ask to filter, compare, or highlight a product.';
    if (agent.snapshot.screen === 'product') return 'Ask about size, quantity, or adding this item.';
    if (agent.snapshot.screen === 'cart') return 'Review the items before continuing.';
    return 'Search, compare, or review items in your cart.';
  }, [agent.snapshot.screen]);

  return {
    messages,
    toolActivities,
    status,
    statusLabel,
    preambleText,
    errorText,
    micAvailable,
    currentRouteHint,
    connect,
    disconnect,
    sendTextMessage,
  };
}
