// playground/gallery.js
(function () {
  var ENTITY_SIZE = 44;
  var ZOOM_MIN = 1;
  var ZOOM_MAX = 3;
  var ZOOM_STEP = 0.5;
  var container, emptyHint, galleryViewport;
  var characters = [];
  var lastFrame = null;
  var zoomLevel = ZOOM_MIN;
  var panX = 0, panY = 0;
  var panning = false;
  var panStartX, panStartY, panOriginX, panOriginY;

  async function fetchApproved() {
    var url = window.PlaygroundConfig.SUPABASE_URL +
      '/rest/v1/characters?select=id,title,message,image_data,created_at' +
      '&status=eq.approved&order=created_at.desc&limit=50';
    var res = await fetch(url, {
      headers: {
        apikey: window.PlaygroundConfig.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + window.PlaygroundConfig.SUPABASE_ANON_KEY
      }
    });
    if (!res.ok) return [];
    return res.json();
  }

  function formatDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function closePopup() {
    var existing = container.querySelector('.pg-popup');
    if (existing) existing.remove();
  }

  function showPopup(entry) {
    closePopup();
    var popup = document.createElement('div');
    popup.className = 'pg-popup';
    popup.innerHTML =
      '<strong>' + escapeHtml(entry.title) + '</strong>' +
      (entry.message ? '<p>' + escapeHtml(entry.message) + '</p>' : '') +
      '<p class="pg-popup-date">' + formatDate(entry.created_at) + '</p>';
    container.appendChild(popup);
    var left = Math.max(0, Math.min(entry.x, container.clientWidth - popup.offsetWidth));
    var top = Math.max(0, Math.min(entry.y, container.clientHeight - popup.offsetHeight));
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }

  function makeElement(entry) {
    var el = document.createElement('img');
    el.className = 'pg-char';
    el.src = entry.image_data;
    el.alt = entry.title;
    el.addEventListener('mouseenter', function () {
      el.classList.add('pg-char-hover');
    });
    el.addEventListener('mouseleave', function () {
      el.classList.remove('pg-char-hover');
    });
    el.addEventListener('click', function (evt) {
      evt.stopPropagation();
      showPopup(entry);
    });
    container.appendChild(el);
    return el;
  }

  function renderCharacters(rows) {
    emptyHint.hidden = rows.length > 0;
    characters = rows.map(function (row) {
      var entry = {
        id: row.id,
        title: row.title,
        message: row.message,
        created_at: row.created_at,
        image_data: row.image_data,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        speed: 0.02,
        nextTurnAt: 0,
        positioned: false
      };
      entry.el = makeElement(entry);
      return entry;
    });
  }

  function tick(timestamp) {
    if (lastFrame === null) lastFrame = timestamp;
    var dtMs = timestamp - lastFrame;
    lastFrame = timestamp;
    var bounds = {
      width: container.clientWidth,
      height: container.clientHeight,
      entitySize: ENTITY_SIZE
    };
    if (bounds.width > 0 && bounds.height > 0) {
      for (var i = 0; i < characters.length; i++) {
        var c = characters[i];
        if (!c.positioned) {
          var start = window.PlaygroundWander.createWanderState(
            Math.random() * Math.max(bounds.width - ENTITY_SIZE, 0),
            Math.random() * Math.max(bounds.height - ENTITY_SIZE, 0),
            0.02
          );
          c.x = start.x; c.y = start.y; c.vx = start.vx; c.vy = start.vy;
          c.speed = start.speed; c.nextTurnAt = start.nextTurnAt;
          c.positioned = true;
        }
        var next = window.PlaygroundWander.stepPosition(c, bounds, dtMs, Date.now());
        c.x = next.x; c.y = next.y; c.vx = next.vx; c.vy = next.vy; c.nextTurnAt = next.nextTurnAt;
        c.el.style.left = c.x + 'px';
        c.el.style.top = c.y + 'px';
      }
    }
    requestAnimationFrame(tick);
  }

  // Zooming/panning just transforms the view (scale + translate on
  // #pg-gallery itself) -- neither touches clientWidth/clientHeight, so
  // the wander physics in tick() keep operating on the same logical
  // bounds regardless of zoom/pan.
  //
  // translate() is listed after scale() so its tx/ty are in local
  // (pre-scale) units -- a drag of `d` screen px needs a local translate
  // of d/zoomLevel to track the pointer 1:1.
  function applyTransform() {
    container.style.transform =
      'scale(' + zoomLevel + ') translate(' + panX + 'px, ' + panY + 'px)';
  }

  // Keeps panning from revealing empty space past the (center-scaled)
  // content's edge: the screen-space overflow on each side is
  // viewportSize * (zoomLevel - 1) / 2, which in local translate units
  // (divided by zoomLevel again) gives the max pan below.
  function clampPan() {
    var maxX = (galleryViewport.clientWidth * (zoomLevel - 1)) / (2 * zoomLevel);
    var maxY = (galleryViewport.clientHeight * (zoomLevel - 1)) / (2 * zoomLevel);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  function zoomBy(delta) {
    zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomLevel + delta));
    clampPan();
    applyTransform();
  }

  function eventPoint(evt) {
    return {
      x: evt.touches ? evt.touches[0].clientX : evt.clientX,
      y: evt.touches ? evt.touches[0].clientY : evt.clientY
    };
  }

  function startPan(evt) {
    if (evt.target.closest('.pg-char') || evt.target.closest('.pg-popup')) return;
    panning = true;
    var pt = eventPoint(evt);
    panStartX = pt.x;
    panStartY = pt.y;
    panOriginX = panX;
    panOriginY = panY;
    galleryViewport.classList.add('pg-panning');
  }

  function movePan(evt) {
    if (!panning) return;
    evt.preventDefault();
    var pt = eventPoint(evt);
    panX = panOriginX + (pt.x - panStartX) / zoomLevel;
    panY = panOriginY + (pt.y - panStartY) / zoomLevel;
    clampPan();
    applyTransform();
  }

  function endPan() {
    panning = false;
    galleryViewport.classList.remove('pg-panning');
  }

  async function init() {
    container = document.getElementById('pg-gallery');
    emptyHint = document.getElementById('pg-empty-hint');
    galleryViewport = document.getElementById('pg-gallery-viewport');
    document.addEventListener('click', function (evt) {
      if (!evt.target.closest('.pg-char') && !evt.target.closest('.pg-popup')) {
        closePopup();
      }
    });

    document.getElementById('pg-gallery-zoom-in').addEventListener('click', function () {
      zoomBy(ZOOM_STEP);
    });
    document.getElementById('pg-gallery-zoom-out').addEventListener('click', function () {
      zoomBy(-ZOOM_STEP);
    });

    galleryViewport.addEventListener('mousedown', startPan);
    window.addEventListener('mousemove', movePan);
    window.addEventListener('mouseup', endPan);
    galleryViewport.addEventListener('touchstart', startPan);
    galleryViewport.addEventListener('touchmove', movePan);
    window.addEventListener('touchend', endPan);

    var rows = await fetchApproved();
    renderCharacters(rows);
    requestAnimationFrame(tick);
  }

  init();
})();
