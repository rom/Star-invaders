package scores

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func newTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "scores.json")
	s, err := New(path)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s, path
}

func TestSubmitOrdersByScoreThenAge(t *testing.T) {
	s, _ := newTestStore(t)
	for _, e := range []Entry{
		{Name: "LOW", Score: 100, Level: 1},
		{Name: "HIGH", Score: 9000, Level: 4},
		{Name: "MID", Score: 500, Level: 2},
	} {
		if _, _, err := s.Submit(e); err != nil {
			t.Fatalf("Submit: %v", err)
		}
	}
	top := s.Top(10)
	if len(top) != 3 {
		t.Fatalf("Top returned %d entries", len(top))
	}
	if top[0].Name != "HIGH" || top[1].Name != "MID" || top[2].Name != "LOW" {
		t.Errorf("unexpected order: %v %v %v", top[0].Name, top[1].Name, top[2].Name)
	}
	for _, e := range top {
		if e.ID == "" || e.CreatedAt.IsZero() {
			t.Errorf("entry %s was not stamped with an id/time", e.Name)
		}
	}
}

func TestSubmitReturnsRank(t *testing.T) {
	s, _ := newTestStore(t)
	_, _, _ = s.Submit(Entry{Name: "A", Score: 5000})
	_, _, _ = s.Submit(Entry{Name: "B", Score: 7000})
	_, rank, err := s.Submit(Entry{Name: "C", Score: 6000})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if rank != 2 {
		t.Errorf("rank = %d, want 2", rank)
	}
}

func TestStatsAggregate(t *testing.T) {
	s, _ := newTestStore(t)
	_, _, _ = s.Submit(Entry{Name: "A", Score: 100, Level: 2, Kills: 10, Duration: 30})
	_, _, _ = s.Submit(Entry{Name: "B", Score: 900, Level: 12, Kills: 40, Duration: 120, Victory: true})

	st := s.Stats()
	if st.GamesPlayed != 2 {
		t.Errorf("GamesPlayed = %d, want 2", st.GamesPlayed)
	}
	if st.TotalKills != 50 {
		t.Errorf("TotalKills = %d, want 50", st.TotalKills)
	}
	if st.TotalScore != 1000 {
		t.Errorf("TotalScore = %d, want 1000", st.TotalScore)
	}
	if st.BestScore != 900 || st.BestName != "B" {
		t.Errorf("best = %d by %q, want 900 by B", st.BestScore, st.BestName)
	}
	if st.HighestLevel != 12 {
		t.Errorf("HighestLevel = %d, want 12", st.HighestLevel)
	}
	if st.Victories != 1 {
		t.Errorf("Victories = %d, want 1", st.Victories)
	}
	if st.TotalSeconds != 150 {
		t.Errorf("TotalSeconds = %d, want 150", st.TotalSeconds)
	}
}

func TestRankOf(t *testing.T) {
	s, _ := newTestStore(t)
	_, _, _ = s.Submit(Entry{Name: "A", Score: 1000})
	_, _, _ = s.Submit(Entry{Name: "B", Score: 500})
	if got := s.RankOf(2000); got != 1 {
		t.Errorf("RankOf(2000) = %d, want 1", got)
	}
	if got := s.RankOf(750); got != 2 {
		t.Errorf("RankOf(750) = %d, want 2", got)
	}
	if got := s.RankOf(1); got != 3 {
		t.Errorf("RankOf(1) = %d, want 3", got)
	}
}

func TestFlushAndReload(t *testing.T) {
	s, path := newTestStore(t)
	_, _, _ = s.Submit(Entry{Name: "KEEP", Score: 4321, Level: 6, Kills: 22, Accuracy: 55.5})
	if err := s.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected the table on disk: %v", err)
	}

	reopened, err := New(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	top := reopened.Top(5)
	if len(top) != 1 || top[0].Name != "KEEP" || top[0].Score != 4321 {
		t.Fatalf("reloaded table is wrong: %+v", top)
	}
	if reopened.Stats().GamesPlayed != 1 {
		t.Errorf("stats did not survive the round trip: %+v", reopened.Stats())
	}

	// A second flush with nothing new must be a no-op, not an error.
	if err := reopened.Flush(); err != nil {
		t.Errorf("no-op Flush: %v", err)
	}
}

func TestLoadToleratesACorruptFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "scores.json")
	if err := os.WriteFile(path, []byte("{not json at all"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := New(path)
	if err != nil {
		t.Fatalf("a corrupt table must not stop the server booting: %v", err)
	}
	if s.Count() != 0 {
		t.Errorf("expected an empty table, got %d entries", s.Count())
	}
	matches, _ := filepath.Glob(path + ".corrupt.*")
	if len(matches) != 1 {
		t.Errorf("expected the bad file to be set aside, found %v", matches)
	}
}

func TestRetainedEntriesAreCapped(t *testing.T) {
	s, _ := newTestStore(t)
	for i := 0; i < maxKept+50; i++ {
		if _, _, err := s.Submit(Entry{Name: "P", Score: i}); err != nil {
			t.Fatal(err)
		}
	}
	if s.Count() != maxKept {
		t.Errorf("Count = %d, want the cap of %d", s.Count(), maxKept)
	}
	if top := s.Top(1); top[0].Score != maxKept+49 {
		t.Errorf("the best score was evicted: %d", top[0].Score)
	}
	if s.Stats().GamesPlayed != maxKept+50 {
		t.Error("eviction must not lose the lifetime game count")
	}
}

func TestConcurrentSubmitsAreSafe(t *testing.T) {
	s, _ := newTestStore(t)
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_, _, _ = s.Submit(Entry{Name: "RACE", Score: n * 10, Level: 1})
			_ = s.Top(5)
			_ = s.Stats()
		}(i)
	}
	wg.Wait()
	if s.Count() != 40 {
		t.Errorf("Count = %d, want 40", s.Count())
	}
	ids := map[string]bool{}
	for _, e := range s.Top(100) {
		if ids[e.ID] {
			t.Fatalf("duplicate entry id %q", e.ID)
		}
		ids[e.ID] = true
	}
}

func TestRunPersisterWritesOnShutdown(t *testing.T) {
	s, path := newTestStore(t)
	done := make(chan struct{})
	var errs []error
	finished := make(chan struct{})
	go func() {
		s.RunPersister(done, time.Hour, func(err error) { errs = append(errs, err) })
		close(finished)
	}()
	_, _, _ = s.Submit(Entry{Name: "FINAL", Score: 77})
	close(done)
	<-finished

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("expected a final flush: %v", err)
	}
	var f fileFormat
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("written file is not valid JSON: %v", err)
	}
	if len(f.Entries) != 1 || f.Entries[0].Name != "FINAL" {
		t.Errorf("unexpected file contents: %+v", f.Entries)
	}
	if len(errs) != 0 {
		t.Errorf("persister reported errors: %v", errs)
	}
}
