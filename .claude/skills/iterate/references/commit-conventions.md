## Commit conventions

| Situation | Mode | Message |
|---|---|---|
| Iteration impl | Issue | `feat(#<N>): iter <iteration> — <summary>\n\n<body>\n\nRefs #<N>\n\nCo-authored-by: Claude Opus 4.7 <noreply@anthropic.com>` |
| Iteration impl | Goal | `auto-improve: iter <iteration> — <summary>\n\n<body>\n\nCo-authored-by: Claude Opus 4.7 <noreply@anthropic.com>` |
| Forward-fix in iteration | Either | `fix(iter-<iteration>): <summary>` |
| Rebase repair | Either | `fix(rebase): <summary>` |
| Release-gate forward-fix | Either | `fix(iter-release): <summary>` |
| Retrospective (8.5c) | Either | `chore(iter-<iteration>): retrospective\n\n<retro title>` |

No "final" iteration commit — `achieved` skips Steps 3–8. Step 8.5 is the LAST commit of every iteration that ran 3–8 (DEGRADED/SKIPPED also write retros). Phase 2 does NOT push to the iterate branch — its artefact is the new GitHub issue (and optional recursion). Issue closure on merge is driven by the `Closes #<N>` trailer in the PR body (set in 0g), not commit messages.

---
