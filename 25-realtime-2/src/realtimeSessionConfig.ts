export const REALTIME_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper';
export const REALTIME_OUTPUT_VOICE = 'marin';

export type RealtimeReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type RealtimeVadEagerness = 'low' | 'medium' | 'high' | 'auto';

export interface RealtimeAssistantConfig {
  model: string;
  instructions: string;
  tools: unknown;
  reasoning?: { effort: RealtimeReasoningEffort };
  turnDetection?: RealtimeTurnDetectionConfig;
}

export interface RealtimeTurnDetectionConfig {
  type: 'semantic_vad';
  eagerness: RealtimeVadEagerness;
  interrupt_response: boolean;
  create_response: boolean;
}

export interface RealtimeSessionConfigOptions extends RealtimeAssistantConfig {
  turnDetection?: RealtimeTurnDetectionConfig;
}

export function createRealtimeSessionConfig({
  model,
  instructions,
  tools,
  reasoning,
  turnDetection,
}: RealtimeSessionConfigOptions) {
  return {
    type: 'realtime',
    model,
    ...(reasoning ? { reasoning } : {}),
    instructions,
    output_modalities: ['audio'],
    tool_choice: 'auto',
    tools,
    audio: {
      input: {
        transcription: { model: REALTIME_TRANSCRIPTION_MODEL },
        ...(turnDetection ? { turn_detection: turnDetection } : {}),
      },
      output: {
        voice: REALTIME_OUTPUT_VOICE,
      },
    },
  };
}
