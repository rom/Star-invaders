// Package scores implements the persistent high score table and the
// aggregate campaign statistics shown to every connected player.
package scores

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// maxKept caps the number of entries written to disk. The leaderboard only
// ever serves the top slice, but keeping a few hundred lets us answer
// "where would this score rank" without a database.
const maxKept = 500

// Entry is one finished run.
type Entry struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Score     int       `json:"score"`
	Level     int       `json:"level"`
	Kills     int       `json:"kills"`
	Accuracy  float64   `json:"accuracy"`
	Victory   bool      `json:"victory"`
	Duration  float64   `json:"duration"`
	CreatedAt time.Time `json:"createdAt"`
}

// Stats are the cross-player aggregates.
type Stats struct {
	GamesPlayed  int    `json:"gamesPlayed"`
	TotalKills   int64  `json:"totalKills"`
	TotalScore   int64  `json:"totalScore"`
	BestScore    int    `json:"bestScore"`
	BestName     string `json:"bestName"`
	HighestLevel int    `json:"highestLevel"`
	Victories    int    `json:"victories"`
	TotalSeconds int64  `json:"totalSeconds"`
}

type fileFormat struct {
	Version int     `json:"version"`
	Stats   Stats   `json:"stats"`
	Entries []Entry `json:"entries"`
}

// Store is a goroutine-safe, file-backed leaderboard.
type Store struct {
	mu      sync.RWMutex
	path    string
	entries []Entry // kept sorted: score desc, then CreatedAt asc
	stats   Stats
	dirty   bool
	nextSeq int64
}

// New opens (or creates) the store backed by the JSON file at path.
func New(path string) (*Store, error) {
	s := &Store{path: path}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("scores: create data dir: %w", err)
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("scores: read %s: %w", s.path, err)
	}
	if len(data) == 0 {
		return nil
	}
	var f fileFormat
	if err := json.Unmarshal(data, &f); err != nil {
		// A corrupt table must not stop the server from booting; move it
		// aside so the operator can inspect it and start clean.
		backup := s.path + ".corrupt." + time.Now().UTC().Format("20060102T150405")
		_ = os.Rename(s.path, backup)
		return nil
	}
	s.entries = f.Entries
	s.stats = f.Stats
	s.sortLocked()
	return nil
}

func (s *Store) sortLocked() {
	sort.SliceStable(s.entries, func(i, j int) bool {
		if s.entries[i].Score != s.entries[j].Score {
			return s.entries[i].Score > s.entries[j].Score
		}
		return s.entries[i].CreatedAt.Before(s.entries[j].CreatedAt)
	})
	if len(s.entries) > maxKept {
		s.entries = s.entries[:maxKept]
	}
}

// Submit records a finished run and returns the entry (with its assigned id)
// plus its 1-based rank on the leaderboard. A rank of 0 means the score did
// not make the retained table at all.
func (s *Store) Submit(e Entry) (Entry, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextSeq++
	e.ID = fmt.Sprintf("%d-%d", time.Now().UTC().UnixNano(), s.nextSeq)
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now().UTC()
	}

	s.entries = append(s.entries, e)
	s.sortLocked()

	s.stats.GamesPlayed++
	s.stats.TotalKills += int64(e.Kills)
	s.stats.TotalScore += int64(e.Score)
	s.stats.TotalSeconds += int64(e.Duration)
	if e.Score > s.stats.BestScore {
		s.stats.BestScore = e.Score
		s.stats.BestName = e.Name
	}
	if e.Level > s.stats.HighestLevel {
		s.stats.HighestLevel = e.Level
	}
	if e.Victory {
		s.stats.Victories++
	}
	s.dirty = true

	rank := 0
	for i := range s.entries {
		if s.entries[i].ID == e.ID {
			rank = i + 1
			break
		}
	}
	return e, rank, nil
}

// Top returns the highest n entries.
func (s *Store) Top(n int) []Entry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if n <= 0 || n > len(s.entries) {
		n = len(s.entries)
	}
	out := make([]Entry, n)
	copy(out, s.entries[:n])
	return out
}

// Stats returns a snapshot of the aggregates.
func (s *Store) Stats() Stats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

// RankOf reports where a hypothetical score would land, 1-based.
func (s *Store) RankOf(score int) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rank := 1
	for i := range s.entries {
		if s.entries[i].Score > score {
			rank++
			continue
		}
		break
	}
	return rank
}

// Count returns the number of retained entries.
func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.entries)
}

// Flush writes the table to disk if anything changed since the last write.
func (s *Store) Flush() error {
	s.mu.Lock()
	if !s.dirty {
		s.mu.Unlock()
		return nil
	}
	payload := fileFormat{Version: 1, Stats: s.stats, Entries: s.entries}
	s.dirty = false
	s.mu.Unlock()

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("scores: marshal: %w", err)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("scores: write temp: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("scores: rename: %w", err)
	}
	return nil
}

// RunPersister flushes the store every interval until ctx-like done closes,
// then performs one final flush. It is meant to be run in its own goroutine.
func (s *Store) RunPersister(done <-chan struct{}, interval time.Duration, onErr func(error)) {
	t := time.NewTicker(interval)
	defer t.Stop()
	report := func(err error) {
		if err != nil && onErr != nil {
			onErr(err)
		}
	}
	for {
		select {
		case <-t.C:
			report(s.Flush())
		case <-done:
			report(s.Flush())
			return
		}
	}
}
