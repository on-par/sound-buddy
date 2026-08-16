// Rule-narrative templating layer (#834): deterministic rule-type-keyed
// template registry + pure placeholder renderer. Stories 2-5 of #375 register
// their rule type's template through registerRuleTemplate; story 6 consumes
// renderRuleNarrative's output. Zero LLM involvement, zero I/O — pure data
// over a module-scoped registry.

export type RuleType = "harshness" | "gate" | "phase" | "gain";

/** Flat, renderer-ready rule-hit data. Number values are stringified at render
 *  time; story copy that needs formatted numbers should pre-format via
 *  `fmt` (format.ts, #429) and pass strings. */
export type RuleNarrativeData = Record<string, string | number | undefined>;

const registry = new Map<RuleType, string>();

const PLACEHOLDER_RE = /\{([^{}]+)\}/g;

function unregisteredTypeError(type: RuleType): Error {
  return new Error(
    `No narrative template registered for rule type "${type}". ` +
      `Register one with registerRuleTemplate("${type}", "…") before rendering.`,
  );
}

export function registerRuleTemplate(type: RuleType, template: string): void {
  registry.set(type, template);
}

export function getRuleTemplate(type: RuleType): string {
  const template = registry.get(type);
  if (template === undefined) throw unregisteredTypeError(type);
  return template;
}

export function renderRuleNarrative(type: RuleType, data: RuleNarrativeData): string {
  const template = getRuleTemplate(type);
  return template.replace(PLACEHOLDER_RE, (_match, key: string) => {
    const value = data[key];
    return value === undefined ? "" : String(value);
  });
}