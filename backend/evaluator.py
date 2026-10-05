# ============================================================
#  evaluator.py — Python wrapper around the C++ evaluator
#
#  Person A wrote the math evaluator in C++ (evaluate.cpp).
#  This wrapper calls the compiled binary via subprocess
#  so the rest of our Python codebase can use it seamlessly.
#
#  The C++ evaluator uses the Shunting-Yard algorithm:
#    1. Tokenizes the expression
#    2. Converts infix → postfix (reverse Polish notation)
#    3. Evaluates the postfix stack
#    4. Handles: +, -, *, /, (), unary +/-, decimals
#    5. Error handling: division by zero, mismatched parens, etc.
# ============================================================

import subprocess
import os
from pathlib import Path

# Path to the compiled C++ evaluator
EVALUATOR_EXE = Path(__file__).resolve().parent / "evaluate.exe"


def evaluate(expression: str) -> dict:
    """
    Evaluate a math expression using the C++ evaluator.

    Input:  expression string like "7+3" or "(10+2)/3"
    Output: dict { "expression": "7+3", "result": 10 }

    How it works:
      1. We pipe the expression string into evaluate.exe via stdin
      2. The C++ program prints just the number (or "ERROR: ...")
      3. We read stdout and parse the result
    """
    if not expression or not expression.strip():
        return {"expression": "", "result": "Nothing to evaluate"}

    # Check that the compiled binary exists
    if not EVALUATOR_EXE.exists():
        return {
            "expression": expression,
            "result": "Error: evaluate.exe not found — compile with: g++ -o evaluate.exe evaluate.cpp -std=c++17"
        }

    try:
        # Run the C++ evaluator as a subprocess
        # - input: the expression string
        # - capture stdout for the result
        # - timeout after 5 seconds (safety net for infinite loops)
        proc = subprocess.run(
            [str(EVALUATOR_EXE)],
            input=expression,
            capture_output=True,
            text=True,
            timeout=5
        )

        output = proc.stdout.strip()

        if not output:
            return {"expression": expression, "result": "No output from evaluator"}

        # Check if the C++ program returned an error
        if "Error:" in output:
            error_msg = output.split("Error:")[-1].strip()
            return {"expression": expression, "result": f"Error: {error_msg}"}

        # Parse the numeric result from your friend's "Result: <number>" format
        try:
            # Find the line containing "Result:"
            result_line = next(line for line in output.split('\n') if "Result:" in line)
            result_str = result_line.split("Result:")[1].strip()
            result = float(result_str)

            # Clean up: show "10" not "10.0"
            if result == int(result):
                result = int(result)

            return {"expression": expression, "result": result}
        except Exception:
            return {"expression": expression, "result": f"Error parsing evaluator output: {output}"}

    except subprocess.TimeoutExpired:
        return {"expression": expression, "result": "Error: Evaluation timed out"}
    except ValueError:
        return {"expression": expression, "result": f"Error: Unexpected output '{output}'"}
    except Exception as e:
        return {"expression": expression, "result": f"Error: {str(e)}"}
