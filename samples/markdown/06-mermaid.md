# 06 · Mermaid diagrams

Inline `` ```mermaid `` fences render via the same lazy `MermaidView`
chunk used by stand-alone `.mmd` files (see
`src/components/viewers/markdown/MarkdownComponentsMap.tsx::MermaidEmbed`).

> **Note:** Mermaid runs with `securityLevel: "strict"` (rule 15 in
> `docs/security.md`), so click-events / `onMermaidClick` callbacks are
> intentionally not wired.

## Flowchart

```mermaid
flowchart LR
    A[User opens folder] --> B{Tabs persist?}
    B -- yes --> C[Restore tabs from Zustand]
    B -- no --> D[Show empty workspace]
    C --> E[Open active tab]
    D --> E
    E --> F[Markdown renderer]
    E --> G[Source viewer]
    E --> H[Mermaid viewer]
    F --> I([Done])
    G --> I
    H --> I
```

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant FE as Frontend
    participant TC as tauri-commands.ts
    participant BD as bindings.ts
    participant CM as Rust commands.rs
    participant CO as core/sidecar
    FE->>TC: addComment(args)
    TC->>BD: invoke('add_comment', args)
    BD->>CM: dispatch
    CM->>CO: with_sidecar_or_create(...)
    CO-->>CM: Result<MrsfSidecar>
    CM-->>BD: Result<T, E>
    BD-->>TC: unwrap → Promise<T>
    TC-->>FE: T
    Note right of CM: also emits<br/>'comments-changed'
```

## State diagram

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Ready: gh pr ready
    Ready --> Merging: release-gate green
    Merging --> Merged: gh pr merge
    Merging --> Draft: gate failed → forward-fix
    Merged --> [*]
```

## Class diagram

```mermaid
classDiagram
    class MrsfSidecar {
        +String mrsf_version
        +String document
        +Vec~MrsfComment~ comments
        +open(Path) Result~Option~Self~~
        +save(Path) Result~()~
    }
    class MrsfComment {
        +String id
        +String author
        +String timestamp
        +String text
        +bool resolved
        +Anchor anchor
    }
    class Anchor {
        <<enumeration>>
        Line
        WordRange
        File
        ImageRect
        CsvCell
        JsonPath
        HtmlRange
        HtmlElement
        Unknown
    }
    MrsfSidecar "1" *-- "*" MrsfComment
    MrsfComment "1" --> "1" Anchor
```

## Pie chart

```mermaid
pie showData
    title Iteration outcomes (last 12 PRs)
    "Done-Achieved" : 8
    "Done-Blocked" : 1
    "Done-TimedOut" : 1
    "Done-ForwardFixed" : 2
```

## Gantt

```mermaid
gantt
    title Iterate-loop run timeline
    dateFormat HH:mm
    axisFormat %H:%M
    section Setup
    Pre-flight + branch       :a1, 13:26, 1m
    Draft PR + state file     :a2, after a1, 1m
    section Iteration 1
    Step 1 rebase + sanity    :b1, after a2, 2m
    Step 2 assess             :b2, after b1, 1m
    Step 3 pre-consult        :b3, after b2, 2m
    Step 5 implement waves    :b4, after b3, 5m
    Step 6 validate + CI      :b5, after b4, 12m
    Step 6d forward-fix       :b6, after b5, 4m
    Re-validate + experts     :b7, after b6, 13m
    section Iteration 2
    Re-rebase + assess        :c1, after b7, 2m
    Done-Achieved + Phase 2   :c2, after c1, 2m
```

## ER diagram

```mermaid
erDiagram
    SIDECAR ||--o{ COMMENT : contains
    COMMENT ||--o{ RESPONSE : has
    COMMENT }|..|{ ANCHOR : "tagged by"
    SIDECAR {
        string mrsf_version
        string document
    }
    COMMENT {
        string id
        string author
        string timestamp
        string text
        bool resolved
    }
    RESPONSE {
        string author
        string text
        string timestamp
    }
    ANCHOR {
        string kind
        int line
    }
```

## Trailing checklist

- [ ] Each diagram renders without an "Error rendering" message.
- [ ] Diagrams pick up the active light/dark theme palette (mermaid v10 default theme).
- [ ] No copy button on mermaid blocks (excluded by `MarkdownComponentsMap`).
- [ ] Resizing the window doesn't break the SVG layout.
