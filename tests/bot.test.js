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

test('mini app checks signed Telegram identity and rejects tampering', async () => {
  const token = 'test-token';
  const params = new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)), user:JSON.stringify({id:12,first_name:'A'})});
  const check = [...params.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${k}=${v}`).join('\n');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw',enc.encode('WebAppData'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const secret = await crypto.subtle.sign('HMAC',key,enc.encode(token));
  const key2 = await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature = await crypto.subtle.sign('HMAC',key2,enc.encode(check));
  params.set('hash', [...new Uint8Array(signature)].map(n => n.toString(16).padStart(2,'0')).join(''));
  let sent;
  const env = {BOT_TOKEN:token, GAME:{idFromName:()=>1,get:()=>({fetch:async (url, opts)=>{sent=JSON.parse(opts.body);return Response.json({ok:true});}})}};
  const make = () => new Request('https://example.com/api/drive',{method:'POST',headers:{'X-Telegram-Init-Data':params.toString()},body:JSON.stringify({action:'list',user:99})});
  assert.equal((await worker.fetch(make(),env)).status,200);
  assert.equal(sent.user,12);
  params.set('user', JSON.stringify({id:99}));
  assert.equal((await worker.fetch(make(),env)).status,401);
});

test('mini app lists only owner metadata and sends files privately', async () => {
  const {game, values, calls} = setup();
  values.set('file:12:abc', {type:'photo', name:'عکس', fileId:'secret-file-id'});
  values.set('file:99:abc', {type:'photo', name:'دیگری', fileId:'other-id'});
  const data = await (await game.driveApi({user:12,action:'list'})).json();
  assert.deepEqual(data.items, [{id:'abc',name:'عکس',type:'photo'}]);
  await game.driveApi({user:12,action:'get',id:'abc'});
  assert.equal(calls.at(-1).data.chat_id,12);
  assert.equal(calls.at(-1).data.photo,'secret-file-id');
  assert.equal((await game.driveApi({user:55,action:'delete',id:'abc'})).status,404);
});

test('photo preview is private and streams media without exposing the token', async () => {
  const {game, values} = setup();
  game.env.BOT_TOKEN = 'sensitive-token';
  values.set('file:12:abc', {type:'photo', name:'عکس', fileId:'private-id'});
  game.telegram = async (method, data) => { assert.equal(method,'getFile'); assert.equal(data.file_id,'private-id'); return {file_path:'photos/test.jpg', file_size:10}; };
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('imagebytes');
  try {
    assert.equal((await game.driveApi({user:99, action:'preview', id:'abc'})).status,404);
    const response = await game.driveApi({user:12, action:'preview', id:'abc'});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'image/jpeg');
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(await response.text(),'imagebytes');
  } finally { globalThis.fetch=original; }
});
