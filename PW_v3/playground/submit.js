// playground/submit.js
(function () {
  var STORAGE_KEY = 'kwakd-pending-character';

  function showState(name) {
    var states = ['pg-draw-state', 'pg-pending-state', 'pg-result-state', 'pg-gallery-state'];
    for (var i = 0; i < states.length; i++) {
      document.getElementById(states[i]).hidden = states[i] !== name;
    }
    if (name === 'pg-draw-state') {
      clearError();
    }
  }

  function showError(msg) {
    var el = document.getElementById('pg-error');
    el.textContent = msg;
    el.hidden = false;
  }

  function clearError() {
    var el = document.getElementById('pg-error');
    el.hidden = true;
    el.textContent = '';
  }

  function getPending() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function setPending(entry) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  }

  function clearPending() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function showResult(message) {
    document.getElementById('pg-result-message').textContent = message;
    showState('pg-result-state');
  }

  async function checkPendingStatus() {
    var pending = getPending();
    if (!pending) {
      showState('pg-draw-state');
      return;
    }
    showState('pg-pending-state');
    try {
      var res = await fetch(window.PlaygroundConfig.STATUS_ENDPOINT + '?id=' + encodeURIComponent(pending.id));
      if (res.status === 404) {
        clearPending();
        showResult("your last submission wasn't approved — feel free to try again!");
        return;
      }
      var body = await res.json();
      if (body.status === 'approved') {
        clearPending();
        showResult('your character was approved! it should be wandering around now.');
      } else if (body.status === 'rejected') {
        clearPending();
        showResult("your last submission wasn't approved — feel free to try again!");
      }
    } catch (e) {
      // network error: leave the pending state showing, retry next load.
    }
  }

  async function handleSubmit(evt) {
    evt.preventDefault();
    clearError();

    var title = document.getElementById('pg-title').value.trim();
    var message = document.getElementById('pg-message').value.trim();

    var titleCheck = window.PlaygroundValidation.validateTitle(title);
    if (!titleCheck.valid) { showError(titleCheck.error); return; }

    var messageCheck = window.PlaygroundValidation.validateMessage(message);
    if (!messageCheck.valid) { showError(messageCheck.error); return; }

    if (window.PlaygroundCanvas.isBlank()) {
      showError('draw something first!');
      return;
    }

    var imageDataUrl = window.PlaygroundCanvas.exportImage();
    var imageCheck = window.PlaygroundValidation.validateImageDataUrl(imageDataUrl);
    if (!imageCheck.valid) { showError(imageCheck.error); return; }

    var submitBtn = document.getElementById('pg-submit-btn');
    submitBtn.disabled = true;

    try {
      var res = await fetch(window.PlaygroundConfig.SUBMIT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title, message: message, imageDataUrl: imageDataUrl })
      });
      var body = await res.json();
      if (!res.ok) {
        showError(body.error || 'submission failed, try again.');
        submitBtn.disabled = false;
        return;
      }
      setPending({ id: body.id, submittedAt: Date.now() });
      window.PlaygroundCanvas.reset();
      document.getElementById('pg-form').reset();
      showState('pg-pending-state');
    } catch (e) {
      showError('submission failed, try again.');
    }
    submitBtn.disabled = false;
  }

  function init() {
    document.getElementById('pg-form').addEventListener('submit', handleSubmit);
    document.getElementById('pg-result-ok').addEventListener('click', function () {
      showState('pg-gallery-state');
    });
    document.getElementById('pg-view-gallery').addEventListener('click', function () {
      showState('pg-gallery-state');
    });
    document.getElementById('pg-draw-another').addEventListener('click', function () {
      showState('pg-draw-state');
    });
    checkPendingStatus();
  }

  init();
})();
