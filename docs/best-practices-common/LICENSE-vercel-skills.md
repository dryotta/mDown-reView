# Attribution: vercel-labs/agent-skills

The contents of `docs/best-practices-common/` (excluding this file and `README.md`) are distilled and reproduced verbatim from the [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) repository, specifically from the `composition-patterns` and `react-best-practices` skills. Rule IDs, headings, code examples, and prose are preserved as-is to keep this documentation in lockstep with the upstream source.

Both upstream skills declare `license: MIT` in their `SKILL.md` frontmatter. © Vercel.

For the full upstream license text, see <https://github.com/vercel-labs/agent-skills/blob/main/LICENSE>.

## Standard MIT License (reproduced for convenience)

```
MIT License

Copyright (c) Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Modifications

The following modifications were made when distilling upstream content into this directory:

- Sections were grouped into per-topic files (`rerender-optimization.md`, `rendering-performance.md`, etc.) instead of one monolithic `AGENTS.md`.
- Headings were rewritten from `### N.M Title` to `` ### `rule-id` -- Title `` to make rule IDs the primary anchor.
- Next.js-specific rules (e.g., `next/dynamic` from §2.4 of `react-best-practices`) were omitted because mdownreview uses Vite, not Next.js.
- React 19 rules from `composition-patterns` §4 and `react-best-practices` §8 were consolidated into `react/react19-apis.md`.
- A short header was added to each file with project context and a link back to upstream.

No code examples or rule prose were modified.
