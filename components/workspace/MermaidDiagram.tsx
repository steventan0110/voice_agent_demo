"use client";

import { useEffect, useState } from "react";

type MermaidDiagramProps = {
  source: string;
  title: string;
};

let renderSequence = 0;

function cleanMermaidSource(source: string) {
  return source
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export function MermaidDiagram({ source, title }: MermaidDiagramProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const renderId = `canvas-mermaid-${renderSequence++}`;

    async function renderDiagram() {
      setSvg(null);
      setError(null);

      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "base",
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          flowchart: {
            htmlLabels: false,
            useMaxWidth: true,
            curve: "basis",
            diagramPadding: 4,
            nodeSpacing: 18,
            rankSpacing: 28,
          },
          themeVariables: {
            primaryColor: "#f7f8fa",
            primaryBorderColor: "#cbd0d8",
            primaryTextColor: "#17191d",
            lineColor: "#6f747d",
            secondaryColor: "#e8f3ff",
            tertiaryColor: "#fff9ed",
            fontSize: "13px",
          },
        });

        const cleanedSource = cleanMermaidSource(source);
        const { svg: renderedSvg } = await mermaid.render(renderId, cleanedSource);
        if (!cancelled) setSvg(renderedSvg);
      } catch (renderError) {
        if (cancelled) return;
        setError(renderError instanceof Error ? renderError.message : "Mermaid syntax could not be rendered.");
      }
    }

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div className="mermaid-error" role="alert">
        <strong>流程图语法需要修正</strong>
        <p>{error}</p>
        <pre>{cleanMermaidSource(source)}</pre>
      </div>
    );
  }

  if (!svg) {
    return <div className="mermaid-loading">正在渲染流程图…</div>;
  }

  return (
    <div
      className="mermaid-diagram"
      role="img"
      aria-label={title}
      // Mermaid securityLevel=strict encodes HTML labels and disables click actions.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
