// Convert LaTeX into arithmetic text for evaluate.cpp.
export function formatLatex(latex) {
  let expression = latex.replace(/\s/g, "");
  // Normalize repeated terminal equals signs.
  expression = expression.replace(/={2,}$/, "=");
  expression = expression.replace(/\\times/g, "*");
  expression = expression.replace(/\\div/g, "/");
  expression = expression.replace(/×/g, "*");
  expression = expression.replace(/÷/g, "/");
  expression = expression.replace(/−/g, "-");

  // Convert inner fractions first, then any surrounding fractions.
  let previous;
  do {
    previous = expression;
    expression = expression.replace(
      /\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
      "($1)/($2)"
    );
  } while (expression !== previous);

  // Also rejects \\pm, ^, _, leftover braces and unknown commands.
  if (/[^0-9.+*/()=\-]/.test(expression)) {
    throw new Error("Unsupported symbol or invalid fraction");
  }

  if (!expression.includes("=")) return null;
  if (expression === "=" || expression.indexOf("=") !== expression.length - 1) {
    throw new Error("End the expression with one =");
  }

  return expression;
}
