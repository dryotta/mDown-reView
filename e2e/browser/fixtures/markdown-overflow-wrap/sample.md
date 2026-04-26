# Overflow wrap fixture (#91)

Inline backticked paths and tokens must wrap so the page does not scroll horizontally.

- **Concrete viewers:** `src/components/viewers/{MarkdownViewer,SourceView,EnhancedViewer,MermaidView,JsonTreeView,CsvTableView,HtmlPreviewView,KqlPlanView,ImageViewer,BinaryPlaceholder,HexView,TooLargePlaceholder,DeletedFileViewer}.tsx`
- Long inline code without slashes: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`

## Fenced code keeps horizontal scroll

```bash
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Long table cell wraps

| Path | Description |
| --- | --- |
| `src/components/viewers/{MarkdownViewer,SourceView,EnhancedViewer,MermaidView,JsonTreeView}.tsx` | Concrete viewer modules |
