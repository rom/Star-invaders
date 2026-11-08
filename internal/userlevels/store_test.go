package userlevels

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rom/star-invaders/internal/game"
)

func newStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "userlevels.json")
	s, err := New(path)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s, path
}

func sample(name string) game.Level {
	return game.Level{
		Name: name, Tagline: "made in the editor", Music: "march", Backdrop: "void",
		StarSpeed: 1, FormationStep: 0.6, FormationDrop: 18, GlobalFireMul: 1,
		Waves: []game.Wave{{Archetype: "grunt", Pattern: game.PatternGrid, Rows: 2, Cols: 5, Count: 10, Y: 0.15}},
	}
}

func TestCreateAssignsIdentityAndSecret(t *testing.T) {
	s, _ := newStore(t)
	e, err := s.Create("NOVA-14", sample("First Light"))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if e.ID == "" || e.Secret == "" {
		t.Fatal("create must mint an id and an edit key")
	}
	if e.CreatedAt.IsZero() || e.UpdatedAt.IsZero() {
		t.Error("timestamps not set")
	}
	if e.Author != "NOVA-14" || e.Level.Name != "First Light" {
		t.Errorf("entry = %+v", e)
	}
}

// The secret is the only thing standing between an author's level and
// anyone else, so it must never leave the server.
func TestPublicStripsTheSecret(t *testing.T) {
	s, _ := newStore(t)
	e, _ := s.Create("A", sample("X"))
	if e.Public().Secret != "" {
		t.Error("Public() leaked the edit key")
	}
	for _, listed := range s.List(10) {
		if listed.Secret != "" {
			t.Error("List() leaked an edit key")
		}
	}
	raw, err := json.Marshal(s.List(10))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), e.Secret) {
		t.Error("a listing serialised the edit key")
	}
}

func TestUpdateRequiresTheSecret(t *testing.T) {
	s, _ := newStore(t)
	e, _ := s.Create("A", sample("Before"))

	if _, err := s.Update(e.ID, "not-the-key", sample("After")); !errors.Is(err, ErrForbidden) {
		t.Errorf("err = %v, want ErrForbidden", err)
	}
	if got, _ := s.Get(e.ID); got.Level.Name != "Before" {
		t.Error("a rejected update changed the level anyway")
	}

	updated, err := s.Update(e.ID, e.Secret, sample("After"))
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Level.Name != "After" {
		t.Errorf("Level.Name = %q", updated.Level.Name)
	}
	if !updated.UpdatedAt.After(updated.CreatedAt) && updated.UpdatedAt.Before(updated.CreatedAt) {
		t.Error("UpdatedAt did not move forward")
	}
	if updated.Secret != e.Secret {
		t.Error("the edit key must survive an update")
	}
}

func TestDeleteRequiresTheSecret(t *testing.T) {
	s, _ := newStore(t)
	e, _ := s.Create("A", sample("X"))

	if err := s.Delete(e.ID, "wrong"); !errors.Is(err, ErrForbidden) {
		t.Errorf("err = %v, want ErrForbidden", err)
	}
	if s.Count() != 1 {
		t.Fatal("a rejected delete removed the level anyway")
	}
	if err := s.Delete(e.ID, e.Secret); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if s.Count() != 0 {
		t.Error("level survived its own deletion")
	}
	if err := s.Delete(e.ID, e.Secret); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestUnknownIDIsNotFound(t *testing.T) {
	s, _ := newStore(t)
	if _, ok := s.Get("nope"); ok {
		t.Error("Get resolved an unknown id")
	}
	if _, err := s.Update("nope", "x", sample("X")); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}
}

func TestListIsNewestFirst(t *testing.T) {
	s, _ := newStore(t)
	first, _ := s.Create("A", sample("first"))
	time.Sleep(2 * time.Millisecond)
	_, _ = s.Create("B", sample("second"))

	if got := s.List(10); got[0].Level.Name != "second" {
		t.Errorf("List order = %q first", got[0].Level.Name)
	}
	// Editing the older one brings it back to the top.
	time.Sleep(2 * time.Millisecond)
	if _, err := s.Update(first.ID, first.Secret, sample("first, edited")); err != nil {
		t.Fatal(err)
	}
	if got := s.List(10); got[0].ID != first.ID {
		t.Error("an edited level should sort to the top")
	}
}

func TestRecordPlay(t *testing.T) {
	s, _ := newStore(t)
	e, _ := s.Create("A", sample("X"))
	s.RecordPlay(e.ID)
	s.RecordPlay(e.ID)
	s.RecordPlay("no-such-level") // must not panic
	if got, _ := s.Get(e.ID); got.Plays != 2 {
		t.Errorf("Plays = %d, want 2", got.Plays)
	}
}

func TestShelfIsCapped(t *testing.T) {
	s, _ := newStore(t)
	for i := 0; i < MaxStored; i++ {
		if _, err := s.Create("A", sample("X")); err != nil {
			t.Fatalf("Create %d: %v", i, err)
		}
	}
	if _, err := s.Create("A", sample("one too many")); !errors.Is(err, ErrFull) {
		t.Errorf("err = %v, want ErrFull", err)
	}
	if s.Count() != MaxStored {
		t.Errorf("Count = %d", s.Count())
	}
}

func TestFlushAndReload(t *testing.T) {
	s, path := newStore(t)
	e, _ := s.Create("AUTHOR", sample("Persisted"))
	s.RecordPlay(e.ID)
	if err := s.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	reopened, err := New(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	got, ok := reopened.Get(e.ID)
	if !ok {
		t.Fatal("level did not survive the round trip")
	}
	if got.Author != "AUTHOR" || got.Level.Name != "Persisted" || got.Plays != 1 {
		t.Errorf("reloaded = %+v", got)
	}
	// The secret has to survive too, or the author loses control of it.
	if _, err := reopened.Update(e.ID, e.Secret, sample("Still mine")); err != nil {
		t.Errorf("edit key did not survive persistence: %v", err)
	}
	if err := reopened.Flush(); err != nil {
		t.Errorf("no-op flush: %v", err)
	}
}

func TestLoadToleratesACorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "userlevels.json")
	if err := os.WriteFile(path, []byte("{ this is not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := New(path)
	if err != nil {
		t.Fatalf("a corrupt shelf must not stop the server booting: %v", err)
	}
	if s.Count() != 0 {
		t.Errorf("Count = %d, want 0", s.Count())
	}
	if matches, _ := filepath.Glob(path + ".corrupt.*"); len(matches) != 1 {
		t.Errorf("expected the bad file set aside, found %v", matches)
	}
}

func TestConcurrentUseIsSafe(t *testing.T) {
	s, _ := newStore(t)
	seed, _ := s.Create("A", sample("seed"))

	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			if n%3 == 0 {
				_, _ = s.Create("RACE", sample("x"))
			}
			_, _ = s.Update(seed.ID, seed.Secret, sample("edited"))
			s.RecordPlay(seed.ID)
			_ = s.List(5)
			_, _ = s.Get(seed.ID)
		}(i)
	}
	wg.Wait()
	if _, ok := s.Get(seed.ID); !ok {
		t.Error("the seed level went missing under concurrency")
	}
}
