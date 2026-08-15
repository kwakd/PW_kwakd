const test = require('node:test');
const assert = require('node:assert/strict');
const { createWanderState, stepPosition } = require('./wander.js');

test('createWanderState starts at the given position', () => {
  const state = createWanderState(10, 20, 0.05);
  assert.equal(state.x, 10);
  assert.equal(state.y, 20);
  assert.equal(state.speed, 0.05);
});

test('stepPosition moves the entity by velocity * dt', () => {
  const state = { x: 10, y: 10, vx: 1, vy: 0, speed: 1, nextTurnAt: Infinity };
  const bounds = { width: 100, height: 100, entitySize: 20 };
  const next = stepPosition(state, bounds, 5, 0);
  assert.equal(next.x, 15);
  assert.equal(next.y, 10);
});

test('stepPosition bounces off the right edge', () => {
  const state = { x: 75, y: 10, vx: 10, vy: 0, speed: 10, nextTurnAt: Infinity };
  const bounds = { width: 100, height: 100, entitySize: 20 };
  const next = stepPosition(state, bounds, 1, 0);
  assert.equal(next.x, 80);
  assert.ok(next.vx < 0);
});

test('stepPosition bounces off the left edge', () => {
  const state = { x: 2, y: 10, vx: -10, vy: 0, speed: 10, nextTurnAt: Infinity };
  const bounds = { width: 100, height: 100, entitySize: 20 };
  const next = stepPosition(state, bounds, 1, 0);
  assert.equal(next.x, 0);
  assert.ok(next.vx > 0);
});

test('stepPosition picks a new direction once nextTurnAt has passed', () => {
  const state = { x: 10, y: 10, vx: 1, vy: 0, speed: 1, nextTurnAt: 100 };
  const bounds = { width: 100, height: 100, entitySize: 20 };
  const fixedRand = () => 0;
  const next = stepPosition(state, bounds, 1, 150, fixedRand);
  assert.equal(next.vx, 1);
  assert.equal(next.vy, 0);
  assert.ok(next.nextTurnAt > 150);
});
