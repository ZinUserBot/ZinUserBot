import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker, { Game } from '../src/index.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

function setup() {
  const values = new Map();
  const storage = {
    async get(k) { return structuredClone(values.get(k)); },
    async put(k, v) { values.set(k, structuredClone(v)); },
    async delete(k) { return values.delete(k); },
    async list({ prefix, limit, startAfter = '' }) {
      return new Map([...values].filter(([k]) => k.startsWith(prefix) && k > startAfter).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit));
    }
  };
  const game = new Game({storage, blockConcurrencyWhile: fn => fn()}, {});
  const calls = [];
  game.telegram = async (method, data) => { calls.push({method, data}); };
  return {game, values, calls};
}
const chat = id => ({id, type: 'private'});

test('webhook and setup reject unauthorized requests', async () => {
  for (const path of ['/webhook', '/setup']) {
    const response = await worker.fetch(new Request(`https://example.com${path}`, {method: 'POST'}), {BOT_TOKEN: 'token', TELEGRAM_SECRET: 'secret'});
    assert.equal(response.status, 403);
  }
});

test('setup registers webhook', async () => {
  const original = globalThis.fetch;
  let data;
  globalThis.fetch = async (url, options) => { data = JSON.parse(options.body); return Response.json({ok: true}); };
  try {
    const response = await worker.fetch(new Request('https://example.com/setup', {method: 'POST', headers: {'X-Telegram-Bot-Api-Secret-Token': 'secret'}}), {BOT_TOKEN: 'token', TELEGRAM_SECRET: 'secret'});
    assert.equal(response.status, 200);
    assert.equal(data.url, 'https://example.com/webhook');
  } finally { globalThis.fetch = original; }
});

test('save and retrieve photo; another user cannot access it', async () => {
  const {game, values, calls} = setup();
  await game.message({chat: chat(12), from: {id: 12}, photo: [{file_id:'small'}, {file_id:'big'}], caption:'تعطیلات'});
  const key = [...values.keys()][0];
  assert.equal(values.get(key).fileId, 'big');
  const id = key.split(':').at(-1);
  await game.callback({id:'cb', from:{id:99}, message:{chat:chat(99)}, data:`f:v:${id}`});
  assert.equal(calls.at(-1).data.show_alert, true);
  await game.callback({id:'cb', from:{id:12}, message:{chat:chat(12)}, data:`f:v:${id}`});
  assert.equal(calls.at(-1).method, 'sendPhoto');
  assert.equal(calls.at(-1).data.photo, 'big');
  assert.equal(calls.at(-1).data.caption, 'تعطیلات');
});

test('private videos and documents are stored, groups ignored, and deletion is scoped', async () => {
  const {game, values, calls} = setup();
  await game.message({chat:{id:-10,type:'group'}, from:{id:12}, video:{file_id:'group'}});
  assert.equal(values.size, 0);
  await game.message({chat:chat(12), from:{id:12}, video:{file_id:'video'}});
  await game.message({chat:chat(12), from:{id:12}, document:{file_id:'doc',file_name:'a.pdf'}});
  assert.equal(values.size, 2);
  const key = [...values.keys()].find(k => values.get(k).fileId === 'video');
  const id = key.split(':').at(-1);
  await game.callback({id:'cb', from:{id:12}, message:{chat:chat(12)}, data:`f:v:${id}`});
  assert.equal(calls.at(-1).method, 'sendVideo');
  await game.callback({id:'cb', from:{id:12}, message:{chat:chat(12)}, data:`f:d:${id}`});
  assert.equal(values.has(key), false);
  assert.equal(values.size, 1);
});

test('list paginates without leaking other users files', async () => {
  const {game, values, calls} = setup();
  for (let i=0; i<8; i++) values.set(`file:12:id${i}`, {type:'document', name:`file${i}`});
  values.set('file:99:secret', {type:'document', name:'private-name'});
  await game.list(12, 12);
  let msg = calls.at(-1).data;
  assert.doesNotMatch(msg.text, /private-name/);
  const next = msg.reply_markup.inline_keyboard.at(-1)[0].callback_data;
  await game.callback({id:'cb', from:{id:12}, message:{chat:chat(12)}, data:next});
  msg = calls.at(-1).data;
  assert.match(msg.text, /file6/);
  assert.match(msg.text, /file7/);
});
