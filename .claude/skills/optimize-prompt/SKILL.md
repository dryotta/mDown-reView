---
name: optimize-prompt
description: Use when authoring or editing a skill (SKILL.md), subagent definition, slash command, system prompt, CLAUDE.md/AGENTS.md instruction block, or any reusable prompt the user is about to save. Trigger on phrases like "create/update skill", "write/edit agent", "tweak this prompt", "tighten this", or whenever the user pastes prompt-shaped text and asks for review. Rewrites for clarity, triggering accuracy, and token efficiency without losing intent.
---

# optimize-prompt

Tighten prompts so the model triggers them at the right time, follows them under pressure, and burns minimal tokens doing so.

## When this applies

Any reusable text-to-model artifact:
- Skill `SKILL.md` (frontmatter + body)
- Subagent definitions (`.claude/agents/*.md`)
- Slash commands, hook prompts
- `CLAUDE.md` / `AGENTS.md` sections
- Long user prompts the user wants to save or reuse

If the artifact is a one-shot question, skip — this is for prompts that will run repeatedly.

## Workflow

1. Read the artifact and identify its kind (skill / agent / instruction block / freeform).
2. Diagnose against the rules below. Note each issue with the rule it violates.
3. Rewrite. Keep the author's voice and any domain specifics.
4. Show a concise diff: bullet list of what changed and why, then the rewritten text in a fenced block. End with token deltas (`wc -w` before/after) so the user sees the win.
5. Stop. Do not also implement features the prompt describes — this skill optimizes the prompt itself.

## Rules

### Description / triggering (skills + agents)

- **Description states WHEN, not WHAT.** A description that summarizes the workflow makes the model shortcut to the description and skip the body. Lead with "Use when…" and list concrete triggers, symptoms, file types, or user phrases. (See [obra/superpowers `writing-skills`](https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md).)
- **Be specific and slightly pushy.** Models under-trigger skills. Name the situations explicitly ("even if the user doesn't say 'X' directly").
- **Third person, imperative.** "Use when implementing…" not "I help you implement…".
- **Keep frontmatter under ~1024 chars**, name uses `[a-z0-9-]` only.

### Body

- **Imperative mood, short sentences.** "Read the file. Identify X. Rewrite." beats "You should probably consider reading…".
- **Explain the WHY for non-obvious rules.** A one-line rationale lets the model reason about edge cases instead of pattern-matching. Skip rationale for trivially obvious rules.
- **Avoid shouty `MUST`/`NEVER`/`ALWAYS` unless the rule is genuinely non-negotiable.** Overuse trains the model to ignore them. Reserve for hard invariants (security, data loss, irreversible ops).
- **One excellent example beats three mediocre ones.** Cut redundant examples that demonstrate the same pattern.
- **Push heavy reference material out.** API tables, long schemas, large code samples → a sibling file in `references/` or `assets/`, linked from the body. Keeps the always-loaded surface small.
- **Cross-reference, don't duplicate.** If another skill already covers it, link by name (`superpowers:test-driven-development`) — do not restate.
- **Tables > prose for lookup data.** Prose > tables for reasoning.
- **Aim for <200 lines** for the body; <500 is the hard ceiling. Frequently-loaded skills should be <200 words total.

### Token-efficiency edits (apply on every pass)

- Cut hedges: "please", "kindly", "if possible", "feel free to", "I think", "perhaps", "just", "really".
- Cut self-reference: "this skill will…", "in this document we…". The model knows where it is.
- Cut throat-clearing: "It is important to note that…", "Keep in mind that…" — state the rule directly.
- Collapse synonyms: "clear, concise, and brief" → "concise".
- Replace narrative with structure: bullets, tables, fenced code, numbered steps.
- Strip emoji unless the user asked for them.
- Remove dated commentary ("recently we found…", "as of 2024…") unless the date matters.

### Anti-patterns to flag

| Anti-pattern | Fix |
|---|---|
| Description summarizes workflow | Move workflow to body; keep description = triggers only |
| Body restates what the description says | Delete the duplication |
| Wall of `MUST` / `NEVER` | Demote to plain imperative; keep caps for true invariants |
| Multi-language examples (JS + Py + Go) | Pick one language; the model can port |
| Narrative ("last week we tried…") | Convert to a rule + one-line rationale |
| Unbounded reference material inline | Move to `references/<topic>.md`, link with one-line summary |
| Vague triggers ("for async stuff") | Replace with concrete symptoms / file types / user phrases |

## Output format

Reply with three sections in this order:

```
## Changes
- <bullet>: <why>
- <bullet>: <why>

## Optimized
<fenced block with the rewritten artifact, full file contents>

## Token delta
before: <N words> · after: <M words> · saved: <N-M> (<pct>%)
```

If the artifact is already lean, say so plainly and skip the rewrite — do not invent changes to look productive.

## Example

**Input** (excerpt from a skill description):

> This is an extremely powerful skill that helps you with reviewing pull requests by carefully analyzing the diff and providing comments. You should ALWAYS use this whenever you're doing a PR review, and you MUST follow every step.

**Optimized:**

> Use when reviewing a pull request, GitHub diff, or `gh pr view` output, or when the user asks for code review on a branch.

Why: removed self-praise ("extremely powerful"), removed workflow summary ("analyzing the diff and providing comments" — that goes in the body), dropped shouty `ALWAYS`/`MUST`, replaced with concrete triggers (`gh pr view`, "branch"). 38 words → 24 words.

## When not to rewrite

- The artifact is already under target length and reads cleanly. Say so.
- The user wants stylistic feedback only, not a rewrite. Give bullets, not a new draft.
- The "prompt" is actually code, config, or documentation prose for humans. Decline and explain.
