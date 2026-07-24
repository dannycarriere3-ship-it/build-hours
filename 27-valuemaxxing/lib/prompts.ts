import labPrompts from "@/data/lab-prompts.json";

export const LAB_PROMPTS = labPrompts;

export function fillPromptTemplate(
  template: string,
  values: Record<string, string>,
) {
  return template.replace(/{{([A-Z_]+)}}/g, (_, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`The prompt template references an unknown value: ${name}.`);
    }

    return values[name];
  });
}
