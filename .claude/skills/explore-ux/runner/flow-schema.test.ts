import { describe, it, expect } from "vitest";
import { parseFlowCatalogue } from "./flow-schema";

const SAMPLE = `# Catalogue

## comment-add

\`\`\`yaml
id: comment-add
name: Add a comment
priority: 1
preconditions:
  - one file is open
steps:
  - { kind: click, selector: "button[aria-label='Add comment']" }
success_signal:
  selector: ".comment-thread .comment:last-child"
\`\`\`

## tab-switch

\`\`\`yaml
id: tab-switch
name: Switch tabs
priority: 2
steps:
  - { kind: press, key: "Control+Tab" }
\`\`\`
`;

describe("parseFlowCatalogue", () => {
  it("extracts every flow as typed object", () => {
    const flows = parseFlowCatalogue(SAMPLE);
    expect(flows).toHaveLength(2);
    expect(flows[0]).toMatchObject({ id: "comment-add", priority: 1 });
    expect(flows[0].steps[0]).toEqual({
      kind: "click",
      selector: "button[aria-label='Add comment']",
    });
    expect(flows[1].id).toBe("tab-switch");
  });

  it("rejects unknown step kinds", () => {
    const bad = SAMPLE.replace("kind: click", "kind: explode");
    expect(() => parseFlowCatalogue(bad)).toThrow(/unknown step kind/i);
  });

  it("requires id and steps on every flow", () => {
    const noId = "## x\n```yaml\nname: bad\nsteps: []\n```\n";
    expect(() => parseFlowCatalogue(noId)).toThrow(/id/);
  });
});
