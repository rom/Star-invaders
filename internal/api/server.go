// Package api wires the Star Invaders HTTP surface: the static game client,
// the campaign definition, the persistent leaderboard, and the live
// player-to-player event stream.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rom/star-invaders/internal/game"
	"github.com/rom/star-invaders/internal/hub"
	"github.com/rom/star-invaders/internal/scores"
)

// forgeryFloor is the score below which plausibility checks are skipped:
// a run worth less than this is not worth forging, and rejecting a genuine
// three-second death would be worse than accepting a trivial fake.
const forgeryFloor = 3000

// Config configures a Server.
type Config struct {
	Assets      fs.FS // the web/ tree
	Store       *scores.Store
	Logger      *log.Logger
	Version     string
	MaxBodyByte int64
}

// Server is the HTTP application.
type Server struct {
	cfg      Config
	mux      *http.ServeMux
	hub      *hub.Hub
	runs     *runRegistry
	campaign []byte // pre-marshalled campaign payload

	scoreLim *limiter
	chatLim  *limiter
	runLim   *limiter
	eventLim *limiter

	done chan struct{}
}

// New builds the server and starts its background janitors. Close stops them.
func New(cfg Config) (*Server, error) {
	if cfg.Store == nil {
		return nil, errors.New("api: Store is required")
	}
	if cfg.Assets == nil {
		return nil, errors.New("api: Assets is required")
	}
	if cfg.Logger == nil {
		cfg.Logger = log.Default()
	}
	if cfg.MaxBodyByte <= 0 {
		cfg.MaxBodyByte = 16 << 10
	}

	s := &Server{
		cfg:      cfg,
		mux:      http.NewServeMux(),
		runs:     newRunRegistry(6 * time.Hour),
		scoreLim: newLimiter(20, 5),   // 20 submissions/min/IP
		chatLim:  newLimiter(20, 4),   // 20 chat lines/min/IP
		runLim:   newLimiter(60, 10),  // 60 new runs/min/IP
		eventLim: newLimiter(240, 30), // 240 milestone pings/min/IP
		done:     make(chan struct{}),
	}
	s.hub = hub.New(func() any { return s.statsPayload() })

	payload, err := json.Marshal(game.BuildCampaign())
	if err != nil {
		return nil, fmt.Errorf("api: marshal campaign: %w", err)
	}
	s.campaign = payload

	s.routes()
	go s.hub.RunKeepalive(s.done, 20*time.Second)
	go s.janitor()
	return s, nil
}

// Hub exposes the live hub (used by main for shutdown announcements).
func (s *Server) Hub() *hub.Hub { return s.hub }

// Close stops background goroutines.
func (s *Server) Close() { close(s.done) }

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	s.mux.ServeHTTP(w, r)
}

func (s *Server) janitor() {
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			s.runs.sweep()
			s.scoreLim.sweep(30 * time.Minute)
			s.chatLim.sweep(30 * time.Minute)
			s.runLim.sweep(30 * time.Minute)
			s.eventLim.sweep(30 * time.Minute)
		case <-s.done:
			return
		}
	}
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/levels", s.handleLevels)
	s.mux.HandleFunc("GET /api/scores", s.handleTopScores)
	s.mux.HandleFunc("POST /api/scores", s.handleSubmitScore)
	s.mux.HandleFunc("GET /api/stats", s.handleStats)
	s.mux.HandleFunc("POST /api/runs", s.handleStartRun)
	s.mux.HandleFunc("GET /api/stream", s.handleStream)
	s.mux.HandleFunc("POST /api/presence", s.handlePresence)
	s.mux.HandleFunc("POST /api/events", s.handleMilestone)
	s.mux.HandleFunc("GET /api/chat", s.handleChatLog)
	s.mux.HandleFunc("POST /api/chat", s.handleChatPost)

	static := http.FileServerFS(s.cfg.Assets)
	s.mux.Handle("/", cacheStatic(static))
}

func cacheStatic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html"):
			w.Header().Set("Cache-Control", "no-cache")
		default:
			w.Header().Set("Cache-Control", "public, max-age=300")
		}
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------- helpers

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// The client went away mid-write; nothing useful to do.
		return
	}
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	defer func() { _, _ = io.Copy(io.Discard, r.Body) }()
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, s.cfg.MaxBodyByte))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed request body")
		return false
	}
	return true
}

// ---------------------------------------------------------------- handlers

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "ok",
		"version":    s.cfg.Version,
		"levels":     game.MaxLevel(),
		"online":     s.hub.Online(),
		"scoresKept": s.cfg.Store.Count(),
		"activeRuns": s.runs.count(),
		"time":       time.Now().UTC(),
	})
}

func (s *Server) handleLevels(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=60")
	_, _ = w.Write(s.campaign)
}

func (s *Server) handleTopScores(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 {
			limit = min(n, 100)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"scores": s.cfg.Store.Top(limit),
		"total":  s.cfg.Store.Count(),
	})
}

func (s *Server) statsPayload() map[string]any {
	st := s.cfg.Store.Stats()
	return map[string]any{
		"gamesPlayed":  st.GamesPlayed,
		"totalKills":   st.TotalKills,
		"totalScore":   st.TotalScore,
		"bestScore":    st.BestScore,
		"bestName":     st.BestName,
		"highestLevel": st.HighestLevel,
		"victories":    st.Victories,
		"totalSeconds": st.TotalSeconds,
		"online":       s.hub.Online(),
		"levelCount":   game.MaxLevel(),
	}
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.statsPayload())
}

type startRunRequest struct {
	Name       string `json:"name"`
	ClientID   string `json:"clientId"`
	StartLevel int    `json:"startLevel"`
}

func (s *Server) handleStartRun(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !s.runLim.allow(ip) {
		writeErr(w, http.StatusTooManyRequests, "slow down")
		return
	}
	var req startRunRequest
	if !s.decode(w, r, &req) {
		return
	}
	name := sanitizeName(req.Name)
	startLevel := clamp(req.StartLevel, 1, game.MaxLevel())
	run := s.runs.start(name, req.ClientID, ip, startLevel)
	writeJSON(w, http.StatusOK, map[string]any{
		"runId":      run.ID,
		"name":       name,
		"startLevel": startLevel,
		"startedAt":  run.Started.UTC(),
	})
}

type submitScoreRequest struct {
	RunID    string  `json:"runId"`
	Name     string  `json:"name"`
	Score    int     `json:"score"`
	Level    int     `json:"level"`
	Kills    int     `json:"kills"`
	Shots    int     `json:"shots"`
	Hits     int     `json:"hits"`
	Victory  bool    `json:"victory"`
	Duration float64 `json:"duration"`
}

func (s *Server) handleSubmitScore(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !s.scoreLim.allow(ip) {
		writeErr(w, http.StatusTooManyRequests, "slow down")
		return
	}
	var req submitScoreRequest
	if !s.decode(w, r, &req) {
		return
	}

	// Validate before consuming the token: a rejected submission must not
	// cost the player their one chance to report a legitimate score.
	run, ok := s.runs.peek(req.RunID)
	if !ok {
		writeErr(w, http.StatusForbidden, "unknown or already submitted run")
		return
	}

	if req.Score < 0 || req.Level < 1 || req.Kills < 0 {
		writeErr(w, http.StatusBadRequest, "nonsensical run figures")
		return
	}
	if req.Level > game.MaxLevel() {
		req.Level = game.MaxLevel()
	}
	if req.Level < run.StartLevel {
		// Dying on the level you started on is the floor.
		req.Level = run.StartLevel
	}
	if ceiling := game.ScoreCeilingRange(run.StartLevel, req.Level); req.Score > ceiling {
		writeErr(w, http.StatusUnprocessableEntity,
			fmt.Sprintf("score %d exceeds the ceiling of %d for levels %d-%d",
				req.Score, ceiling, run.StartLevel, req.Level))
		return
	}

	// Plausibility: playing through a level takes real time. Eight seconds
	// per level played is far faster than anyone can manage, which leaves
	// honest runs well clear of the threshold. Small scores skip the check
	// entirely - dying in the first few seconds is a real thing that happens,
	// and nobody forges a run worth a few hundred points.
	elapsed := time.Since(run.Started).Seconds()
	levelsPlayed := req.Level - run.StartLevel + 1
	if minimum := float64(levelsPlayed) * 8; req.Score > forgeryFloor && elapsed < minimum {
		writeErr(w, http.StatusUnprocessableEntity, "run finished too fast to be real")
		return
	}

	if !s.runs.claim(req.RunID) {
		writeErr(w, http.StatusForbidden, "unknown or already submitted run")
		return
	}

	name := sanitizeName(req.Name)
	if name == "ANON" && run.Name != "" {
		name = run.Name
	}

	accuracy := 0.0
	if req.Shots > 0 {
		accuracy = math.Round(float64(req.Hits)/float64(req.Shots)*1000) / 10
		accuracy = math.Max(0, math.Min(100, accuracy))
	}
	duration := req.Duration
	if duration <= 0 || duration > elapsed*1.5+60 {
		duration = elapsed
	}

	entry, rank, err := s.cfg.Store.Submit(scores.Entry{
		Name:     name,
		Score:    req.Score,
		Level:    req.Level,
		Kills:    req.Kills,
		Accuracy: accuracy,
		Victory:  req.Victory,
		Duration: math.Round(duration),
	})
	if err != nil {
		s.cfg.Logger.Printf("score submit failed: %v", err)
		writeErr(w, http.StatusInternalServerError, "could not record the score")
		return
	}

	top := s.cfg.Store.Top(10)
	isTop10 := rank > 0 && rank <= 10

	verb := "went down"
	if req.Victory {
		verb = "finished the campaign"
	}
	text := fmt.Sprintf("%s on level %d with %s points", verb, entry.Level, formatInt(entry.Score))
	if isTop10 {
		text += fmt.Sprintf(" - rank #%d", rank)
	}
	s.hub.Publish(hub.FeedItem{
		Kind:  pick(req.Victory, "victory", "gameover"),
		Name:  entry.Name,
		Text:  text,
		Level: entry.Level,
		Score: entry.Score,
	})
	if isTop10 {
		s.hub.AnnounceHighScore(map[string]any{"entry": entry, "rank": rank})
	}
	s.hub.AnnounceStats()

	writeJSON(w, http.StatusCreated, map[string]any{
		"entry":       entry,
		"rank":        rank,
		"leaderboard": top,
		"stats":       s.statsPayload(),
	})
}

// handleStream is the SSE endpoint. The lifetime of this request is the
// player's presence on the live net.
func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}

	name := sanitizeName(r.URL.Query().Get("name"))
	best := 0
	if b, err := strconv.Atoi(r.URL.Query().Get("best")); err == nil && b > 0 {
		best = min(b, game.MaxScore())
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no") // defeat nginx response buffering
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, ": star-invaders live net\n\n")
	flusher.Flush()

	client := s.hub.Join(name, best)
	defer s.hub.Leave(client)

	ctx := r.Context()
	enc := json.NewEncoder(w)
	for {
		select {
		case <-ctx.Done():
			return
		case ev, open := <-client.Events():
			if !open {
				return
			}
			if _, err := io.WriteString(w, "event: "+ev.Type+"\ndata: "); err != nil {
				return
			}
			if err := enc.Encode(ev); err != nil {
				return
			}
			if _, err := io.WriteString(w, "\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

type presenceRequest struct {
	ClientID string `json:"clientId"`
	Secret   string `json:"secret"`
	Name     string `json:"name"`
	Level    int    `json:"level"`
	Score    int    `json:"score"`
	Lives    int    `json:"lives"`
	Status   string `json:"status"`
}

func (s *Server) handlePresence(w http.ResponseWriter, r *http.Request) {
	if !s.eventLim.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "slow down")
		return
	}
	var req presenceRequest
	if !s.decode(w, r, &req) {
		return
	}
	client, ok := s.hub.Lookup(req.ClientID, req.Secret)
	if !ok {
		writeErr(w, http.StatusGone, "stream not registered; reconnect")
		return
	}
	status := req.Status
	switch status {
	case hub.StatusLobby, hub.StatusPlaying, hub.StatusDead, hub.StatusVictory:
	default:
		status = hub.StatusLobby
	}
	name := sanitizeName(req.Name)
	s.hub.Update(client, func(p *hub.Player) {
		if name != "ANON" {
			p.Name = name
		}
		p.Level = clamp(req.Level, 0, game.MaxLevel())
		p.Score = clamp(req.Score, 0, game.MaxScore())
		p.Lives = clamp(req.Lives, 0, 99)
		p.Status = status
	})
	writeJSON(w, http.StatusNoContent, nil)
}

type milestoneRequest struct {
	ClientID string `json:"clientId"`
	Secret   string `json:"secret"`
	Kind     string `json:"kind"`
	Level    int    `json:"level"`
	Score    int    `json:"score"`
	Detail   string `json:"detail"`
}

// handleMilestone turns a client-reported moment into a feed line everyone
// sees. Only a small allow-list of kinds is accepted and the wording is
// produced here, so a client cannot inject arbitrary feed text.
func (s *Server) handleMilestone(w http.ResponseWriter, r *http.Request) {
	if !s.eventLim.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "slow down")
		return
	}
	var req milestoneRequest
	if !s.decode(w, r, &req) {
		return
	}
	client, ok := s.hub.Lookup(req.ClientID, req.Secret)
	if !ok {
		writeErr(w, http.StatusGone, "stream not registered; reconnect")
		return
	}
	p := client.Snapshot()
	level := clamp(req.Level, 0, game.MaxLevel())
	score := clamp(req.Score, 0, game.MaxScore())

	var text, kind string
	switch req.Kind {
	case "start":
		kind, text = "start", "launched a new sortie"
	case "level":
		lv, _ := game.LevelByNumber(level)
		kind = "level"
		text = fmt.Sprintf("cleared level %d - %s", level, lv.Name)
	case "boss":
		detail := sanitizeText(req.Detail, 32)
		if detail == "" {
			detail = "a capital ship"
		}
		kind, text = "boss", fmt.Sprintf("destroyed %s on level %d", detail, level)
	case "extralife":
		kind, text = "extralife", fmt.Sprintf("earned an extra hull at %s points", formatInt(score))
	case "combo":
		kind, text = "combo", fmt.Sprintf("hit an %dx kill chain on level %d", clamp(req.Score, 2, 99), level)
	default:
		writeErr(w, http.StatusBadRequest, "unknown milestone kind")
		return
	}

	s.hub.Publish(hub.FeedItem{Kind: kind, Name: p.Name, Text: text, Level: level, Score: score})
	writeJSON(w, http.StatusNoContent, nil)
}

func (s *Server) handleChatLog(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"chat": s.hub.Chat(),
		"feed": s.hub.Feed(),
	})
}

type chatRequest struct {
	ClientID string `json:"clientId"`
	Secret   string `json:"secret"`
	Text     string `json:"text"`
}

func (s *Server) handleChatPost(w http.ResponseWriter, r *http.Request) {
	if !s.chatLim.allow(clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "easy on the comms")
		return
	}
	var req chatRequest
	if !s.decode(w, r, &req) {
		return
	}
	client, ok := s.hub.Lookup(req.ClientID, req.Secret)
	if !ok {
		writeErr(w, http.StatusGone, "stream not registered; reconnect")
		return
	}
	text := sanitizeText(req.Text, 120)
	if text == "" {
		writeErr(w, http.StatusBadRequest, "nothing to say")
		return
	}
	item := s.hub.Say(client.Snapshot().Name, text)
	writeJSON(w, http.StatusCreated, item)
}

// ---------------------------------------------------------------- utilities

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func pick(cond bool, a, b string) string {
	if cond {
		return a
	}
	return b
}

// formatInt renders 1234567 as "1,234,567".
func formatInt(n int) string {
	s := strconv.Itoa(n)
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	if neg {
		return "-" + b.String()
	}
	return b.String()
}
