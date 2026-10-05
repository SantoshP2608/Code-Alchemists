Standalone ink-on image recognition test

1. Install Python 3.11 or 3.12.
2. Open a terminal in this extracted folder.
3. Run: python -m pip install -r requirements.txt
4. Save a tightly cropped, single-line handwritten equation as equation.png.
   Use dark handwriting on plain white paper, with no notebook lines or shadows.
5. Run: python recognize.py equation.png

The program prints the model's recognized LaTeX string. It does not calculate.
For white handwriting on black paper: python recognize.py equation.png --light-on-dark
An image path containing spaces should be enclosed in double quotes.

The three pretrained model/vocabulary files are included in models/.
Source: https://github.com/kimseungdae/ink-on
Upstream model: CoMER (ECCV 2022), https://github.com/Green-Wood/CoMER
ink-on repository revision: see SOURCE-REVISION.txt.
The ink-on license is included in INK-ON-LICENSE.txt.

This script adapts ink-on's input conventions to a raster image and uses
arithmetic vocabulary masking with beam width 3. It does not reproduce the
demo's stroke preprocessing or LaTeX repair. Recognition accuracy is not
guaranteed, especially for photographs; begin with a clean drawing export.
Python is for this local model test. The final CalcInk application must run
its recognition in the browser to meet the project requirement.
