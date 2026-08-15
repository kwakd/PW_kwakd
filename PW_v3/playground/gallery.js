// playground/gallery.js
(function () {
  var ENTITY_SIZE = 44;
  var container, emptyHint;
  var characters = [];
  var lastFrame = null;

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
    popup.style.left = entry.x + 'px';
    popup.style.top = entry.y + 'px';
    container.appendChild(popup);
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
    var bounds = {
      width: container.clientWidth,
      height: container.clientHeight,
      entitySize: ENTITY_SIZE
    };
    characters = rows.map(function (row) {
      var start = window.PlaygroundWander.createWanderState(
        Math.random() * Math.max(bounds.width - ENTITY_SIZE, 0),
        Math.random() * Math.max(bounds.height - ENTITY_SIZE, 0),
        0.02
      );
      var entry = {
        id: row.id,
        title: row.title,
        message: row.message,
        created_at: row.created_at,
        image_data: row.image_data,
        x: start.x,
        y: start.y,
        vx: start.vx,
        vy: start.vy,
        speed: start.speed,
        nextTurnAt: start.nextTurnAt
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
    for (var i = 0; i < characters.length; i++) {
      var c = characters[i];
      var next = window.PlaygroundWander.stepPosition(c, bounds, dtMs, timestamp);
      c.x = next.x; c.y = next.y; c.vx = next.vx; c.vy = next.vy; c.nextTurnAt = next.nextTurnAt;
      c.el.style.left = c.x + 'px';
      c.el.style.top = c.y + 'px';
    }
    requestAnimationFrame(tick);
  }

  async function init() {
    container = document.getElementById('pg-gallery');
    emptyHint = document.getElementById('pg-empty-hint');
    document.addEventListener('click', function (evt) {
      if (!evt.target.closest('.pg-char') && !evt.target.closest('.pg-popup')) {
        closePopup();
      }
    });
    var rows = await fetchApproved();
    renderCharacters(rows);
    requestAnimationFrame(tick);
  }

  init();
})();
