// Package userlevels is the file-backed store behind the level editor: the
// levels people build in the browser, saved so they can be shared, reopened
// and played by anyone on the server.
package userlevels

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/rom/star-invaders/internal/game"
)

// MaxStored caps the shelf. The store refuses new levels rather than
// evicting somebody's work to make room.
const MaxStored = 300

var (
	// ErrNotFound is returned for an id that is not on the shelf.
	ErrNotFound = errors.New("userlevels: no such level")
	// ErrForbidden is returned when the edit secret does not match.
	ErrForbidden = errors.New("userlevels: wrong edit key")
	// ErrFull is returned when the store is at MaxStored.
	ErrFull = errors.New("userlevels: the shelf is full")
)

// Entry is one saved level. Secret is persisted but never served: it is the
// key that lets the author, and only the author, change or remove it.
type Entry struct {
	ID        string     `json:"id"`
	Secret    string     `json:"secret"`
	Author    string     `json:"author"`
	Level     game.Level `json:"level"`
	Plays     int        `json:"plays"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

// Public returns a copy safe to hand to a client.
func (e Entry) Public() Entry {
	e.Secret = ""
	return e
}

type fileFormat struct {
	Version int     `json:"version"`
	Entries []Entry `json:"entries"`
}

// Store is a goroutine-safe, file-backed shelf of user levels.
type Store struct {
	mu      sync.RWMutex
	path    string
	entries []Entry // newest first
	dirty   bool
}

// New opens (or creates) the store backed by the JSON file at path.
func New(path string) (*Store, error) {
	s := &Store{path: path}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("userlevels: create data dir: %w", err)
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
		return fmt.Errorf("userlevels: read %s: %w", s.path, err)
	}
	if len(data) == 0 {
		return nil
	}
	var f fileFormat
	if err := json.Unmarshal(data, &f); err != nil {
		// Never let a damaged shelf stop the server booting.
		backup := s.path + ".corrupt." + time.Now().UTC().Format("20060102T150405")
		_ = os.Rename(s.path, backup)
		return nil
	}
	s.entries = f.Entries
	s.sortLocked()
	return nil
}

func (s *Store) sortLocked() {
	sort.SliceStable(s.entries, func(i, j int) bool {
		return s.entries[i].UpdatedAt.After(s.entries[j].UpdatedAt)
	})
}

func token(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))[:n*2]
	}
	return hex.EncodeToString(b)
}

func (s *Store) indexLocked(id string) int {
	for i := range s.entries {
		if s.entries[i].ID == id {
			return i
		}
	}
	return -1
}

// Create stores a new level and returns it, secret included: that is the
// only time the secret is ever handed out.
func (s *Store) Create(author string, lv game.Level) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.entries) >= MaxStored {
		return Entry{}, ErrFull
	}
	now := time.Now().UTC()
	e := Entry{
		ID:        token(8),
		Secret:    token(16),
		Author:    author,
		Level:     lv,
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.entries = append(s.entries, e)
	s.sortLocked()
	s.dirty = true
	return e, nil
}

// Update replaces the level behind id, if the secret matches.
func (s *Store) Update(id, secret string, lv game.Level) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.indexLocked(id)
	if i < 0 {
		return Entry{}, ErrNotFound
	}
	if subtle.ConstantTimeCompare([]byte(s.entries[i].Secret), []byte(secret)) != 1 {
		return Entry{}, ErrForbidden
	}
	s.entries[i].Level = lv
	s.entries[i].UpdatedAt = time.Now().UTC()
	s.sortLocked()
	s.dirty = true
	return s.entries[s.indexLocked(id)], nil
}

// Delete removes the level behind id, if the secret matches.
func (s *Store) Delete(id, secret string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.indexLocked(id)
	if i < 0 {
		return ErrNotFound
	}
	if subtle.ConstantTimeCompare([]byte(s.entries[i].Secret), []byte(secret)) != 1 {
		return ErrForbidden
	}
	s.entries = append(s.entries[:i], s.entries[i+1:]...)
	s.dirty = true
	return nil
}

// Get returns one entry, secret included; callers serving it must call
// Public first.
func (s *Store) Get(id string) (Entry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	i := s.indexLocked(id)
	if i < 0 {
		return Entry{}, false
	}
	return s.entries[i], true
}

// List returns up to n entries, most recently updated first, without secrets.
func (s *Store) List(n int) []Entry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if n <= 0 || n > len(s.entries) {
		n = len(s.entries)
	}
	out := make([]Entry, 0, n)
	for _, e := range s.entries[:n] {
		out = append(out, e.Public())
	}
	return out
}

// RecordPlay bumps the play counter for a level.
func (s *Store) RecordPlay(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if i := s.indexLocked(id); i >= 0 {
		s.entries[i].Plays++
		s.dirty = true
	}
}

// Count returns the number of stored levels.
func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.entries)
}

// Flush writes the shelf to disk if anything changed.
func (s *Store) Flush() error {
	s.mu.Lock()
	if !s.dirty {
		s.mu.Unlock()
		return nil
	}
	payload := fileFormat{Version: 1, Entries: s.entries}
	s.dirty = false
	s.mu.Unlock()

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("userlevels: marshal: %w", err)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("userlevels: write temp: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("userlevels: rename: %w", err)
	}
	return nil
}

// RunPersister flushes every interval until done closes, then once more.
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
