import yaml from "js-yaml";

export type StepKind =
  | "click" | "type" | "press" | "hover" | "goto" | "wait" | "resize" | "emit" | "cli";

export interface FlowStep {
  kind: StepKind;
  selector?: string;
  text?: string;
  key?: string;
  url?: string;
  ms?: number;
  width?: number;
  height?: number;
  event?: string;
  args?: string[];
}

export interface Flow {
  id: string;
  name: string;
  priority: 1 | 2 | 3;
  preconditions?: string[];
  steps: FlowStep[];
  success_signal?: { selector: string };
  recovery?: FlowStep[];
}

const STEP_KINDS = new Set<StepKind>([
  "click","type","press","hover","goto","wait","resize","emit","cli",
]);

export function parseFlowCatalogue(md: string): Flow[] {
  const flows: Flow[] = [];
  const blockRe = /```yaml\s*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(md)) !== null) {
    const obj = yaml.load(m[1]) as Partial<Flow> | undefined;
    if (!obj || typeof obj !== "object") continue;
    if (!obj.id) throw new Error("flow missing id");
    if (!Array.isArray(obj.steps)) throw new Error(`flow ${obj.id} missing steps`);
    for (const s of obj.steps as FlowStep[]) {
      if (!STEP_KINDS.has(s.kind)) {
        throw new Error(`unknown step kind: ${s.kind} in flow ${obj.id}`);
      }
    }
    flows.push({
      id: obj.id,
      name: obj.name ?? obj.id,
      priority: (obj.priority ?? 2) as 1 | 2 | 3,
      preconditions: obj.preconditions,
      steps: obj.steps as FlowStep[],
      success_signal: obj.success_signal,
      recovery: obj.recovery,
    });
  }
  return flows;
}
