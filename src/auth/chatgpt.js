const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { USER_DATA_ROOT } = require('../config');
const lockfile = require('proper-lockfile');

const AUTH_URL = 'https://auth.openai.com/api/accounts/authorize';
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
const ISSUER = 'https://auth.openai.com';
const JWKS_URL = 'https://auth.openai.com/.well-known/jwks.json';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const CALLBACK_PATH = '/auth/callback';
let refreshInProgress = null;
let activeLogin = false;

function storageDirectory(options = {}) {
  return path.resolve(options.directory || path.join(USER_DATA_ROOT, 'chatgpt'));
}
async function loadJson(filename) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function savePrivateJson(filename, data) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, filename);
    await fs.chmod(filename, 0o600).catch(() => {});
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
async function getChatGPTHostId(options = {}) {
  const directory = storageDirectory(options);
  const filename = path.join(directory, 'host.json');
  const saved = await loadJson(filename);
  if (typeof saved?.hostId === 'string' && /^urn:uuid:[a-f\d-]{36}$/i.test(saved.hostId)) return saved.hostId;
  const hostId = `urn:uuid:${crypto.randomUUID()}`;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try { await fs.writeFile(filename, JSON.stringify({ hostId }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const actual = await loadJson(filename);
  if (!/^urn:uuid:[a-f\d-]{36}$/i.test(actual?.hostId || '')) throw new Error('Invalid stored ChatGPT host ID');
  return actual.hostId;
}
async function loadChatGPTAccount(options = {}) {
  return loadJson(path.join(storageDirectory(options), 'account.json'));
}
function safeAccount(account) {
  return account ? {
    connected: true, email: account.email || '', subject: account.subject || '',
    clientId: account.clientId, sharing: Array.isArray(account.scopes) && account.scopes.includes('chatgpt.tokens.use.direct'),
    expiresAt: account.expiresAt || 0,
  } : { connected: false, sharing: false };
}
async function getChatGPTStatus(options = {}) { return safeAccount(await loadChatGPTAccount(options)); }
function buildChatGPTAuthorizationUrl({ clientId = 'dynamic_agent_client', hostId, redirectUri, state, nonce, challenge, email, idToken }) {
  const url = new URL(AUTH_URL);
  const params = {
    client_id: clientId, ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirectUri,
    scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: challenge,
  };
  if (clientId === 'dynamic_agent_client') params.agent_name_hint = 'Zyn Agent';
  else { if (email) params.login_hint = email; if (idToken) params.id_token_hint = idToken; }
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.toString();
}
async function postToken(body, options = {}) {
  const response = await (options.fetcher || fetch)(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'application/json' },
    body: new URLSearchParams(body).toString(), signal: options.signal,
  });
  if (!response.ok) throw new Error(`ChatGPT OAuth token exchange failed (HTTP ${response.status})`);
  const data = await response.json();
  if (!data?.access_token || String(data.token_type || '').toLowerCase() !== 'bearer' || !Number.isFinite(Number(data.expires_in))) throw new Error('Incomplete or unsupported ChatGPT OAuth response');
  return data;
}
async function verifyChatGPTIdentity(idToken, clientId, nonce, options = {}) {
  const { jwtVerify, createRemoteJWKSet } = await import('jose');
  const keys = options.keys || createRemoteJWKSet(new URL(JWKS_URL));
  const { payload } = await jwtVerify(idToken, keys, { issuer: ISSUER, audience: clientId, algorithms: ['RS256', 'PS256', 'ES256'] });
  if (typeof payload.nonce !== 'string' || payload.nonce !== nonce) throw new Error('ChatGPT ID token nonce mismatch');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('ChatGPT ID token has no subject');
  return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : '' };
}
function secureEqual(left, right) {
  const a = Buffer.from(String(left || '')); const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function startChatGPTLogin(options = {}) {
  const directory = storageDirectory(options);
  const previous = options.reconnect ? await loadChatGPTAccount(options) : null;
  if (options.reconnect && !previous?.clientId) throw new Error('No saved ChatGPT account to reconnect');
  const clientId = previous?.clientId || 'dynamic_agent_client';
  const hostId = await getChatGPTHostId(options);
  if (activeLogin) throw new Error('A ChatGPT sign-in is already in progress');
  activeLogin = true;
  const state = crypto.randomBytes(24).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(40).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  let resolveDone, rejectDone, settled = false;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  done.catch(() => {});
  let timer;
  let server;
  const finish = (error, result) => {
    if (settled) return;
    settled = true;
    activeLogin = false;
    clearTimeout(timer);
    server?.close();
    if (error) rejectDone(error);
    else resolveDone(result);
  };
  server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) { res.writeHead(404); res.end('Not found'); return; }
    if (settled) { res.writeHead(409); res.end('Sign-in already completed'); return; }
    try {
      if (!secureEqual(url.searchParams.get('state'), state)) throw new Error('OAuth state mismatch');
      if (url.searchParams.has('error')) throw new Error('ChatGPT sign-in was declined or cancelled');
      const code = url.searchParams.get('code');
      const returnedId = url.searchParams.get('client_id');
      if (!code) throw new Error('Missing OAuth authorization code');
      if (previous && returnedId && returnedId !== clientId) throw new Error('OAuth client ID changed unexpectedly');
      if (!previous && (!returnedId || returnedId === 'dynamic_agent_client')) throw new Error('Missing issued OAuth client ID');
      const issuedClientId = previous?.clientId || returnedId;
      const token = await postToken({ grant_type: 'authorization_code', client_id: issuedClientId, code, code_verifier: verifier, redirect_uri: `http://127.0.0.1:${server.address().port}${CALLBACK_PATH}`, resource: RESOURCE }, options);
      if (!token.id_token) throw new Error('ChatGPT did not return an ID token');
      const identity = await (options.verifyIdentity || verifyChatGPTIdentity)(token.id_token, issuedClientId, nonce);
      if (!identity?.sub) throw new Error('Missing verified account identity');
      if (previous?.subject && previous.subject !== identity.sub) throw new Error('Different ChatGPT account selected');
      const account = {
        clientId: issuedClientId, subject: identity.sub, email: identity.email || previous?.email || '',
        idToken: token.id_token, accessToken: token.access_token,
        refreshToken: token.refresh_token || previous?.refreshToken || '',
        scopes: String(token.scope || '').split(/\s+/).filter(Boolean),
        expiresAt: Date.now() + Number(token.expires_in) * 1000,
      };
      if (!account.refreshToken) throw new Error('ChatGPT did not grant offline access');
      if (settled) throw new Error('ChatGPT sign-in is no longer active');
      await savePrivateJson(path.join(directory, 'account.json'), account);
      res.writeHead(200); res.end('Account connected to Zyn Agent. Return to the terminal.');
      finish(null, safeAccount(account));
    } catch (error) {
      res.writeHead(400); res.end('Authentication failed. Check Zyn Agent for details.');
      finish(error);
    }
  });
  server.on('error', error => finish(error));
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { activeLogin = false; server.close(); throw error; }
  const redirectUri = `http://127.0.0.1:${server.address().port}${CALLBACK_PATH}`;
  timer = setTimeout(() => finish(new Error('ChatGPT sign-in timed out')), Math.max(1000, options.timeoutMs || 300000));
  const url = buildChatGPTAuthorizationUrl({clientId, hostId, redirectUri, state, nonce, challenge, email: options.includeLoginHint ? previous?.email : undefined, idToken: options.includeIdTokenHint ? previous?.idToken : undefined});
  return { url, done, cancel: () => finish(new Error('ChatGPT sign-in cancelled')) };
}
async function refreshChatGPTAccount(options = {}) {
  if (refreshInProgress) return refreshInProgress;
  const refresh = async () => {
    const filename = path.join(storageDirectory(options), 'account.json');
    const release = await lockfile.lock(filename, { realpath: true, stale: 30000, update: 10000, retries: { retries: 20, factor: 1, minTimeout: 100, maxTimeout: 100 } });
    try {
      const current = await loadChatGPTAccount(options);
      if (!current?.refreshToken) throw new Error('ChatGPT account not connected. Use zyn auth chatgpt login');
      if (!options.force && Number(current.expiresAt || 0) > Date.now() + 90000) return current;
      const token = await postToken({grant_type:'refresh_token',client_id:current.clientId,refresh_token:current.refreshToken,resource:RESOURCE},options);
      if (!token.refresh_token) throw new Error('ChatGPT refresh token rotation failed');
      const next = {
        ...current, accessToken:token.access_token,refreshToken:token.refresh_token,
        scopes:token.scope ? String(token.scope).split(/\s+/).filter(Boolean) : current.scopes,
        expiresAt:Date.now()+Number(token.expires_in)*1000,
      };
      await savePrivateJson(filename, next);
      return next;
    } finally { await release(); }
  };
  refreshInProgress = refresh().finally(() => { refreshInProgress = null; });
  return refreshInProgress;
}
async function getChatGPTAccessToken(options = {}) {
  let account = await loadChatGPTAccount(options);
  if (!account?.refreshToken) throw new Error('ChatGPT is not connected. Run zyn auth chatgpt login');
  if (Number(account.expiresAt || 0) <= Date.now() + 90000) account = await refreshChatGPTAccount(options);
  if (!Array.isArray(account.scopes) || !account.scopes.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT account has not approved plan usage');
  return account.accessToken;
}
async function disconnectChatGPT(options = {}) {
  const account = await loadChatGPTAccount(options);
  let revoked = !account?.refreshToken;
  if (account?.refreshToken) {
    try {
      const fetcher = options.fetcher || fetch;
      const response = await fetcher(`${ISSUER}/.well-known/openid-configuration`);
      const discovery = await response.json();
      if (response.ok && new URL(discovery.revocation_endpoint).origin === ISSUER) {
        const res = await fetcher(discovery.revocation_endpoint, {
          method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({token:account.refreshToken,token_type_hint:'refresh_token',client_id:account.clientId}).toString(),
        });
        revoked = res.ok;
      }
    } catch {}
  }
  await fs.rm(path.join(storageDirectory(options), 'account.json'), {force:true});
  return {connected:false,sharing:false,remoteRevoked:revoked};
}
module.exports={AUTH_URL,TOKEN_URL,RESOURCE,SCOPES,buildChatGPTAuthorizationUrl,verifyChatGPTIdentity,startChatGPTLogin,getChatGPTHostId,loadChatGPTAccount,getChatGPTStatus,refreshChatGPTAccount,getChatGPTAccessToken,disconnectChatGPT};
