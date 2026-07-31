export interface ModelRegistration {
  id: string;
  provider?: string;
  enabled: boolean;
  notes: string;
}

const builtInModels: ModelRegistration[] = [
  {
    id: 'google/gemini-3.1-flash-lite',
    enabled: true,
    notes: 'Primary GA production model; supports video, structured output, and enforced ZDR routing',
  },
  {
    id: 'qwen/qwen3-vl-32b-instruct',
    enabled: false,
    notes: 'Disabled: current OpenRouter endpoint does not satisfy the enforced ZDR policy',
  },
  {
    id: 'qwen/qwen3-vl-8b-instruct',
    enabled: false,
    notes: 'Disabled by default until a compatible OpenRouter ZDR route is verified',
  },
];

export function modelRegistry(): ModelRegistration[] {
  const configured = process.env.ANALYSIS_MODEL_REGISTRY_JSON;
  if (!configured) return builtInModels;
  const value = JSON.parse(configured) as ModelRegistration[];
  if (!Array.isArray(value) || value.some((entry) => !entry.id)) {
    throw new Error('ANALYSIS_MODEL_REGISTRY_JSON must be an array of model registrations');
  }
  return value;
}
