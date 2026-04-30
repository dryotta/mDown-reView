# 08 · Remote Images

Tests the bounded HTTPS image proxy chokepoint
`fetch_remote_asset` (`src-tauri/src/commands/remote_asset.rs`) — rule 27
in `docs/security.md`. Every `<img src="https://...">` is fetched
through Rust, size-capped, and re-served to the renderer as a blob.

> **First visit**: a per-document allowance prompt may appear ("Allow
> remote images for this file?"). Click **Allow once** to load.
> See `viewerPrefsSlice.allowedRemoteImageDocs` (intentionally not
> persisted — trust decisions don't silently survive a restart).

## GitHub avatars

![GitHub octocat avatar](https://avatars.githubusercontent.com/u/9919?s=200&v=4)

![GitHub Mona avatar](https://avatars.githubusercontent.com/u/5430905?s=200&v=4)

## raw.githubusercontent.com — repo asset

![GitHub Octocat — Hubot logo](https://raw.githubusercontent.com/github/octicons/main/icons/mark-github-16.svg)

## Picsum (random photo, fixed seed)

![Random nature photo, 320×200, seeded](https://picsum.photos/seed/mdownreview1/320/200)

![Same picture different seed](https://picsum.photos/seed/mdownreview2/320/200)

![Square 200×200 seeded](https://picsum.photos/seed/mdownreview3/200/200)

## SVG over HTTPS

![SVG via raw.githubusercontent.com](https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/rust.svg)

## Small icons (favicons)

![Rust favicon](https://www.rust-lang.org/favicon-32x32.png)

## A row of remote images via table

| Source | Image |
|---|---|
| GitHub avatar | ![octocat](https://avatars.githubusercontent.com/u/9919?s=80&v=4) |
| simple-icons (TS) | ![ts](https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/typescript.svg) |
| simple-icons (Rust) | ![rust](https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/rust.svg) |

## Linked remote image

[![Click — Rust homepage](https://www.rust-lang.org/static/images/rust-logo-blk.svg)](https://www.rust-lang.org)

## Trailing checklist

- [ ] First load: per-document allowance prompt appears (or doesn't, per `viewerPrefsSlice.allowedRemoteImageDocs` if you allowed already).
- [ ] All listed images load through the `fetch_remote_asset` proxy (DevTools network tab — request URLs are blob URIs / data URIs proxied by Rust, NOT direct GitHub HTTPS).
- [ ] Image sizes are bounded (rule 27 in `docs/security.md`); large remote images either load or surface a "too large" placeholder, never crash the renderer.
- [ ] Restart the app and reopen this file — the allowance does NOT persist (re-prompts).
- [ ] Disable network and re-open — broken-image placeholder appears (no infinite spinner).
