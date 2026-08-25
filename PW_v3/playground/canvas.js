// playground/canvas.js
(function () {
  var GUIDE_MARGIN = 30;
  var CANVAS_SIZE = 180;
  var DEFAULT_COLOR = '#1a1a1a';
  var BRUSH_SIZE = 8;
  var ERASER_SIZE = 12;

  var ZOOM_MIN = 1;
  var ZOOM_MAX = 3;
  var ZOOM_STEP = 0.5;

  var guideCanvas, drawCanvas, guideCtx, drawCtx;
  var canvasViewport, canvasWrap, cursorEl;
  var currentColor = DEFAULT_COLOR;
  var erasing = false;
  var drawing = false;
  var lastX, lastY;
  var hasDrawn = false;

  // zoom/pan: canvasWrap (and the canvases at 100% of it) is resized in
  // real CSS pixels rather than transform: scale()'d, so the existing
  // getBoundingClientRect()-based coordinate math in getPos()/
  // updateCursorPos() keeps working unchanged -- a transform would have
  // required unscaling those offsets to avoid double-scaling the cursor.
  var baseSize = 0;
  var zoomLevel = ZOOM_MIN;
  var panMode = false;
  var panning = false;
  var panStartX, panStartY, scrollStartX, scrollStartY;

  // Body/limb geometry copied from kwakd/wisp-app's SHAPES.box (100x100
  // viewBox), scaled 1:1 onto the guide. Face geometry copied from that
  // same app's getFace(bbox) -- the shared eyes/mouth every wisp species
  // actually renders through (each SHAPES entry's own eyes/mouth fields
  // are dead code there, never read by the render path).
  function drawGuide() {
    var s = GUIDE_MARGIN;
    var size = CANVAS_SIZE - GUIDE_MARGIN * 2;
    var scale = size / 100;
    guideCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    guideCtx.strokeStyle = '#bbbbbb';
    guideCtx.lineWidth = 2;

    function px(v) { return s + v * scale; }

    function roundedRect(x, y, w, h, r) {
      var X = px(x), Y = px(y), W = w * scale, H = h * scale, R = r * scale;
      guideCtx.beginPath();
      if (guideCtx.roundRect) {
        guideCtx.roundRect(X, Y, W, H, R);
      } else {
        guideCtx.moveTo(X + R, Y);
        guideCtx.lineTo(X + W - R, Y);
        guideCtx.arcTo(X + W, Y, X + W, Y + R, R);
        guideCtx.lineTo(X + W, Y + H - R);
        guideCtx.arcTo(X + W, Y + H, X + W - R, Y + H, R);
        guideCtx.lineTo(X + R, Y + H);
        guideCtx.arcTo(X, Y + H, X, Y + H - R, R);
        guideCtx.lineTo(X, Y + R);
        guideCtx.arcTo(X, Y, X + R, Y, R);
        guideCtx.closePath();
      }
      guideCtx.stroke();
    }

    function line(x1, y1, x2, y2, width) {
      guideCtx.lineWidth = width;
      guideCtx.lineCap = 'round';
      guideCtx.beginPath();
      guideCtx.moveTo(px(x1), px(y1));
      guideCtx.lineTo(px(x2), px(y2));
      guideCtx.stroke();
      guideCtx.lineWidth = 2;
      guideCtx.lineCap = 'butt';
    }

    // arms/legs, simplified to lines (starting exactly at the body's
    // edges -- x=22/78, y=74 -- so they read as attached, not floating
    // off the body) -- thicker than the rest of the guide, and arms
    // lowered to attach near the body's vertical middle instead of box's
    // original near-the-top pivot.
    line(22, 44, 6, 54, 4);
    line(78, 44, 94, 54, 4);
    line(37, 74, 37, 88, 4);
    line(63, 74, 63, 88, 4);

    // body: SHAPES.box.body, matching the limbs' thickness
    guideCtx.lineWidth = 4;
    roundedRect(22, 18, 56, 56, 8);
    guideCtx.lineWidth = 2;

    // face: getFace({x:22,y:18,width:56,height:56}), eyes sized down a
    // touch from the computed 3.08, filled in (trying this out instead
    // of stroke-only)
    guideCtx.fillStyle = '#bbbbbb';
    guideCtx.beginPath();
    guideCtx.arc(px(42.72), px(41.52), 2.5 * scale, 0, Math.PI * 2);
    guideCtx.fill();
    guideCtx.beginPath();
    guideCtx.arc(px(57.28), px(41.52), 2.5 * scale, 0, Math.PI * 2);
    guideCtx.fill();

    guideCtx.beginPath();
    guideCtx.moveTo(px(43.84), px(47.12));
    guideCtx.quadraticCurveTo(px(50), px(48.62), px(56.16), px(47.12));
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

  function eventPoint(evt) {
    return {
      x: evt.touches ? evt.touches[0].clientX : evt.clientX,
      y: evt.touches ? evt.touches[0].clientY : evt.clientY
    };
  }

  function startPan(evt) {
    panning = true;
    var pt = eventPoint(evt);
    panStartX = pt.x;
    panStartY = pt.y;
    scrollStartX = canvasViewport.scrollLeft;
    scrollStartY = canvasViewport.scrollTop;
    canvasViewport.classList.add('pg-panning');
  }

  function movePan(evt) {
    if (!panning) return;
    evt.preventDefault();
    var pt = eventPoint(evt);
    canvasViewport.scrollLeft = scrollStartX - (pt.x - panStartX);
    canvasViewport.scrollTop = scrollStartY - (pt.y - panStartY);
  }

  function endPan() {
    panning = false;
    canvasViewport.classList.remove('pg-panning');
  }

  function startDraw(evt) {
    if (panMode) { startPan(evt); return; }
    drawing = true;
    var pos = getPos(evt);
    lastX = pos.x;
    lastY = pos.y;
  }

  function moveDraw(evt) {
    if (panMode) { movePan(evt); return; }
    if (!drawing) return;
    evt.preventDefault();
    var pos = getPos(evt);
    drawCtx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    drawCtx.strokeStyle = currentColor;
    drawCtx.lineWidth = erasing ? ERASER_SIZE : BRUSH_SIZE;
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
    if (panMode) { endPan(); return; }
    drawing = false;
  }

  function updateToolState(activeEl) {
    var tools = document.querySelectorAll('.pg-swatch, #pg-eraser');
    for (var i = 0; i < tools.length; i++) tools[i].classList.remove('pg-active');
    activeEl.classList.add('pg-active');
  }

  // Brush-preview circle: sized/colored to match what an actual stroke
  // would look like, in on-screen pixels -- the canvas is drawn at
  // CANVAS_SIZE (180) internal units but displayed larger via CSS, so a
  // brush diameter in canvas units has to be scaled up by the same ratio
  // to look right on screen.
  function updateCursorAppearance() {
    var screenScale = drawCanvas.getBoundingClientRect().width / CANVAS_SIZE;
    var diameter = (erasing ? ERASER_SIZE : BRUSH_SIZE) * screenScale;
    cursorEl.style.width = diameter + 'px';
    cursorEl.style.height = diameter + 'px';
    if (erasing) {
      cursorEl.style.background = 'transparent';
      cursorEl.style.borderStyle = 'dashed';
      cursorEl.style.borderColor = 'var(--fg)';
    } else {
      cursorEl.style.background = currentColor;
      cursorEl.style.borderStyle = 'solid';
      cursorEl.style.borderColor = 'var(--border)';
    }
  }

  function updateCursorPos(evt) {
    var rect = canvasWrap.getBoundingClientRect();
    var clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    var clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    cursorEl.style.left = (clientX - rect.left) + 'px';
    cursorEl.style.top = (clientY - rect.top) + 'px';
  }

  function showCursor(evt) {
    updateCursorAppearance();
    updateCursorPos(evt);
    cursorEl.style.display = 'block';
  }

  function hideCursor() {
    cursorEl.style.display = 'none';
  }

  // Zooms by literally resizing canvasWrap (canvases follow at 100%)
  // rather than transform: scale()'ing it, so it keeps the current
  // viewport-center point stable instead of always zooming toward the
  // top-left corner.
  function applyZoom(prevZoom) {
    var viewportW = canvasViewport.clientWidth;
    var viewportH = canvasViewport.clientHeight;
    var centerX = canvasViewport.scrollLeft + viewportW / 2;
    var centerY = canvasViewport.scrollTop + viewportH / 2;
    var ratio = zoomLevel / prevZoom;
    var newSize = baseSize * zoomLevel;

    canvasWrap.style.width = newSize + 'px';
    canvasWrap.style.height = newSize + 'px';
    canvasViewport.scrollLeft = centerX * ratio - viewportW / 2;
    canvasViewport.scrollTop = centerY * ratio - viewportH / 2;
  }

  function zoomBy(delta) {
    var prevZoom = zoomLevel;
    zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomLevel + delta));
    if (zoomLevel === prevZoom) return;
    applyZoom(prevZoom);
  }

  function resetZoom() {
    zoomLevel = ZOOM_MIN;
    if (canvasWrap) {
      canvasWrap.style.width = baseSize + 'px';
      canvasWrap.style.height = baseSize + 'px';
    }
    if (canvasViewport) {
      canvasViewport.scrollLeft = 0;
      canvasViewport.scrollTop = 0;
    }
  }

  function setPanMode(active) {
    panMode = active;
    canvasViewport.classList.toggle('pg-pan-mode', panMode);
  }

  function reset() {
    drawCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    hasDrawn = false;
    resetZoom();
  }

  function isBlank() {
    return !hasDrawn;
  }

  function exportImage() {
    var out = document.createElement('canvas');
    out.width = CANVAS_SIZE;
    out.height = CANVAS_SIZE;
    var ctx = out.getContext('2d');
    ctx.drawImage(guideCanvas, 0, 0);
    ctx.drawImage(drawCanvas, 0, 0);
    return out.toDataURL('image/png');
  }

  function init() {
    guideCanvas = document.getElementById('pg-guide');
    drawCanvas = document.getElementById('pg-draw');
    guideCtx = guideCanvas.getContext('2d');
    drawCtx = drawCanvas.getContext('2d');
    canvasViewport = document.getElementById('pg-canvas-viewport');
    canvasWrap = document.getElementById('pg-canvas-wrap');
    cursorEl = document.getElementById('pg-cursor');
    drawGuide();

    baseSize = canvasViewport.clientWidth;
    resetZoom();

    drawCanvas.addEventListener('mousedown', startDraw);
    drawCanvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', endDraw);
    drawCanvas.addEventListener('touchstart', startDraw);
    drawCanvas.addEventListener('touchmove', moveDraw);
    window.addEventListener('touchend', endDraw);

    drawCanvas.addEventListener('mouseenter', showCursor);
    drawCanvas.addEventListener('mousemove', updateCursorPos);
    drawCanvas.addEventListener('mouseleave', hideCursor);
    drawCanvas.addEventListener('touchstart', showCursor);
    drawCanvas.addEventListener('touchmove', updateCursorPos);
    window.addEventListener('touchend', hideCursor);

    var swatches = document.querySelectorAll('.pg-swatch');
    for (var i = 0; i < swatches.length; i++) {
      swatches[i].addEventListener('click', function (evt) {
        currentColor = evt.currentTarget.getAttribute('data-color');
        erasing = false;
        updateToolState(evt.currentTarget);
        updateCursorAppearance();
      });
    }

    document.getElementById('pg-eraser').addEventListener('click', function (evt) {
      erasing = true;
      updateToolState(evt.currentTarget);
      updateCursorAppearance();
    });

    document.getElementById('pg-clear').addEventListener('click', reset);

    document.getElementById('pg-guide-toggle').addEventListener('click', function (evt) {
      document.getElementById('pg-canvas-wrap').classList.toggle('pg-guide-on-top');
      evt.currentTarget.classList.toggle('pg-active');
    });

    document.getElementById('pg-zoom-in').addEventListener('click', function () {
      zoomBy(ZOOM_STEP);
    });
    document.getElementById('pg-zoom-out').addEventListener('click', function () {
      zoomBy(-ZOOM_STEP);
    });

    document.getElementById('pg-pan-toggle').addEventListener('click', function (evt) {
      setPanMode(!panMode);
      evt.currentTarget.classList.toggle('pg-active', panMode);
    });

    window.addEventListener('resize', function () {
      var prevBase = baseSize;
      baseSize = canvasViewport.clientWidth;
      if (baseSize !== prevBase) resetZoom();
    });
  }

  init();

  window.PlaygroundCanvas = {
    reset: reset,
    isBlank: isBlank,
    exportImage: exportImage
  };
})();
