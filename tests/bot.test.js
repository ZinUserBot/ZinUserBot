import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { Game } from '../src/index.js';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

function setup() {
  const values = new Map();
  const storage = {
    async get(k) { return structuredClone(values.get(k)); },
    async put(k, v) { values.set(k, structuredClone(v)); },
    async delete(k) { return values.delete(k); },
    async list({prefix}) { return new Map([...values].filter(([k]) => k.startsWith(prefix))); },
    async transaction(fn) { return fn(this); }
  };
  const game = new Game({storage, blockConcurrencyWhile: fn => fn()}, {});
  const calls = [];
  game.telegram = async (method, data) => { calls.push({method, data}); };
  return {game, values, calls};
}

test('webhook rejects unauthorized requests', async () => {
  const response = await worker.fetch(new Request('https://example.com/webhook', {method: 'POST'}), {BOT_TOKEN: 'token', TELEGRAM_SECRET: 'secret'});
  assert.equal(response.status, 403);
});

test('five correct answers save score and old buttons cannot score twice', async () => {
  const {game, values, calls} = setup();
  const user = {id: 12, first_name: 'آزاده'};
  await game.message({chat: {id: 42}, from: user, text: '/play'});
  for (let i = 0; i < 5; i++) {
    const current = values.get('game:42:12');
    const cb = {id: 'cb', from: user, message: {chat: {id: 42}, message_id: 1}, data: `q:${current.nonce}:${current.correct}`};
    await game.callback(cb);
    await game.callback(cb);
  }
  assert.deepEqual(values.get('player:12'), {id: 12, name: 'آزاده', score: 5, games: 1});
  assert.equal(values.has('game:42:12'), false);
  assert.equal(calls.at(-1).data.show_alert, true);
});

test('another user cannot answer', async () => {
  const {game, values, calls} = setup();
  await game.message({chat: {id: 42}, from: {id: 12}, text: '/play'});
  const current = values.get('game:42:12');
  await game.callback({id: 'cb', from: {id: 99}, message: {chat: {id: 42}}, data: `q:${current.nonce}:0`});
  assert.equal(values.get('game:42:12').round, 0);
  assert.equal(calls.at(-1).data.show_alert, true);
});
