package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/rom/star-invaders/internal/game"
)

func draftLevel() map[string]any {
	return map[string]any{
		"name": "Cold Start", "tagline": "a level made in the editor",
		"music": "march", "backdrop": "void",
		"starSpeed": 1, "formationStep": 0.6, "formationDrop": 18, "globalFireMul": 1,
		"bunkers": 3, "dropChance": 0.1, "powerups": []string{"rapid", "shield"},
		"waves": []map[string]any{
			{"archetype": "grunt", "pattern": "grid", "rows": 2, "cols": 6, "count": 12, "y": 0.15},
			{"archetype": "scout", "pattern": "stream", "count": 4, "delay": 8, "interval": 5, "side": "random"},
		},
		"hazards": []map[string]any{
			{"archetype": "asteroid", "rate": 0.2, "max": 3, "delay": 5},
		},
	}
}

func createLevel(t *testing.T, srv *Server, author string, level map[string]any) (id, secret string) {
	t.Helper()
	w, body := do(t, srv, "POST", "/api/userlevels", map[string]any{"author": author, "level": level})
	if w.Code != http.StatusCreated {
		t.Fatalf("create status %d: %s", w.Code, w.Body.String())
	}
	entry := body["entry"].(map[string]any)
	return entry["id"].(string), body["secret"].(string)
}

func TestCreateAndFetchLevel(t *testing.T) {
	srv := newTestServer(t)
	id, secret := createLevel(t, srv, "NOVA-14", draftLevel())
	if id == "" || secret == "" {
		t.Fatal("create must return an id and an edit key")
	}

	w, body := do(t, srv, "GET", "/api/userlevels/"+id, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	entry := body["entry"].(map[string]any)
	if entry["author"] != "NOVA-14" {
		t.Errorf("author = %v", entry["author"])
	}
	lv := entry["level"].(map[string]any)
	if lv["name"] != "Cold Start" {
		t.Errorf("name = %v", lv["name"])
	}
	// The edit key must never come back from a read.
	if s, ok := entry["secret"]; ok && s != "" {
		t.Error("GET leaked the edit key")
	}
	if strings.Contains(w.Body.String(), secret) {
		t.Error("the response body contained the edit key")
	}
}

func TestListDoesNotLeakEditKeys(t *testing.T) {
	srv := newTestServer(t)
	_, secret := createLevel(t, srv, "A", draftLevel())
	w, body := do(t, srv, "GET", "/api/userlevels", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	if len(body["levels"].([]any)) != 1 {
		t.Errorf("levels = %v", body["levels"])
	}
	if strings.Contains(w.Body.String(), secret) {
		t.Fatal("the listing contained an edit key")
	}
}

func TestUnplayableLevelIsRejected(t *testing.T) {
	srv := newTestServer(t)
	lv := draftLevel()
	// Only hazards: nothing required, so the level could never be completed.
	lv["waves"] = []map[string]any{
		{"archetype": "asteroid", "pattern": "grid", "rows": 1, "cols": 3, "count": 3},
	}
	w, body := do(t, srv, "POST", "/api/userlevels", map[string]any{"author": "A", "level": lv})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
	problems, _ := body["problems"].([]any)
	if len(problems) == 0 {
		t.Fatal("a rejection should say what is wrong")
	}
	if srv.cfg.Levels.Count() != 0 {
		t.Error("a rejected level was stored anyway")
	}
}

func TestUnknownArchetypeIsRejected(t *testing.T) {
	srv := newTestServer(t)
	lv := draftLevel()
	lv["waves"] = []map[string]any{{"archetype": "space-goose", "pattern": "grid", "count": 4}}
	w, _ := do(t, srv, "POST", "/api/userlevels", map[string]any{"author": "A", "level": lv})
	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("status %d, want 422", w.Code)
	}
}

func TestSubmittedLevelIsNormalised(t *testing.T) {
	srv := newTestServer(t)
	lv := draftLevel()
	lv["name"] = "   Ragged   Edges  "
	lv["starSpeed"] = 99
	lv["bunkers"] = 17
	id, _ := createLevel(t, srv, "A", lv)

	stored, ok := srv.cfg.Levels.Get(id)
	if !ok {
		t.Fatal("level not stored")
	}
	if stored.Level.Name != "Ragged Edges" {
		t.Errorf("Name = %q", stored.Level.Name)
	}
	if stored.Level.StarSpeed != 4 || stored.Level.Bunkers != 4 {
		t.Errorf("values not clamped: starSpeed %v bunkers %d", stored.Level.StarSpeed, stored.Level.Bunkers)
	}
}

func TestUpdateRequiresTheEditKey(t *testing.T) {
	srv := newTestServer(t)
	id, secret := createLevel(t, srv, "A", draftLevel())

	changed := draftLevel()
	changed["name"] = "Renamed"

	w, _ := do(t, srv, "PUT", "/api/userlevels/"+id, map[string]any{"secret": "wrong", "level": changed})
	if w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403", w.Code)
	}
	if stored, _ := srv.cfg.Levels.Get(id); stored.Level.Name != "Cold Start" {
		t.Error("a rejected update changed the level")
	}

	w, _ = do(t, srv, "PUT", "/api/userlevels/"+id, map[string]any{"secret": secret, "level": changed})
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if stored, _ := srv.cfg.Levels.Get(id); stored.Level.Name != "Renamed" {
		t.Error("the update did not land")
	}
}

func TestDeleteRequiresTheEditKey(t *testing.T) {
	srv := newTestServer(t)
	id, secret := createLevel(t, srv, "A", draftLevel())

	if w, _ := do(t, srv, "DELETE", "/api/userlevels/"+id, map[string]any{"secret": "nope"}); w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403", w.Code)
	}
	if srv.cfg.Levels.Count() != 1 {
		t.Fatal("a rejected delete removed the level")
	}
	if w, _ := do(t, srv, "DELETE", "/api/userlevels/"+id, map[string]any{"secret": secret}); w.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204", w.Code)
	}
	if srv.cfg.Levels.Count() != 0 {
		t.Error("the level survived deletion")
	}
}

func TestMissingLevelIsNotFound(t *testing.T) {
	srv := newTestServer(t)
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"GET", "/api/userlevels/nope", nil},
		{"PUT", "/api/userlevels/nope", map[string]any{"secret": "x", "level": draftLevel()}},
		{"DELETE", "/api/userlevels/nope", map[string]any{"secret": "x"}},
		{"POST", "/api/userlevels/nope/play", nil},
	} {
		w, _ := do(t, srv, c.method, c.path, c.body)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s %s status %d, want 404", c.method, c.path, w.Code)
		}
	}
}

// The editor checks a draft as it is typed, without storing anything.
func TestValidateDoesNotStore(t *testing.T) {
	srv := newTestServer(t)
	w, body := do(t, srv, "POST", "/api/userlevels/validate", map[string]any{"level": draftLevel()})
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	if body["playable"] != true {
		t.Errorf("playable = %v, problems = %v", body["playable"], body["problems"])
	}
	if body["level"] == nil {
		t.Error("validate should return the normalised level")
	}
	if srv.cfg.Levels.Count() != 0 {
		t.Error("validate stored something")
	}
}

func TestValidateReportsProblemsWithoutRejecting(t *testing.T) {
	srv := newTestServer(t)
	lv := draftLevel()
	lv["music"] = "jazz"
	w, body := do(t, srv, "POST", "/api/userlevels/validate", map[string]any{"level": lv})
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200 even for a broken draft", w.Code)
	}
	if body["playable"] != false {
		t.Error("playable should be false")
	}
	raw, _ := json.Marshal(body["problems"])
	var ps []game.Problem
	_ = json.Unmarshal(raw, &ps)
	found := false
	for _, p := range ps {
		if p.Field == "music" && p.Fatal {
			found = true
		}
	}
	if !found {
		t.Errorf("expected a fatal problem about music, got %s", raw)
	}
}

func TestRecordPlay(t *testing.T) {
	srv := newTestServer(t)
	id, _ := createLevel(t, srv, "A", draftLevel())
	if w, _ := do(t, srv, "POST", "/api/userlevels/"+id+"/play", nil); w.Code != http.StatusNoContent {
		t.Fatalf("status %d", w.Code)
	}
	if stored, _ := srv.cfg.Levels.Get(id); stored.Plays != 1 {
		t.Errorf("Plays = %d", stored.Plays)
	}
}

// Publishing a level is something the rest of the server hears about.
func TestPublishingAnnouncesToTheFeed(t *testing.T) {
	srv := newTestServer(t)
	createLevel(t, srv, "NOVA-14", draftLevel())
	feed := srv.hub.Feed()
	if len(feed) == 0 {
		t.Fatal("nothing reached the feed")
	}
	last := feed[len(feed)-1]
	if last.Kind != "published" || last.Name != "NOVA-14" {
		t.Fatalf("feed item = %+v", last)
	}
	if !strings.Contains(last.Text, "Cold Start") {
		t.Errorf("feed text = %q", last.Text)
	}
}

func TestHealthReportsStoredLevels(t *testing.T) {
	srv := newTestServer(t)
	createLevel(t, srv, "A", draftLevel())
	_, body := do(t, srv, "GET", "/api/health", nil)
	if int(body["userLevels"].(float64)) != 1 {
		t.Errorf("userLevels = %v", body["userLevels"])
	}
}
