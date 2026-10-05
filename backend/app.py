# ============================================================
#  app.py — Flask Backend Server (adapted for Ink-On model)
#
#  The pipeline is now:
#    Canvas image (base64) → InkRecognizer → formatter → evaluator → result
#
#  Run with:  python app.py
# ============================================================

from flask import Flask, request, jsonify
from flask_cors import CORS

from recognizer import InkRecognizer
from formatter import format_expression

# --- Evaluator (Person A's C++ evaluator, called via Python wrapper) ---
from evaluator import evaluate


app = Flask(__name__)
CORS(app)

# Load the ML model ONCE at startup (takes ~1 second)
# Every request reuses this same instance — fast predictions.
print("Loading Ink-On model...")
recognizer = InkRecognizer()
print("Ready!\n")


@app.route("/")
def home():
    return jsonify({"status": "CalcInk backend running"})


@app.route("/predict", methods=["POST"])
def predict():
    """
    Main endpoint.

    Flow:
      1. Receive base64 image from frontend
      2. ML model recognizes → raw LaTeX string
      3. Formatter cleans it → evaluable expression
      4. Evaluator computes → result
      5. Return JSON to frontend
    """
    data = request.get_json()
    if not data or "image" not in data:
        return jsonify({"error": "No image provided"}), 400

    # --- Step 1: ML Recognition ---
    try:
        raw_latex = recognizer.recognize_from_base64(data["image"])
        print(f"  ML raw output: {raw_latex}")
    except ValueError as e:
        return jsonify({"expression": "", "result": str(e)}), 200
    except Exception as e:
        return jsonify({"error": f"Recognition failed: {e}"}), 500

    # --- Step 2: Format the output ---
    formatted = format_expression(raw_latex)
    print(f"  Formatted: {formatted}")

    if not formatted["ready"]:
        return jsonify({
            "status": "waiting", 
            "latex": formatted["latex"],
            "message": "Waiting for '='"
        }), 200

    # --- Step 3: Evaluate (Person A's C++ evaluator via wrapper) ---
    result = evaluate(formatted["expression"])

    # --- Step 4: Return ---
    return jsonify({
        "status": "success",
        "expression": formatted["expression"],
        "latex": formatted["latex"],
        "result": result["result"]
    }), 200


if __name__ == "__main__":
    print("CalcInk backend starting on http://localhost:5000")
    print("Press Ctrl+C to stop\n")
    app.run(debug=True, port=5000)
