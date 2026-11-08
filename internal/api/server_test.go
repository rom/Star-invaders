package api

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/rom/star-invaders/internal/game"
	"github.com/rom/star-invaders/internal/scores"
	"github.com/rom/star-invaders/internal/userlevels"
)

func newTestServer(t *testing.T) *Server {
	t.Helper()
	store, err := scores.New(filepath.Join(t.TempDir(), "scores.json"))
	if err != nil {
		t.Fatalf("scores.New: %v", err)
	}
	assets := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<!doctype html><title>Star Invaders</title>")},
		"js/main.js": &fstest.MapFile{Data: []byte("// game")},
	}
	levels, err := userlevels.New(filepath.Join(t.TempDir(), "userlevels.json"))
	if err != nil {
		t.Fatalf("userlevels.New: %v", err)
	}
	srv, err := New(Config{
		Assets:  assets,
		Store:   store,
		Levels:  levels,
		Logger:  log.New(io.Discard, "", 0),
		Version: "test",
	})
	if err != nil {
		t.Fatalf("api.New: %v", err)
	}
	t.Cleanup(srv.Close)
	return srv
}

func do(t *testing.T, srv *Server, method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var r *http.Request
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r = httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, path, nil)
	}
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, r)
	var out map[string]any
	if w.Body.Len() > 0 {
		_ = json.Unmarshal(w.Body.Bytes(), &out)
	}
	return w, out
}

func TestHealth(t *testing.T) {
	srv := newTestServer(t)
	w, body := do(t, srv, "GET", "/api/health", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	if body["status"] != "ok" || body["version"] != "test" {
		t.Errorf("unexpected body %v", body)
	}
	if int(body["levels"].(float64)) != game.MaxLevel() {
		t.Errorf("levels = %v", body["levels"])
	}
}

func TestLevelsEndpointServesTheCampaign(t *testing.T) {
	srv := newTestServer(t)
	w, _ := do(t, srv, "GET", "/api/levels", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	var c game.Campaign
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(c.Levels) != game.MaxLevel() || len(c.Archetypes) == 0 {
		t.Errorf("campaign looks wrong: %d levels, %d archetypes", len(c.Levels), len(c.Archetypes))
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q", ct)
	}
}

func TestStaticAssetsAreServed(t *testing.T) {
	srv := newTestServer(t)
	w, _ := do(t, srv, "GET", "/", nil)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "Star Invaders") {
		t.Errorf("index not served: %d %q", w.Code, w.Body.String())
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Error("security headers missing")
	}
}

// startRun mints a token and, for the duration checks, backdates it.
func startRun(t *testing.T, srv *Server, name string, startLevel int, age time.Duration) string {
	t.Helper()
	return startRunOn(t, srv, name, startLevel, "normal", age)
}

func startRunOn(t *testing.T, srv *Server, name string, startLevel int, difficulty string, age time.Duration) string {
	t.Helper()
	w, body := do(t, srv, "POST", "/api/runs", map[string]any{
		"name": name, "startLevel": startLevel, "difficulty": difficulty,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("run start status %d: %s", w.Code, w.Body.String())
	}
	id, _ := body["runId"].(string)
	if id == "" {
		t.Fatal("no run id returned")
	}
	if age > 0 {
		srv.runs.mu.Lock()
		srv.runs.runs[id].Started = time.Now().Add(-age)
		srv.runs.mu.Unlock()
	}
	return id
}

func TestSubmitScoreHappyPath(t *testing.T) {
	srv := newTestServer(t)
	id := startRun(t, srv, "PILOT", 1, 5*time.Minute)

	w, body := do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "PILOT", "score": 12000, "level": 3,
		"kills": 60, "shots": 100, "hits": 71, "victory": false, "duration": 300,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	entry := body["entry"].(map[string]any)
	if entry["name"] != "PILOT" || int(entry["score"].(float64)) != 12000 {
		t.Errorf("entry = %v", entry)
	}
	if int(entry["accuracy"].(float64)*10) != 710 {
		t.Errorf("accuracy = %v, want 71", entry["accuracy"])
	}
	if int(body["rank"].(float64)) != 1 {
		t.Errorf("rank = %v", body["rank"])
	}
	if srv.cfg.Store.Count() != 1 {
		t.Errorf("store holds %d entries", srv.cfg.Store.Count())
	}
}

func TestSubmitScoreRejectsForgery(t *testing.T) {
	srv := newTestServer(t)
	id := startRun(t, srv, "CHEAT", 1, time.Hour)
	w, body := do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "CHEAT", "score": 999999999, "level": 2,
		"kills": 1, "shots": 1, "hits": 1, "duration": 3600,
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422", w.Code)
	}
	if !strings.Contains(body["error"].(string), "ceiling") {
		t.Errorf("error = %v", body["error"])
	}
	// The rejection must not have burned the token.
	if _, ok := srv.runs.peek(id); !ok {
		t.Error("a rejected submission consumed the run token")
	}
}

func TestSubmitScoreRejectsImpossiblyFastRuns(t *testing.T) {
	srv := newTestServer(t)
	id := startRun(t, srv, "FAST", 1, 0)
	w, _ := do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "FAST", "score": 60000, "level": 6,
		"kills": 200, "shots": 200, "hits": 200, "duration": 1,
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422", w.Code)
	}
}

// Dying in the first seconds is a real thing; a trivial score must still post.
func TestSubmitScoreAcceptsAQuickDeath(t *testing.T) {
	srv := newTestServer(t)
	id := startRun(t, srv, "UNLUCKY", 1, 0)
	w, _ := do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "UNLUCKY", "score": 300, "level": 1,
		"kills": 3, "shots": 9, "hits": 3, "duration": 3,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}
}

// Starting on level 9 must not inherit the score allowance of levels 1-8.
func TestSubmitScoreUsesTheStartLevelForTheCeiling(t *testing.T) {
	srv := newTestServer(t)
	full := game.ScoreCeilingRange(1, 10)
	id := startRun(t, srv, "SELECTOR", 9, time.Hour)
	w, _ := do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "SELECTOR", "score": full, "level": 10,
		"kills": 10, "shots": 10, "hits": 10, "duration": 600,
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422 (the whole-campaign allowance leaked in)", w.Code)
	}
}

func TestSubmitScoreIsSingleUse(t *testing.T) {
	srv := newTestServer(t)
	id := startRun(t, srv, "ONCE", 1, time.Hour)
	payload := map[string]any{
		"runId": id, "name": "ONCE", "score": 1000, "level": 1,
		"kills": 5, "shots": 10, "hits": 5, "duration": 60,
	}
	if w, _ := do(t, srv, "POST", "/api/scores", payload); w.Code != http.StatusCreated {
		t.Fatalf("first submit status %d", w.Code)
	}
	if w, _ := do(t, srv, "POST", "/api/scores", payload); w.Code != http.StatusForbidden {
		t.Errorf("replay status %d, want 403", w.Code)
	}
}

func TestSubmitScoreRejectsUnknownRun(t *testing.T) {
	srv := newTestServer(t)
	w, _ := do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": "nope", "name": "X", "score": 10, "level": 1, "duration": 60,
	})
	if w.Code != http.StatusForbidden {
		t.Errorf("status %d, want 403", w.Code)
	}
}

func TestSubmitScoreRejectsNonsense(t *testing.T) {
	srv := newTestServer(t)
	id := startRun(t, srv, "BAD", 1, time.Hour)
	w, _ := do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "BAD", "score": -5, "level": 1, "duration": 60,
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400", w.Code)
	}
}

func TestMalformedBodyIsRejected(t *testing.T) {
	srv := newTestServer(t)
	r := httptest.NewRequest("POST", "/api/scores", strings.NewReader("{ not json"))
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400", w.Code)
	}
}

func TestPresenceAndMilestonesRequireAStream(t *testing.T) {
	srv := newTestServer(t)
	cases := map[string]map[string]any{
		"/api/presence": {"clientId": "ghost", "secret": "ghost", "name": "G", "status": "playing"},
		"/api/events":   {"clientId": "ghost", "secret": "ghost", "kind": "level", "level": 1},
		"/api/chat":     {"clientId": "ghost", "secret": "ghost", "text": "hi"},
	}
	for path, body := range cases {
		w, _ := do(t, srv, "POST", path, body)
		if w.Code != http.StatusGone {
			t.Errorf("%s status %d, want 410", path, w.Code)
		}
	}
}

// Unknown fields are refused so that a typo in the client is loud, not silent.
func TestUnknownFieldsAreRejected(t *testing.T) {
	srv := newTestServer(t)
	w, _ := do(t, srv, "POST", "/api/runs", map[string]any{"name": "A", "surprise": true})
	if w.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400", w.Code)
	}
}

func TestMilestoneTextIsServerAuthored(t *testing.T) {
	srv := newTestServer(t)
	client := srv.hub.Join("PILOT", 0)
	defer srv.hub.Leave(client)

	w, _ := do(t, srv, "POST", "/api/events", map[string]any{
		"clientId": client.ID, "secret": client.Secret,
		"kind": "level", "level": 3, "score": 500, "detail": "<script>alert(1)</script>",
	})
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d", w.Code)
	}
	feed := srv.hub.Feed()
	last := feed[len(feed)-1]
	if strings.Contains(last.Text, "script") {
		t.Errorf("client supplied text reached the feed: %q", last.Text)
	}
	if !strings.Contains(last.Text, "Scout Patrol") {
		t.Errorf("feed line should name the level, got %q", last.Text)
	}

	// An unknown kind must be refused outright.
	w, _ = do(t, srv, "POST", "/api/events", map[string]any{
		"clientId": client.ID, "secret": client.Secret, "kind": "anything-goes",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("unknown milestone status %d, want 400", w.Code)
	}
}

func TestChatIsSanitisedAndAttributedToTheConnectedName(t *testing.T) {
	srv := newTestServer(t)
	client := srv.hub.Join("REALNAME", 0)
	defer srv.hub.Leave(client)

	w, body := do(t, srv, "POST", "/api/chat", map[string]any{
		"clientId": client.ID, "secret": client.Secret, "text": "  good  hunting \x00 ",
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d", w.Code)
	}
	if body["text"] != "good hunting" {
		t.Errorf("text = %q", body["text"])
	}
	if body["name"] != "REALNAME" {
		t.Errorf("name = %q, want the connected handle", body["name"])
	}

	w, _ = do(t, srv, "POST", "/api/chat", map[string]any{
		"clientId": client.ID, "secret": client.Secret, "text": "    ",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("empty chat status %d, want 400", w.Code)
	}
}

func TestPresenceClampsReportedFigures(t *testing.T) {
	srv := newTestServer(t)
	client := srv.hub.Join("PILOT", 0)
	defer srv.hub.Leave(client)

	w, _ := do(t, srv, "POST", "/api/presence", map[string]any{
		"clientId": client.ID, "secret": client.Secret, "name": "PILOT",
		"level": 9999, "score": 1 << 40, "lives": 999, "status": "nonsense",
	})
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d", w.Code)
	}
	p := client.Snapshot()
	if p.Level != game.MaxLevel() {
		t.Errorf("level = %d, want clamped to %d", p.Level, game.MaxLevel())
	}
	if p.Score > game.MaxScore() {
		t.Errorf("score = %d, not clamped", p.Score)
	}
	if p.Lives != 99 {
		t.Errorf("lives = %d, want clamped to 99", p.Lives)
	}
	if p.Status != "lobby" {
		t.Errorf("status = %q, want the safe default", p.Status)
	}
}

func TestStreamSendsHelloAndClosesWithTheRequest(t *testing.T) {
	srv := newTestServer(t)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	req, _ := http.NewRequest("GET", ts.URL+"/api/stream?name=STREAMER&best=500", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q", ct)
	}

	buf := make([]byte, 2048)
	deadline := time.Now().Add(3 * time.Second)
	var got string
	for time.Now().Before(deadline) && !strings.Contains(got, "event: hello") {
		n, err := resp.Body.Read(buf)
		got += string(buf[:n])
		if err != nil {
			break
		}
	}
	if !strings.Contains(got, "event: hello") || !strings.Contains(got, "STREAMER") {
		t.Fatalf("hello frame missing from stream: %q", got)
	}
	if srv.hub.Online() != 1 {
		t.Errorf("hub Online = %d, want 1", srv.hub.Online())
	}

	resp.Body.Close()
	for i := 0; i < 100 && srv.hub.Online() != 0; i++ {
		time.Sleep(20 * time.Millisecond)
	}
	if srv.hub.Online() != 0 {
		t.Error("closing the request should remove the player from the roster")
	}
}

func TestScoresEndpointLimits(t *testing.T) {
	srv := newTestServer(t)
	for i := 0; i < 5; i++ {
		id := startRun(t, srv, "P", 1, time.Hour)
		do(t, srv, "POST", "/api/scores", map[string]any{
			"runId": id, "name": "P", "score": 100 * (i + 1), "level": 1,
			"kills": 1, "shots": 1, "hits": 1, "duration": 60,
		})
	}
	_, body := do(t, srv, "GET", "/api/scores?limit=2", nil)
	list := body["scores"].([]any)
	if len(list) != 2 {
		t.Errorf("limit ignored, got %d rows", len(list))
	}
	if int(body["total"].(float64)) != 5 {
		t.Errorf("total = %v", body["total"])
	}
	_, body = do(t, srv, "GET", "/api/scores?limit=banana", nil)
	if len(body["scores"].([]any)) != 5 {
		t.Error("a bad limit should fall back to the default")
	}
}

func TestStatsReflectSubmissions(t *testing.T) {
	srv := newTestServer(t)
	id := startRun(t, srv, "WINNER", 1, time.Hour)
	do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "WINNER", "score": 50000, "level": 12,
		"kills": 300, "shots": 600, "hits": 400, "victory": true, "duration": 900,
	})
	_, body := do(t, srv, "GET", "/api/stats", nil)
	if int(body["victories"].(float64)) != 1 {
		t.Errorf("victories = %v", body["victories"])
	}
	if int(body["highestLevel"].(float64)) != 12 {
		t.Errorf("highestLevel = %v", body["highestLevel"])
	}
	if body["bestName"] != "WINNER" {
		t.Errorf("bestName = %v", body["bestName"])
	}
}

func TestRateLimitingKicksIn(t *testing.T) {
	srv := newTestServer(t)
	client := srv.hub.Join("SPAMMER", 0)
	defer srv.hub.Leave(client)

	limited := false
	for i := 0; i < 30; i++ {
		w, _ := do(t, srv, "POST", "/api/chat", map[string]any{
			"clientId": client.ID, "secret": client.Secret, "text": "spam",
		})
		if w.Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Error("chat flood was never rate limited")
	}
}

func TestClientIPPrefersForwardedHeaders(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "10.0.0.1:1234"
	if got := clientIP(r); got != "10.0.0.1" {
		t.Errorf("clientIP = %q", got)
	}
	r.Header.Set("X-Real-IP", "9.9.9.9")
	if got := clientIP(r); got != "9.9.9.9" {
		t.Errorf("clientIP = %q", got)
	}
	r.Header.Set("X-Forwarded-For", "1.1.1.1, 2.2.2.2")
	if got := clientIP(r); got != "1.1.1.1" {
		t.Errorf("clientIP = %q", got)
	}
}

// ---------------------------------------------------------------- difficulty

func TestRunRecordsTheChosenTier(t *testing.T) {
	srv := newTestServer(t)
	w, body := do(t, srv, "POST", "/api/runs", map[string]any{"name": "A", "difficulty": "insane"})
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	if body["difficulty"] != "insane" {
		t.Errorf("difficulty = %v", body["difficulty"])
	}
	// An unknown tier falls back rather than failing the launch.
	_, body = do(t, srv, "POST", "/api/runs", map[string]any{"name": "A", "difficulty": "nightmare"})
	if body["difficulty"] != "normal" {
		t.Errorf("unknown tier = %v, want the default", body["difficulty"])
	}
}

// The ceiling has to follow the tier, or an honest insane run reads as a
// forgery and an inflated easy one slips through.
func TestCeilingScalesWithTheTier(t *testing.T) {
	srv := newTestServer(t)
	normalCeiling := game.ScoreCeilingRange(1, 3)

	// A score above normal's ceiling is fine on insane.
	id := startRunOn(t, srv, "HARDCORE", 1, "insane", time.Hour)
	w, _ := do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "HARDCORE", "score": normalCeiling + 1000, "level": 3,
		"kills": 100, "shots": 200, "hits": 150, "duration": 600,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("insane run status %d, want 201: %s", w.Code, w.Body.String())
	}

	// The same score on super easy is not.
	id = startRunOn(t, srv, "CASUAL", 1, "supereasy", time.Hour)
	w, _ = do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "CASUAL", "score": normalCeiling + 1000, "level": 3,
		"kills": 100, "shots": 200, "hits": 150, "duration": 600,
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("super easy run status %d, want 422", w.Code)
	}
}

// The tier is fixed at launch, so a run cannot be replayed as a harder one
// to borrow its score allowance.
func TestTierCannotBeChangedAtSubmission(t *testing.T) {
	srv := newTestServer(t)
	id := startRunOn(t, srv, "A", 1, "supereasy", time.Hour)
	w, _ := do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "A", "score": 1000, "level": 1,
		"kills": 5, "shots": 10, "hits": 5, "duration": 60,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if got := srv.cfg.Store.Top(1)[0].Difficulty; got != "supereasy" {
		t.Errorf("stored difficulty = %q, want the one chosen at launch", got)
	}
}

func TestScoreEntryAndFeedCarryTheTier(t *testing.T) {
	srv := newTestServer(t)
	id := startRunOn(t, srv, "PILOT", 1, "hard", time.Hour)
	_, body := do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "PILOT", "score": 5000, "level": 2,
		"kills": 30, "shots": 60, "hits": 40, "duration": 300,
	})
	entry := body["entry"].(map[string]any)
	if entry["difficulty"] != "hard" {
		t.Errorf("entry difficulty = %v", entry["difficulty"])
	}
	feed := srv.hub.Feed()
	last := feed[len(feed)-1]
	if !strings.Contains(last.Text, "hard") {
		t.Errorf("feed line should name a non-default tier: %q", last.Text)
	}

	// A normal run should not clutter the feed with its tier.
	id = startRunOn(t, srv, "PILOT2", 1, "normal", time.Hour)
	do(t, srv, "POST", "/api/scores", map[string]any{
		"runId": id, "name": "PILOT2", "score": 100, "level": 1,
		"kills": 1, "shots": 1, "hits": 1, "duration": 60,
	})
	feed = srv.hub.Feed()
	if strings.Contains(feed[len(feed)-1].Text, "normal") {
		t.Errorf("the default tier should be implicit: %q", feed[len(feed)-1].Text)
	}
}

func TestCampaignServesTheTiers(t *testing.T) {
	srv := newTestServer(t)
	w, _ := do(t, srv, "GET", "/api/levels", nil)
	var c game.Campaign
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Difficulties) != len(game.Difficulties) {
		t.Errorf("campaign carries %d tiers", len(c.Difficulties))
	}
	if len(c.Levels) != 25 {
		t.Errorf("campaign carries %d levels, want 25", len(c.Levels))
	}
}
