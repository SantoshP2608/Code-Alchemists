const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');
const clearBtn = document.getElementById('clearBtn');
const resultText = document.getElementById('resultText');

let isDrawing = false;
let predictTimeout = null;

// Drawing setup
ctx.strokeStyle = '#ffffff';
ctx.lineWidth = 6;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

// Handle both mouse and touch positions
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const clientY = e.clientY || (e.touches && e.touches[0].clientY);
  return { x: clientX - rect.left, y: clientY - rect.top };
}

// --- Drawing Events ---
function startDrawing(e) {
  isDrawing = true;
  const pos = getPos(e);
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  clearTimeout(predictTimeout); // Stop predicting while drawing
}

function draw(e) {
  if (!isDrawing) return;
  e.preventDefault(); // Stop scrolling on touchscreens
  const pos = getPos(e);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
}

function stopDrawing() {
  if (isDrawing) {
    isDrawing = false;
    schedulePrediction();
  }
}

// Mouse events
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseleave', stopDrawing);

// Touch events (for mobile/tablets)
canvas.addEventListener('touchstart', startDrawing, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', stopDrawing);


// --- Auto-Prediction Logic ---
function schedulePrediction() {
  clearTimeout(predictTimeout);
  predictTimeout = setTimeout(runPrediction, 800); // wait 800ms after last stroke
}

async function runPrediction() {
  const imageData = canvas.toDataURL('image/png');
  resultText.textContent = '⏳ Looking...';
  resultText.style.color = '#888';

  try {
    const response = await fetch('http://localhost:5000/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageData })
    });
    const data = await response.json();

    if (data.status === 'waiting') {
      resultText.textContent = `Seeing: ${data.latex} (Draw '=' to solve)`;
      resultText.style.color = '#a78bfa';
    } else if (data.status === 'success') {
      resultText.textContent = `${data.expression} = ${data.result}`;
      resultText.style.color = '#4ade80'; // Green for success
      drawResultOnCanvas(data.result.toString());
    } else {
      resultText.textContent = data.error || data.result || "Unknown error";
      resultText.style.color = '#f87171';
    }
  } catch (err) {
    resultText.textContent = '⚠️ Backend not connected yet!';
    resultText.style.color = '#f87171';
  }
}

// --- Draw Result on Canvas ---
function drawResultOnCanvas(textResult) {
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let rightMostX = 0;
  
  // Scan canvas to find the right-most pixel drawn
  for (let y = 0; y < canvas.height; y++) {
    for (let x = canvas.width - 1; x >= 0; x--) {
      if (imgData.data[(y * canvas.width + x) * 4 + 3] > 50) {
        if (x > rightMostX) rightMostX = x;
        break; 
      }
    }
  }
  
  const startX = Math.min(rightMostX + 30, canvas.width - 60);
  ctx.font = "bold 50px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#a78bfa";
  ctx.fillText(textResult, startX, canvas.height / 2 + 15);
}

// --- Clear Button ---
clearBtn.addEventListener('click', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  resultText.textContent = 'Draw something and hit = to solve!';
  resultText.style.color = '#a78bfa';
  clearTimeout(predictTimeout);
});
