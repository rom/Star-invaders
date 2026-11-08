/**
 * Client side of the Star Invaders back end.
 *
 * Responsibilities:
 *  - fetch the campaign definition (levels + bestiary) from the Go server
 *  - open and maintain the SSE "defence net" stream (roster, feed, chat)
 *  - mint a run token at game start and submit the score at game end
 *  - report presence and milestones so other players see them live
 *
 * Every call degrades gracefully: if the back end is unreachable the game
 * still runs, it just loses the social layer and the global leaderboard.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function postJSON(url, body, { signal } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (data && data.error) detail = data.error;
    } catch { /* non-JSON error body */ }
    const err = new Error(detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export class Net {
  constructor() {
    /** @type {EventSource|null} */
    this.source = null;
    this.clientId = null;
    this.secret = null;
    this.online = 0;
    this.connected = false;
    this.runId = null;
    this.runStartedAt = 0;
    this.listeners = new Map();
    this._presenceQueued = null;
    this._presenceTimer = null;
    this._reconnectDelay = 1000;
    this._name = 'ANON';
    this._best = 0;
    this._closing = false;
  }

  /** Subscribe to a hub event type, or '*' for all of them. */
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  _emit(type, data) {
    for (const fn of this.listeners.get(type) ?? []) {
      try { fn(data); } catch (err) { console.error('net listener failed', err); }
    }
    for (const fn of this.listeners.get('*') ?? []) {
      try { fn(type, data); } catch (err) { console.error('net listener failed', err); }
    }
  }

  /* ------------------------------------------------------- campaign data */

  async loadCampaign() {
    const data = await getJSON('/api/levels');
    if (!data || !Array.isArray(data.levels) || data.levels.length === 0) {
      throw new Error('campaign payload is empty');
    }
    return data;
  }

  async loadScores(limit = 20) {
    try {
      return await getJSON(`/api/scores?limit=${encodeURIComponent(limit)}`);
    } catch (err) {
      console.warn('leaderboard unavailable', err);
      return { scores: [], total: 0, offline: true };
    }
  }

  /** Levels built in the level editor and published to this server. */
  async loadCommunityLevels(limit = 40) {
    try {
      return await getJSON(`/api/userlevels?limit=${encodeURIComponent(limit)}`);
    } catch (err) {
      console.warn('community levels unavailable', err);
      return { levels: [], total: 0, offline: true };
    }
  }

  async loadCommunityLevel(id) {
    const data = await getJSON(`/api/userlevels/${encodeURIComponent(id)}`);
    return data.entry;
  }

  /** Best-effort play counter for a community level. */
  recordCommunityPlay(id) {
    postJSON(`/api/userlevels/${encodeURIComponent(id)}/play`).catch(() => { /* not worth surfacing */ });
  }

  async loadStats() {
    try {
      return await getJSON('/api/stats');
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------- stream */

  connect(name, best = 0) {
    this._name = name || 'ANON';
    this._best = best | 0;
    this._closing = false;
    this._openStream();
  }

  _openStream() {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    if (typeof EventSource === 'undefined') return;

    const url = `/api/stream?name=${encodeURIComponent(this._name)}&best=${this._best | 0}`;
    const es = new EventSource(url);
    this.source = es;

    const handle = (type) => (ev) => {
      let payload = null;
      try { payload = JSON.parse(ev.data); } catch { return; }
      const data = payload && 'data' in payload ? payload.data : payload;
      if (type === 'hello') {
        this.clientId = data.you?.id ?? null;
        this.secret = data.secret ?? null;
        this.online = data.online ?? 0;
        this.connected = true;
        this._reconnectDelay = 1000;
      } else if (type === 'roster') {
        this.online = data.online ?? this.online;
      } else if (type === 'ping') {
        this.online = data.online ?? this.online;
      }
      this._emit(type, data);
    };

    for (const t of ['hello', 'roster', 'feed', 'chat', 'highscore', 'stats', 'ping']) {
      es.addEventListener(t, handle(t));
    }

    es.onopen = () => { this._emit('status', { connected: true }); };
    es.onerror = () => {
      this.connected = false;
      this._emit('status', { connected: false });
      // EventSource retries by itself, but if the server dropped our client
      // record we must re-handshake to get a fresh id/secret.
      es.close();
      this.source = null;
      if (this._closing) return;
      const delay = this._reconnectDelay;
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
      setTimeout(() => { if (!this._closing) this._openStream(); }, delay);
    };
  }

  disconnect() {
    this._closing = true;
    if (this.source) { this.source.close(); this.source = null; }
    this.connected = false;
    this.clientId = null;
    this.secret = null;
  }

  get live() { return this.connected && !!this.clientId && !!this.secret; }

  /* ----------------------------------------------------------- presence */

  /** Coalesced presence update - safe to call every frame. */
  presence(state) {
    this._presenceQueued = state;
    if (this._presenceTimer) return;
    this._presenceTimer = setTimeout(() => {
      this._presenceTimer = null;
      const payload = this._presenceQueued;
      this._presenceQueued = null;
      if (!payload || !this.live) return;
      postJSON('/api/presence', {
        clientId: this.clientId,
        secret: this.secret,
        name: payload.name ?? this._name,
        level: payload.level | 0,
        score: payload.score | 0,
        lives: payload.lives | 0,
        status: payload.status ?? 'lobby',
      }).catch((err) => {
        if (err.status === 410) this._openStream();
      });
    }, 1200);
  }

  /** Announce a moment worth sharing. Kinds are validated server side. */
  milestone(kind, { level = 0, score = 0, detail = '' } = {}) {
    if (!this.live) return;
    postJSON('/api/events', {
      clientId: this.clientId,
      secret: this.secret,
      kind, level: level | 0, score: score | 0, detail,
    }).catch(() => { /* a lost feed line is not worth surfacing */ });
  }

  async say(text) {
    if (!this.live) throw new Error('not connected to the defence net');
    return postJSON('/api/chat', { clientId: this.clientId, secret: this.secret, text });
  }

  /* --------------------------------------------------------------- runs */

  async startRun(name, startLevel = 1, difficulty = 'normal') {
    this._name = name || this._name;
    try {
      const data = await postJSON('/api/runs', {
        name: this._name,
        clientId: this.clientId ?? '',
        startLevel: startLevel | 0,
        difficulty,
      });
      this.runId = data.runId;
      this.runStartedAt = Date.now();
      return data;
    } catch (err) {
      console.warn('could not mint a run token; score will not be submitted', err);
      this.runId = null;
      return null;
    }
  }

  /**
   * Submits a finished run. Returns {entry, rank, leaderboard, stats} on
   * success, or an object with {error} when the server rejected it.
   */
  async submitScore(result) {
    if (!this.runId) return { error: 'offline run - not submitted' };
    const body = {
      runId: this.runId,
      name: result.name,
      score: result.score | 0,
      level: result.level | 0,
      kills: result.kills | 0,
      shots: result.shots | 0,
      hits: result.hits | 0,
      victory: !!result.victory,
      duration: Math.round(result.duration || 0),
    };
    this.runId = null; // a run token is single-use
    try {
      return await postJSON('/api/scores', body);
    } catch (err) {
      return { error: err.message || 'submission failed' };
    }
  }
}

export const net = new Net();
