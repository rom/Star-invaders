package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/rom/star-invaders/internal/game"
	"github.com/rom/star-invaders/internal/hub"
	"github.com/rom/star-invaders/internal/userlevels"
)

// Levels built in the editor are stored, listed and played back through
// these handlers. Everything that arrives is normalised and validated with
// the same code the shipped campaign is checked against, so a stored level
// is always one the client can actually run.

type levelPayload struct {
	Author string     `json:"author"`
	Secret string     `json:"secret"`
	Level  game.Level `json:"level"`
}

// check normalises a submitted level and reports whether it is storable.
func check(lv game.Level) (game.Level, []game.Problem, bool) {
	norm := game.NormalizeLevel(lv)
	problems := game.ValidateLevel(norm)
	if problems == nil {
		problems = []game.Problem{}
	}
	return norm, problems, !game.HasFatal(problems)
}

func (s *Server) handleValidateLevel(w http.ResponseWriter, r *http.Request) {
	if !s.levelLim.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "slow down")
		return
	}
	var req levelPayload
	if !s.decode(w, r, &req) {
		return
	}
	norm, problems, ok := check(req.Level)
	writeJSON(w, http.StatusOK, map[string]any{
		"level":    norm,
		"problems": problems,
		"playable": ok,
	})
}

func (s *Server) handleListLevels(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 {
			limit = min(n, 200)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"levels":   s.cfg.Levels.List(limit),
		"total":    s.cfg.Levels.Count(),
		"capacity": userlevels.MaxStored,
	})
}

func (s *Server) handleGetLevel(w http.ResponseWriter, r *http.Request) {
	e, ok := s.cfg.Levels.Get(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "no such level")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry": e.Public()})
}

func (s *Server) handleCreateLevel(w http.ResponseWriter, r *http.Request) {
	if !s.levelLim.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "slow down")
		return
	}
	var req levelPayload
	if !s.decode(w, r, &req) {
		return
	}
	norm, problems, ok := check(req.Level)
	if !ok {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":    "the level cannot be played as written",
			"problems": problems,
		})
		return
	}

	author := sanitizeName(req.Author)
	entry, err := s.cfg.Levels.Create(author, norm)
	if errors.Is(err, userlevels.ErrFull) {
		writeErr(w, http.StatusInsufficientStorage, "the level shelf is full")
		return
	}
	if err != nil {
		s.cfg.Logger.Printf("create level: %v", err)
		writeErr(w, http.StatusInternalServerError, "could not store the level")
		return
	}

	s.hub.Publish(hub.FeedItem{
		Kind: "published",
		Name: author,
		Text: fmt.Sprintf("published a level: %s", entry.Level.Name),
	})

	// The edit key is handed out exactly once, here.
	writeJSON(w, http.StatusCreated, map[string]any{
		"entry":    entry.Public(),
		"secret":   entry.Secret,
		"problems": problems,
	})
}

func (s *Server) handleUpdateLevel(w http.ResponseWriter, r *http.Request) {
	if !s.levelLim.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "slow down")
		return
	}
	var req levelPayload
	if !s.decode(w, r, &req) {
		return
	}
	norm, problems, ok := check(req.Level)
	if !ok {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":    "the level cannot be played as written",
			"problems": problems,
		})
		return
	}

	entry, err := s.cfg.Levels.Update(r.PathValue("id"), req.Secret, norm)
	switch {
	case errors.Is(err, userlevels.ErrNotFound):
		writeErr(w, http.StatusNotFound, "no such level")
		return
	case errors.Is(err, userlevels.ErrForbidden):
		writeErr(w, http.StatusForbidden, "that edit key does not open this level")
		return
	case err != nil:
		s.cfg.Logger.Printf("update level: %v", err)
		writeErr(w, http.StatusInternalServerError, "could not store the level")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry": entry.Public(), "problems": problems})
}

func (s *Server) handleDeleteLevel(w http.ResponseWriter, r *http.Request) {
	if !s.levelLim.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "slow down")
		return
	}
	var req levelPayload
	if !s.decode(w, r, &req) {
		return
	}
	err := s.cfg.Levels.Delete(r.PathValue("id"), req.Secret)
	switch {
	case errors.Is(err, userlevels.ErrNotFound):
		writeErr(w, http.StatusNotFound, "no such level")
	case errors.Is(err, userlevels.ErrForbidden):
		writeErr(w, http.StatusForbidden, "that edit key does not open this level")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "could not remove the level")
	default:
		writeJSON(w, http.StatusNoContent, nil)
	}
}

func (s *Server) handleRecordLevelPlay(w http.ResponseWriter, r *http.Request) {
	if !s.eventLim.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "slow down")
		return
	}
	id := r.PathValue("id")
	if _, ok := s.cfg.Levels.Get(id); !ok {
		writeErr(w, http.StatusNotFound, "no such level")
		return
	}
	s.cfg.Levels.RecordPlay(id)
	writeJSON(w, http.StatusNoContent, nil)
}
