package api

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// A run is a server-side handle minted when a player starts a game. Score
// submissions must present a valid, unspent run token, and the server checks
// that the wall-clock time taken is at least vaguely plausible for the level
// reached. The simulation itself lives in the browser, so this is a speed
// bump for casual forgery rather than real anti-cheat; it is documented as
// such in the README.
type run struct {
	ID         string
	Name       string
	StartLevel int // the level the player started on (level select)
	Started    time.Time
	Client     string // hub client id, if the player is on the live net
	IP         string
	Spent      bool
}

type runRegistry struct {
	mu   sync.Mutex
	runs map[string]*run
	ttl  time.Duration
}

func newRunRegistry(ttl time.Duration) *runRegistry {
	return &runRegistry{runs: make(map[string]*run), ttl: ttl}
}

func token() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b[:])
}

func (rr *runRegistry) start(name, clientID, ip string, startLevel int) *run {
	r := &run{
		ID: token(), Name: name, StartLevel: startLevel,
		Started: time.Now(), Client: clientID, IP: ip,
	}
	rr.mu.Lock()
	rr.runs[r.ID] = r
	rr.mu.Unlock()
	return r
}

// peek returns a live, unspent run without consuming it, so that a rejected
// submission does not cost the player their only chance to report the score.
func (rr *runRegistry) peek(id string) (run, bool) {
	rr.mu.Lock()
	defer rr.mu.Unlock()
	r, ok := rr.runs[id]
	if !ok || r.Spent {
		return run{}, false
	}
	return *r, true
}

// claim marks a run as spent. It is the atomic step that makes a run
// single-use even if two submissions race for the same token.
func (rr *runRegistry) claim(id string) bool {
	rr.mu.Lock()
	defer rr.mu.Unlock()
	r, ok := rr.runs[id]
	if !ok || r.Spent {
		return false
	}
	r.Spent = true
	return true
}

func (rr *runRegistry) sweep() {
	cutoff := time.Now().Add(-rr.ttl)
	rr.mu.Lock()
	defer rr.mu.Unlock()
	for id, r := range rr.runs {
		if r.Started.Before(cutoff) {
			delete(rr.runs, id)
		}
	}
}

func (rr *runRegistry) count() int {
	rr.mu.Lock()
	defer rr.mu.Unlock()
	return len(rr.runs)
}
