"""Sample Python file — exercises Shiki python + indent-based folding.

The fold-region detector for Python uses leading-whitespace runs rather
than braces (no `{` / `}` in Python).
"""

from __future__ import annotations

import dataclasses
from collections import Counter
from typing import Iterable, Iterator


@dataclasses.dataclass
class Comment:
    id: str
    author: str
    text: str
    resolved: bool = False
    line: int | None = None

    def is_open(self) -> bool:
        return not self.resolved


def histogram(items: Iterable[str]) -> dict[str, int]:
    """Count occurrences of each item, sorted by count descending."""
    counts = Counter(items)
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def chunked(items: list[str], size: int) -> Iterator[list[str]]:
    """Yield successive `size`-sized chunks from `items`."""
    if size <= 0:
        raise ValueError("size must be positive")
    for i in range(0, len(items), size):
        yield items[i : i + size]


def open_count_per_author(comments: list[Comment]) -> dict[str, int]:
    """Per-author count of unresolved comments."""
    return histogram(c.author for c in comments if c.is_open())


# Module-level constants
DEFAULT_PAGE_SIZE = 50
MAX_AUTHOR_NAME = 64


if __name__ == "__main__":
    sample = [
        Comment("c1", "alice", "Looks good"),
        Comment("c2", "alice", "Tighten the loop", resolved=True),
        Comment("c3", "bob", "Add a test"),
        Comment("c4", "bob", "Add another test"),
        Comment("c5", "carol", "Ship it"),
    ]
    for chunk in chunked([c.id for c in sample], 2):
        print(chunk)
    print(open_count_per_author(sample))
