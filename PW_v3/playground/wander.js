// playground/wander.js
// Pure motion logic for the gallery's wandering characters. No DOM.
(function (exports) {
  function createWanderState(x, y, speed) {
    var angle = Math.random() * Math.PI * 2;
    return {
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed: speed,
      nextTurnAt: Date.now() + 1500 + Math.random() * 2500
    };
  }

  function stepPosition(state, bounds, dtMs, now, rand) {
    rand = rand || Math.random;
    var maxX = bounds.width - bounds.entitySize;
    var maxY = bounds.height - bounds.entitySize;

    var x = state.x + state.vx * dtMs;
    var y = state.y + state.vy * dtMs;
    var vx = state.vx;
    var vy = state.vy;

    if (x < 0) { x = 0; vx = Math.abs(vx); }
    else if (x > maxX) { x = maxX; vx = -Math.abs(vx); }

    if (y < 0) { y = 0; vy = Math.abs(vy); }
    else if (y > maxY) { y = maxY; vy = -Math.abs(vy); }

    var nextTurnAt = state.nextTurnAt;
    if (now >= nextTurnAt) {
      var angle = rand() * Math.PI * 2;
      vx = Math.cos(angle) * state.speed;
      vy = Math.sin(angle) * state.speed;
      nextTurnAt = now + 1500 + rand() * 2500;
    }

    return { x: x, y: y, vx: vx, vy: vy, speed: state.speed, nextTurnAt: nextTurnAt };
  }

  exports.createWanderState = createWanderState;
  exports.stepPosition = stepPosition;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.PlaygroundWander = {}));
