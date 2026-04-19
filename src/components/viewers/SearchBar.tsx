import { useRef, useEffect } from "react";
import "@/styles/search-bar.css";

interface Props {
  query: string;
  matchCount: number;
  currentIndex: number;
  onQueryChange: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function SearchBar({ query, matchCount, currentIndex, onQueryChange, onNext, onPrev, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="search-bar" role="search">
      <input
        ref={inputRef}
        type="text"
        className="search-bar-input"
        placeholder="Find..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="search-bar-count">
        {query && matchCount > 0 && `${currentIndex + 1} of ${matchCount}`}
        {query && matchCount === 0 && <span className="search-bar-no-results">No results</span>}
      </span>
      <button className="search-bar-btn" onClick={onPrev} aria-label="Previous match" disabled={matchCount === 0}>▲</button>
      <button className="search-bar-btn" onClick={onNext} aria-label="Next match" disabled={matchCount === 0}>▼</button>
      <button className="search-bar-btn" onClick={onClose} aria-label="Close search">✕</button>
    </div>
  );
}
