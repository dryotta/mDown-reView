export function IconFile() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M3.75 1.5A1.25 1.25 0 002.5 2.75v10.5c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25V5.5L9.5 1.5H3.75zM9 2l3.5 3.5H9.75a.75.75 0 01-.75-.75V2z" />
      </svg>
    </span>
  );
}

export function IconFolder() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M1.75 2.5A1.25 1.25 0 00.5 3.75v8.5c0 .69.56 1.25 1.25 1.25h12.5c.69 0 1.25-.56 1.25-1.25V5.25c0-.69-.56-1.25-1.25-1.25H7.56L6.28 2.72A.75.75 0 005.75 2.5H1.75z" />
      </svg>
    </span>
  );
}

export function IconComment() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 2.75A1.75 1.75 0 012.75 1h10.5A1.75 1.75 0 0115 2.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.9 2.47A.75.75 0 015 13.94V12H2.75A1.75 1.75 0 011 10.25v-7.5zM2.75 2.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25H5.5a.75.75 0 01.75.75v1.557l2.1-1.786a.75.75 0 01.488-.181h4.412a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25H2.75z" />
      </svg>
    </span>
  );
}

export function IconSettings() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 4.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM6 8a2 2 0 114 0 2 2 0 01-4 0zM6.94.5a.75.75 0 00-.74.62l-.2 1.16a5.97 5.97 0 00-1.34.78l-1.1-.42a.75.75 0 00-.92.34L1.42 4.66a.75.75 0 00.18.96l.93.74a6.04 6.04 0 000 1.28l-.93.74a.75.75 0 00-.18.96l1.22 1.68c.2.27.55.39.92.34l1.1-.42c.41.32.86.58 1.34.78l.2 1.16c.06.36.38.62.74.62h2.12c.36 0 .68-.26.74-.62l.2-1.16c.48-.2.93-.46 1.34-.78l1.1.42c.37.05.72-.07.92-.34l1.22-1.68a.75.75 0 00-.18-.96l-.93-.74a6.04 6.04 0 000-1.28l.93-.74a.75.75 0 00.18-.96l-1.22-1.68a.75.75 0 00-.92-.34l-1.1.42a5.97 5.97 0 00-1.34-.78l-.2-1.16A.75.75 0 009.06.5H6.94z" />
      </svg>
    </span>
  );
}

// Floppy-disk save icon. Issue #352 / iter-5 user-reported — Save
// button moved from the per-viewer toolbar to the top app toolbar.
// Iter-7: replaced the prior bowdlerised path with a clean,
// recognisable floppy-disk silhouette (square body, write-tab notch,
// inner label area) at the same 16-px viewBox as the other icons.
export function IconSave() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
        {/* Outer floppy body */}
        <path d="M2.5 1.75A1.75 1.75 0 0 1 4.25 0h7.086c.464 0 .908.184 1.236.513l1.915 1.915c.328.328.513.772.513 1.236V14.25A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25V2.5c0-.41.166-.78.5-1.05V1.75ZM4.25 1.5a.25.25 0 0 0-.25.25V14.25c0 .138.112.25.25.25h.75v-4.75A1.75 1.75 0 0 1 6.75 8h2.5a1.75 1.75 0 0 1 1.75 1.75V14.5h2a.25.25 0 0 0 .25-.25V3.664a.25.25 0 0 0-.073-.177L11.512 1.573a.25.25 0 0 0-.176-.073H10.5v3.25a1.75 1.75 0 0 1-1.75 1.75h-3.5A1.75 1.75 0 0 1 3.5 4.75V1.5h.75ZM5 1.5v3.25c0 .138.112.25.25.25h3.5a.25.25 0 0 0 .25-.25V1.5H5Zm.5 13h5v-4.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25V14.5Z" />
      </svg>
    </span>
  );
}