// playground/canvas.js
(function () {
  var GUIDE_MARGIN = 30;
  var CANVAS_SIZE = 180;
  var DEFAULT_COLOR = '#1a1a1a';

  var guideCanvas, drawCanvas, guideCtx, drawCtx;
  var currentColor = DEFAULT_COLOR;
  var erasing = false;
  var drawing = false;
  var lastX, lastY;
  var hasDrawn = false;

  function drawGuide() {
    var s = GUIDE_MARGIN;
    var size = CANVAS_SIZE - GUIDE_MARGIN * 2;
    guideCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    guideCtx.strokeStyle = '#bbbbbb';
    guideCtx.lineWidth = 2;

    guideCtx.strokeRect(s, s, size, size);

    var eyeY = s + size * 0.35;
    guideCtx.beginPath();
    guideCtx.arc(s + size * 0.35, eyeY, 3, 0, Math.PI * 2);
    guideCtx.arc(s + size * 0.65, eyeY, 3, 0, Math.PI * 2);
    guideCtx.stroke();

    guideCtx.beginPath();
    guideCtx.arc(s + size * 0.5, s + size * 0.55, size * 0.15, 0.15 * Math.PI, 0.85 * Math.PI);
    guideCtx.stroke();

    guideCtx.beginPath();
    guideCtx.moveTo(s, s + size * 0.5);
    guideCtx.lineTo(s - 15, s + size * 0.65);
    guideCtx.moveTo(s + size, s + size * 0.5);
    guideCtx.lineTo(s + size + 15, s + size * 0.65);
    guideCtx.stroke();

    guideCtx.beginPath();
    guideCtx.moveTo(s + size * 0.35, s + size);
    guideCtx.lineTo(s + size * 0.3, s + size + 20);
    guideCtx.moveTo(s + size * 0.65, s + size);
    guideCtx.lineTo(s + size * 0.7, s + size + 20);
    guideCtx.stroke();
  }

  function getPos(evt) {
    var rect = drawCanvas.getBoundingClientRect();
    var clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    var clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    return {
      x: (clientX - rect.left) * (CANVAS_SIZE / rect.width),
      y: (clientY - rect.top) * (CANVAS_SIZE / rect.height)
    };
  }

  function startDraw(evt) {
    drawing = true;
    var pos = getPos(evt);
    lastX = pos.x;
    lastY = pos.y;
  }

  function moveDraw(evt) {
    if (!drawing) return;
    evt.preventDefault();
    var pos = getPos(evt);
    drawCtx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    drawCtx.strokeStyle = currentColor;
    drawCtx.lineWidth = erasing ? 10 : 4;
    drawCtx.lineCap = 'round';
    drawCtx.beginPath();
    drawCtx.moveTo(lastX, lastY);
    drawCtx.lineTo(pos.x, pos.y);
    drawCtx.stroke();
    lastX = pos.x;
    lastY = pos.y;
    hasDrawn = true;
  }

  function endDraw() {
    drawing = false;
  }

  function updateToolState(activeEl) {
    var tools = document.querySelectorAll('.pg-swatch, #pg-eraser');
    for (var i = 0; i < tools.length; i++) tools[i].classList.remove('pg-active');
    activeEl.classList.add('pg-active');
  }

  function reset() {
    drawCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    hasDrawn = false;
  }

  function isBlank() {
    return !hasDrawn;
  }

  function exportImage() {
    var out = document.createElement('canvas');
    out.width = CANVAS_SIZE;
    out.height = CANVAS_SIZE;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.drawImage(guideCanvas, 0, 0);
    ctx.drawImage(drawCanvas, 0, 0);
    return out.toDataURL('image/png');
  }

  function init() {
    guideCanvas = document.getElementById('pg-guide');
    drawCanvas = document.getElementById('pg-draw');
    guideCtx = guideCanvas.getContext('2d');
    drawCtx = drawCanvas.getContext('2d');
    drawGuide();

    drawCanvas.addEventListener('mousedown', startDraw);
    drawCanvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', endDraw);
    drawCanvas.addEventListener('touchstart', startDraw);
    drawCanvas.addEventListener('touchmove', moveDraw);
    window.addEventListener('touchend', endDraw);

    var swatches = document.querySelectorAll('.pg-swatch');
    for (var i = 0; i < swatches.length; i++) {
      swatches[i].addEventListener('click', function (evt) {
        currentColor = evt.currentTarget.getAttribute('data-color');
        erasing = false;
        updateToolState(evt.currentTarget);
      });
    }

    document.getElementById('pg-eraser').addEventListener('click', function (evt) {
      erasing = true;
      updateToolState(evt.currentTarget);
    });

    document.getElementById('pg-clear').addEventListener('click', reset);
  }

  init();

  window.PlaygroundCanvas = {
    reset: reset,
    isBlank: isBlank,
    exportImage: exportImage
  };
})();
