import { useStore, useUnresolvedCount } from "@/store";
import "@/styles/tab-bar.css";
import { basename } from "@/lib/path-utils";

function TabItem({ path }: { path: string }) {
  const activeTabPath = useStore((s) => s.activeTabPath);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const unresolvedCount = useUnresolvedCount(path);
  const isActive = activeTabPath === path;
  const name = basename(path);

  return (
    <div
      className={`tab${isActive ? " active" : ""}`}
      title={path}
      onClick={() => setActiveTab(path)}
      role="tab"
      aria-selected={isActive}
    >
      <span className="tab-name">{name}</span>
      {unresolvedCount > 0 && (
        <span className="tab-badge" data-testid="comment-badge">{unresolvedCount}</span>
      )}
      <button
        className="tab-close"
        aria-label={`Close ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          closeTab(path);
        }}
      >
        ×
      </button>
    </div>
  );
}

export function TabBar() {
  const tabs = useStore((s) => s.tabs);

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <TabItem key={tab.path} path={tab.path} />
      ))}
    </div>
  );
}
