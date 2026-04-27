import React, { useEffect, useMemo, useState } from "react";
import { parseKql, type KqlPipelineStep } from "@/lib/tauri-commands";
import { formatStepsForDisplay } from "@/lib/kql-format";
import { useZoom } from "@/hooks/useZoom";
import "@/styles/kql-plan.css";

interface KqlPlanViewProps {
  content: string;
}

// View-layer presentation metadata: keywords highlighted in the formatted query.
const KQL_OPERATORS = new Set([
  "where",
  "summarize",
  "project",
  "extend",
  "join",
  "count",
  "take",
  "top",
  "sort",
  "order",
  "distinct",
  "render",
  "limit",
  "let",
  "union",
  "mv-expand",
  "parse",
  "evaluate",
  "make-series",
  "print",
]);

export function KqlPlanView({ content }: KqlPlanViewProps) {
  const [steps, setSteps] = useState<KqlPipelineStep[]>([]);
  const { zoom } = useZoom(".kql");

  useEffect(() => {
    if (!content.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when content becomes empty
      setSteps([]);
      return;
    }
    let cancelled = false;
    parseKql(content)
      .then((s) => {
        if (!cancelled) setSteps(s);
      })
      .catch(() => {
        if (!cancelled) setSteps([]);
      });
    return () => {
      cancelled = true;
    };
  }, [content]);

  const formattedQuery = useMemo(() => formatStepsForDisplay(steps), [steps]);

  if (!content.trim()) {
    return (
      <div className="kql-plan-container" data-zoom={zoom} style={{ fontSize: `${zoom * 100}%` }}>
        <div className="kql-empty">No query to display</div>
      </div>
    );
  }

  // Highlight KQL keywords in formatted query
  const highlightKeywords = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, lineIndex) => {
      const parts: React.ReactElement[] = [];
      const words = line.split(/(\s+|\||==|!=|>=|<=|>|<|\(|\)|,)/);

      words.forEach((word, wordIndex) => {
        const trimmed = word.trim().toLowerCase();
        if (word === "|") {
          parts.push(
            <span key={`${lineIndex}-${wordIndex}`} className="kql-pipe">
              {word}
            </span>
          );
        } else if (KQL_OPERATORS.has(trimmed)) {
          parts.push(
            <span key={`${lineIndex}-${wordIndex}`} className="kql-keyword">
              {word}
            </span>
          );
        } else {
          parts.push(<span key={`${lineIndex}-${wordIndex}`}>{word}</span>);
        }
      });

      return (
        <div key={lineIndex}>
          {parts}
          {lineIndex < lines.length - 1 && "\n"}
        </div>
      );
    });
  };

  return (
    <div className="kql-plan-container" data-zoom={zoom} style={{ fontSize: `${zoom * 100}%` }}>
      <div className="kql-formatted-query">{highlightKeywords(formattedQuery)}</div>

      <table className="kql-operator-table">
        <thead>
          <tr>
            <th>Step</th>
            <th>Operator</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step) => (
            <tr key={step.step}>
              <td>{step.step}</td>
              <td>{step.operator}</td>
              <td>{step.details || (step.isSource ? "(source table)" : "")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="kql-plan-footer">{steps.length} operators</div>
    </div>
  );
}
