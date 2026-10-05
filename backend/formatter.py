# ============================================================
#  formatter.py — Convert raw ML LaTeX output to clean expression
#
#  OWNER: [Your Friend B's name]
#
#  This is the bridge between ML output and the evaluator.
#
#  ML model outputs LaTeX-like strings:
#    "1 + 2"           → simple addition
#    "3 \times 4"      → multiplication
#    "1 0 \div 5"      → division (10 ÷ 5)
#    "\frac { 3 } { 4 }" → fraction (3/4)
#    "2 ^ { 3 }"       → exponent (2^3)
#
#  This module converts them to evaluator-ready strings:
#    "1+2", "3*4", "10/5", "(3/4)", "2**3"
# ============================================================


def format_expression(raw_latex: str) -> dict:
    """
    MAIN FUNCTION — called by app.py

    Takes raw LaTeX string from ML model.
    Returns a dict:
        {
            "expression": "7+3",    # clean math expression
            "latex": "7 + 3",       # original for display
            "ready": True           # signal for evaluator
        }
    """
    if not raw_latex or not raw_latex.strip():
        return {"expression": "", "latex": "", "ready": False}

    latex = raw_latex.strip()

    # --- NEW: Check if the user has drawn an equals sign ---
    if "=" not in latex:
        return {"expression": "", "latex": latex, "ready": False}

    # Extract everything BEFORE the first equals sign for the math expression
    expression = latex.split("=")[0].strip()

    # --- Step 1: Replace LaTeX operators with Python math ---
    expression = expression.replace("\\times", "*")
    expression = expression.replace("\\div", "/")
    expression = expression.replace("\\pm", "+")  # simplify ± to +

    # --- Step 2: Handle fractions: \frac { a } { b } → (a/b) ---
    expression = _convert_fractions(expression)

    # --- Step 3: Handle exponents: a ^ { b } → a**b ---
    expression = expression.replace("^", "**")

    # --- Step 4: Remove remaining LaTeX braces and spaces ---
    expression = expression.replace("{", "(")
    expression = expression.replace("}", ")")
    expression = expression.replace(" ", "")

    # --- Step 5: Clean up empty parentheses or dangling operators ---
    expression = expression.replace("()", "")

    return {
        "expression": expression,
        "latex": latex,
        "ready": bool(expression.strip())
    }


def _convert_fractions(expr: str) -> str:
    """
    Convert \\frac { numerator } { denominator } → (numerator/denominator)

    This is a simple version — handles basic cases.
    Your friend can improve this to handle nested fractions later.
    """
    result = expr
    while "\\frac" in result:
        idx = result.index("\\frac")
        rest = result[idx + 5:].strip()

        # Find first { } pair (numerator)
        num, after_num = _extract_braced(rest)
        if num is None:
            break

        # Find second { } pair (denominator)
        den, after_den = _extract_braced(after_num.strip())
        if den is None:
            break

        # Replace \frac{num}{den} with (num/den)
        fraction_str = f"({num}/{den})"
        result = result[:idx] + fraction_str + after_den

    return result


def _extract_braced(s: str) -> tuple:
    """
    Extract content between first { and matching }.
    Returns (content, rest_of_string) or (None, None).
    """
    if not s or s[0] != "{":
        return None, None

    depth = 0
    for i, c in enumerate(s):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return s[1:i], s[i + 1:]

    return None, None
