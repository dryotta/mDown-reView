import { useMemo } from "react";
import { parseKqlPipeline, formatKql, KQL_OPERATORS } from "@/lib/kql-parser";
import "@/styles/kql-plan.css";

interface KqlPlanViewProps {
  content: string;
}

export function KqlPlanView({ content }: KqlPlanViewProps) {
  const steps = useMemo(() => parseKqlPipeline(content), [content]);
  const formattedQuery = useMemo(() => formatKql(content), [content]);

  if (!content.trim()) {
    return (
      <div className="kql-plan-container">
        <div className="kql-empty">No query to display</div>
      </div>
    );
  }

  // Highlight KQL keywords in formatted query
  const highlightKeywords = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, lineIndex) => {
      const parts: JSX.Element[] = [];
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
    <div className="kql-plan-container">
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
