import type { RealtimeAssistantConfig, RealtimeTurnDetectionConfig } from '../realtimeSessionConfig';

export const SUPPLY_REALTIME_MODEL = 'gpt-realtime-2';
export const SUPPLY_REALTIME_REASONING = {
  effort: 'low',
} satisfies NonNullable<RealtimeAssistantConfig['reasoning']>;

export const SUPPLY_REALTIME_TURN_DETECTION = {
  type: 'semantic_vad',
  eagerness: 'low',
  interrupt_response: false,
  create_response: false,
} satisfies RealtimeTurnDetectionConfig;
