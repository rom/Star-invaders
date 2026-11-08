// Package hub implements the live "shared space" layer: every connected
// player holds one Server-Sent Events stream, and the hub broadcasts the
// roster, a global event feed and squadron chat over it.
//
// SSE was chosen over WebSockets deliberately: the traffic is one-way
// fan-out plus a handful of small POSTs, EventSource reconnects on its own,
// and it keeps the server on the standard library with zero dependencies.
package hub

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sort"
	"sync"
	"time"
)

// Event types pushed to clients.
const (
	EventHello     = "hello"     // first frame on a new stream
	EventRoster    = "roster"    // who is online and what they are doing
	EventFeed      = "feed"      // something happened somewhere
	EventChat      = "chat"      // squadron channel message
	EventHighScore = "highscore" // a run made the leaderboard
	EventStats     = "stats"     // refreshed global aggregates
	EventPing      = "ping"      // keepalive
)

// Status values for a player in the roster.
const (
	StatusLobby   = "lobby"
	StatusPlaying = "playing"
	StatusDead    = "dead"
	StatusVictory = "victory"
)

// Event is one frame on the stream.
type Event struct {
	Type string          `json:"type"`
	At   time.Time       `json:"at"`
	Data json.RawMessage `json:"data,omitempty"`
}

// FeedItem is a line in the global activity feed.
type FeedItem struct {
	ID    int64     `json:"id"`
	Kind  string    `json:"kind"`
	Name  string    `json:"name"`
	Text  string    `json:"text"`
	Level int       `json:"level,omitempty"`
	Score int       `json:"score,omitempty"`
	At    time.Time `json:"at"`
}

// ChatItem is a squadron channel message.
type ChatItem struct {
	ID   int64     `json:"id"`
	Name string    `json:"name"`
	Text string    `json:"text"`
	At   time.Time `json:"at"`
}

// Player is the public view of one connected client.
type Player struct {
	ID     string    `json:"id"`
	Name   string    `json:"name"`
	Level  int       `json:"level"`
	Score  int       `json:"score"`
	Lives  int       `json:"lives"`
	Status string    `json:"status"`
	Best   int       `json:"best"`
	Since  time.Time `json:"since"`
}

// Client is a single live stream.
type Client struct {
	ID     string
	Secret string

	mu     sync.Mutex
	player Player
	out    chan Event
	closed bool
}

// Send queues an event, dropping it if the client is too far behind. A slow
// reader must never block the hub.
//
// The lock is held across the send: the channel is buffered and the send is
// non-blocking, so this cannot stall, and releasing the lock first would let
// a concurrent Leave close the channel between the check and the send -
// which panics the whole server, not just the disconnecting client.
func (c *Client) Send(e Event) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	select {
	case c.out <- e:
	default:
	}
}

// Events exposes the outbound channel for the HTTP handler.
func (c *Client) Events() <-chan Event { return c.out }

func (c *Client) close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.out)
	}
}

// Snapshot returns a copy of the client's public player record.
func (c *Client) Snapshot() Player {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.player
}

// Hub fans events out to every connected client.
type Hub struct {
	mu      sync.RWMutex
	clients map[string]*Client
	feed    []FeedItem
	chat    []ChatItem
	seq     int64
	maxFeed int
	maxChat int
	statsFn func() any
}

// New creates an empty hub. statsFn, if non-nil, supplies the global stats
// blob included in the hello frame and in periodic stats broadcasts.
func New(statsFn func() any) *Hub {
	return &Hub{
		clients: make(map[string]*Client),
		maxFeed: 60,
		maxChat: 40,
		statsFn: statsFn,
	}
}

func newID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		// rand.Read on a healthy system does not fail; fall back to time.
		return hex.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))[:24]
	}
	return hex.EncodeToString(b[:])
}

func event(kind string, payload any) Event {
	e := Event{Type: kind, At: time.Now().UTC()}
	if payload != nil {
		if raw, err := json.Marshal(payload); err == nil {
			e.Data = raw
		}
	}
	return e
}

// helloPayload is the first frame a new stream receives.
type helloPayload struct {
	You     Player     `json:"you"`
	Secret  string     `json:"secret"`
	Players []Player   `json:"players"`
	Feed    []FeedItem `json:"feed"`
	Chat    []ChatItem `json:"chat"`
	Stats   any        `json:"stats,omitempty"`
	Online  int        `json:"online"`
}

type rosterPayload struct {
	Online  int      `json:"online"`
	Players []Player `json:"players"`
}

// Join registers a new client and returns it along with the hello frame.
func (h *Hub) Join(name string, best int) *Client {
	c := &Client{
		ID:     newID(),
		Secret: newID(),
		out:    make(chan Event, 64),
	}
	c.player = Player{
		ID:     c.ID,
		Name:   name,
		Status: StatusLobby,
		Best:   best,
		Since:  time.Now().UTC(),
	}

	h.mu.Lock()
	h.clients[c.ID] = c
	players := h.playersLocked()
	feed := append([]FeedItem(nil), h.feed...)
	chat := append([]ChatItem(nil), h.chat...)
	online := len(h.clients)
	h.mu.Unlock()

	var stats any
	if h.statsFn != nil {
		stats = h.statsFn()
	}
	c.Send(event(EventHello, helloPayload{
		You:     c.player,
		Secret:  c.Secret,
		Players: players,
		Feed:    feed,
		Chat:    chat,
		Stats:   stats,
		Online:  online,
	}))

	h.Publish(FeedItem{Kind: "join", Name: name, Text: "joined the defence net"})
	h.broadcastRoster()
	return c
}

// Leave deregisters a client.
func (h *Hub) Leave(c *Client) {
	if c == nil {
		return
	}
	h.mu.Lock()
	_, existed := h.clients[c.ID]
	delete(h.clients, c.ID)
	h.mu.Unlock()
	c.close()
	if existed {
		p := c.Snapshot()
		h.Publish(FeedItem{Kind: "leave", Name: p.Name, Text: "left the defence net"})
		h.broadcastRoster()
	}
}

// Lookup resolves a client by id and secret. Both must match, so a client
// can only ever update its own presence record.
func (h *Hub) Lookup(id, secret string) (*Client, bool) {
	h.mu.RLock()
	c, ok := h.clients[id]
	h.mu.RUnlock()
	if !ok || c.Secret != secret {
		return nil, false
	}
	return c, true
}

// Update applies a presence change and refreshes the roster for everyone.
// The player's session best is maintained here rather than by the caller, so
// it holds however presence is reported.
func (h *Hub) Update(c *Client, apply func(*Player)) {
	c.mu.Lock()
	apply(&c.player)
	if c.player.Score > c.player.Best {
		c.player.Best = c.player.Score
	}
	c.mu.Unlock()
	h.broadcastRoster()
}

// Rename changes a client's display name.
func (h *Hub) Rename(c *Client, name string) {
	c.mu.Lock()
	old := c.player.Name
	c.player.Name = name
	c.mu.Unlock()
	if old != name {
		h.broadcastRoster()
	}
}

func (h *Hub) playersLocked() []Player {
	out := make([]Player, 0, len(h.clients))
	for _, c := range h.clients {
		out = append(out, c.Snapshot())
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Since.Before(out[j].Since)
	})
	return out
}

// Players returns the current roster.
func (h *Hub) Players() []Player {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.playersLocked()
}

// Online reports the number of connected clients.
func (h *Hub) Online() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func (h *Hub) broadcastRoster() {
	h.mu.RLock()
	players := h.playersLocked()
	online := len(h.clients)
	h.mu.RUnlock()
	h.Broadcast(event(EventRoster, rosterPayload{Online: online, Players: players}))
}

// Publish appends an item to the global feed and broadcasts it.
func (h *Hub) Publish(item FeedItem) {
	h.mu.Lock()
	h.seq++
	item.ID = h.seq
	item.At = time.Now().UTC()
	h.feed = append(h.feed, item)
	if len(h.feed) > h.maxFeed {
		h.feed = h.feed[len(h.feed)-h.maxFeed:]
	}
	h.mu.Unlock()
	h.Broadcast(event(EventFeed, item))
}

// Say appends a chat message and broadcasts it.
func (h *Hub) Say(name, text string) ChatItem {
	h.mu.Lock()
	h.seq++
	item := ChatItem{ID: h.seq, Name: name, Text: text, At: time.Now().UTC()}
	h.chat = append(h.chat, item)
	if len(h.chat) > h.maxChat {
		h.chat = h.chat[len(h.chat)-h.maxChat:]
	}
	h.mu.Unlock()
	h.Broadcast(event(EventChat, item))
	return item
}

// Feed returns a copy of the recent feed.
func (h *Hub) Feed() []FeedItem {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return append([]FeedItem(nil), h.feed...)
}

// Chat returns a copy of the recent chat log.
func (h *Hub) Chat() []ChatItem {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return append([]ChatItem(nil), h.chat...)
}

// AnnounceHighScore tells everyone about a leaderboard entry.
func (h *Hub) AnnounceHighScore(payload any) {
	h.Broadcast(event(EventHighScore, payload))
}

// AnnounceStats pushes refreshed aggregates.
func (h *Hub) AnnounceStats() {
	if h.statsFn == nil {
		return
	}
	h.Broadcast(event(EventStats, h.statsFn()))
}

// Broadcast sends an event to every connected client.
func (h *Hub) Broadcast(e Event) {
	h.mu.RLock()
	targets := make([]*Client, 0, len(h.clients))
	for _, c := range h.clients {
		targets = append(targets, c)
	}
	h.mu.RUnlock()
	for _, c := range targets {
		c.Send(e)
	}
}

// RunKeepalive emits a ping every interval so that proxies do not close idle
// streams, and refreshes the roster periodically to prune drift.
func (h *Hub) RunKeepalive(done <-chan struct{}, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			h.Broadcast(event(EventPing, map[string]int{"online": h.Online()}))
		case <-done:
			return
		}
	}
}
