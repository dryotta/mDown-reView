-- Sample SQL — exercises Shiki sql highlighting.

CREATE TABLE comments (
    id            CHAR(26)     PRIMARY KEY,
    author_email  VARCHAR(255) NOT NULL,
    document      VARCHAR(512) NOT NULL,
    text_body     TEXT         NOT NULL,
    resolved      BOOLEAN      NOT NULL DEFAULT FALSE,
    anchor        JSONB        NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT comments_anchor_kind_check
        CHECK (anchor->>'kind' IN ('line', 'file', 'word_range', 'image_rect',
                                   'csv_cell', 'json_path', 'html_range',
                                   'html_element', 'unknown'))
);

CREATE INDEX comments_document_open_idx
    ON comments (document)
    WHERE resolved = FALSE;

CREATE INDEX comments_author_recent_idx
    ON comments (author_email, created_at DESC);

-- Top 10 reviewers by open-comment count
SELECT  author_email,
        COUNT(*)            AS open_count,
        COUNT(DISTINCT document) AS doc_count,
        MAX(created_at)     AS most_recent
FROM    comments
WHERE   resolved = FALSE
GROUP BY author_email
ORDER BY open_count DESC
LIMIT   10;

-- Comments by anchor kind (sanity check on schema-versioning + migration)
SELECT  anchor->>'kind' AS anchor_kind,
        COUNT(*)        AS n,
        COUNT(DISTINCT document) AS docs
FROM    comments
GROUP BY anchor->>'kind'
ORDER BY n DESC;
