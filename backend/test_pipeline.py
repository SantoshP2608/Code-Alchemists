from formatter import format_expression
from evaluator import evaluate

tests = [
    '7 + 3',
    '1 0 \\times 5',
    '1 2 \\div 4',
    '- 5 + 3',
]

for t in tests:
    fmt = format_expression(t)
    res = evaluate(fmt["expression"])
    print(f"  ML output: {t!r}")
    print(f"  Formatted: {fmt['expression']}")
    print(f"  Result:    {res['result']}")
    print()
