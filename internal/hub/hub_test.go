package hub

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
)

func drain(t *testing.T, c *Client, want string, timeout time.Duration) Event {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case ev, ok := <-c.Events():
			if !ok {
				t.Fatalf("stream closed while waiting for %q", want)
			}
			if ev.Type == want {
				return ev
			}
		case <-deadline:
			t.Fatalf("timed out waiting for a %q event", want)
		}
	}
}

func TestJoinSendsHelloWithCredentials(t *testing.T) {
	h := New(func() any { return map[string]int{"gamesPlayed": 7} })
	c := h.Join("PILOT", 1234)
	defer h.Leave(c)

	ev := drain(t, c, EventHello, time.Second)
	var p helloPayload
	if err := json.Unmarshal(ev.Data, &p); err != nil {
		t.Fatalf("hello payload: %v", err)
	}
	if p.You.Name != "PILOT" || p.You.Best != 1234 {
		t.Errorf("hello carried %+v", p.You)
	}
	if p.Secret == "" || p.You.ID == "" {
		t.Error("hello must carry an id and secret so the client can post updates")
	}
	if p.Online != 1 {
		t.Errorf("Online = %d, want 1", p.Online)
	}
	if p.Stats == nil {
		t.Error("hello should carry the stats snapshot")
	}
}

func TestLookupRequiresTheMatchingSecret(t *testing.T) {
	h := New(nil)
	c := h.Join("A", 0)
	defer h.Leave(c)

	if _, ok := h.Lookup(c.ID, c.Secret); !ok {
		t.Error("the owner should resolve")
	}
	if _, ok := h.Lookup(c.ID, "wrong"); ok {
		t.Error("a bad secret must not resolve")
	}
	if _, ok := h.Lookup("nobody", c.Secret); ok {
		t.Error("an unknown id must not resolve")
	}
}

func TestLeaveRemovesFromRoster(t *testing.T) {
	h := New(nil)
	a := h.Join("A", 0)
	b := h.Join("B", 0)
	if h.Online() != 2 {
		t.Fatalf("Online = %d, want 2", h.Online())
	}
	h.Leave(a)
	if h.Online() != 1 {
		t.Errorf("Online = %d, want 1 after a leave", h.Online())
	}
	// A second Leave must be harmless, not a double close.
	h.Leave(a)
	h.Leave(b)
	if h.Online() != 0 {
		t.Errorf("Online = %d, want 0", h.Online())
	}
}

func TestRosterIsSortedByScore(t *testing.T) {
	h := New(nil)
	low := h.Join("LOW", 0)
	high := h.Join("HIGH", 0)
	defer h.Leave(low)
	defer h.Leave(high)

	h.Update(high, func(p *Player) { p.Score = 9000; p.Status = StatusPlaying })
	h.Update(low, func(p *Player) { p.Score = 10; p.Status = StatusPlaying })

	players := h.Players()
	if len(players) != 2 || players[0].Name != "HIGH" {
		t.Errorf("roster not sorted by score: %+v", players)
	}
}

func TestUpdateTracksPersonalBest(t *testing.T) {
	h := New(nil)
	c := h.Join("A", 100)
	defer h.Leave(c)
	h.Update(c, func(p *Player) { p.Score = 5000 })
	if got := c.Snapshot().Best; got != 5000 {
		t.Errorf("Best = %d, want 5000", got)
	}
	h.Update(c, func(p *Player) { p.Score = 20 })
	if got := c.Snapshot().Best; got != 5000 {
		t.Errorf("Best regressed to %d", got)
	}
}

func TestFeedAndChatAreRingBuffered(t *testing.T) {
	h := New(nil)
	for i := 0; i < h.maxFeed+20; i++ {
		h.Publish(FeedItem{Kind: "level", Name: "P", Text: "cleared something"})
	}
	for i := 0; i < h.maxChat+15; i++ {
		h.Say("P", "hi")
	}
	if got := len(h.Feed()); got != h.maxFeed {
		t.Errorf("feed length = %d, want %d", got, h.maxFeed)
	}
	if got := len(h.Chat()); got != h.maxChat {
		t.Errorf("chat length = %d, want %d", got, h.maxChat)
	}
	feed := h.Feed()
	for i := 1; i < len(feed); i++ {
		if feed[i].ID <= feed[i-1].ID {
			t.Fatal("feed ids should increase monotonically")
		}
	}
}

func TestBroadcastReachesEveryClient(t *testing.T) {
	h := New(nil)
	a := h.Join("A", 0)
	b := h.Join("B", 0)
	defer h.Leave(a)
	defer h.Leave(b)

	h.Say("A", "form up")
	for _, c := range []*Client{a, b} {
		ev := drain(t, c, EventChat, time.Second)
		var item ChatItem
		if err := json.Unmarshal(ev.Data, &item); err != nil {
			t.Fatalf("chat payload: %v", err)
		}
		if item.Text != "form up" {
			t.Errorf("got %q", item.Text)
		}
	}
}

// A client that stops reading must not wedge the hub for everyone else.
func TestSlowClientDoesNotBlockTheHub(t *testing.T) {
	h := New(nil)
	slow := h.Join("SLOW", 0)
	fast := h.Join("FAST", 0)
	defer h.Leave(slow)
	defer h.Leave(fast)

	done := make(chan struct{})
	go func() {
		for i := 0; i < 500; i++ {
			h.Publish(FeedItem{Kind: "level", Name: "x", Text: "y"})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Publish blocked on a client that never reads")
	}
	// The fast client can still receive after the flood.
	go func() {
		for range fast.Events() {
		}
	}()
	h.Say("FAST", "still here")
}

func TestConcurrentJoinLeaveIsSafe(t *testing.T) {
	h := New(func() any { return map[string]int{} })
	var wg sync.WaitGroup
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c := h.Join("RACE", 0)
			h.Update(c, func(p *Player) { p.Level = 3 })
			_ = h.Players()
			_ = h.Feed()
			h.Leave(c)
		}()
	}
	wg.Wait()
	if h.Online() != 0 {
		t.Errorf("Online = %d, want 0", h.Online())
	}
}

func TestRenameUpdatesTheRoster(t *testing.T) {
	h := New(nil)
	c := h.Join("OLD", 0)
	defer h.Leave(c)
	h.Rename(c, "NEW")
	if got := c.Snapshot().Name; got != "NEW" {
		t.Errorf("Name = %q, want NEW", got)
	}
}
