# Persistent GitHub identifiers

The skill was renamed from `explore-ux` to `test-exploratory-e2e` but the following identifiers remain `explore-ux` so existing GitHub state (issues #127, #128, #129 and the screenshot evidence branch) keeps working:

- GitHub label: `explore-ux`
- Issue title prefix: `[explore-ux] …`
- Body marker for dedupe: `<!-- explore-ux:group=<g> -->`
- Evidence orphan branch: `explore-ux-evidence`
- Body footer text: "explore-ux run id: …"

If you ever need to migrate, **rename the GitHub label first**, then update `runner/issues.ts` and `runner/evidence.ts` constants, then re-render every open issue body via `file-grouped.ts --update`.
