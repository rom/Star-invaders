// Command star-invaders serves the Star Invaders game: a browser client over
// an embedded static bundle, the twelve-level campaign definition, a
// file-backed high score table, and a live event stream that lets every
// connected player see what the others are doing.
//
// Usage:
//
//	star-invaders [-addr :8080] [-data ./data] [-dev]
//
// Environment variables PORT, ADDR and STAR_INVADERS_DATA override the
// matching flags, which makes the binary drop straight into a container or a
// PaaS dyno.
package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/rom/star-invaders/internal/api"
	"github.com/rom/star-invaders/internal/game"
	"github.com/rom/star-invaders/internal/scores"
	"github.com/rom/star-invaders/internal/userlevels"
)

//go:embed web
var embeddedWeb embed.FS

// version is overridable at build time:
//
//	go build -ldflags "-X main.version=1.2.3"
var version = "dev"

func main() {
	if err := run(); err != nil {
		log.Fatalf("star-invaders: %v", err)
	}
}

func run() error {
	var (
		addr    = flag.String("addr", envOr("ADDR", ":8080"), "listen address (host:port)")
		dataDir = flag.String("data", envOr("STAR_INVADERS_DATA", "data"), "directory for the high score table")
		dev     = flag.Bool("dev", false, "serve web assets from ./web on disk instead of the embedded copy")
		showVer = flag.Bool("version", false, "print the version and exit")
	)
	flag.Parse()

	if *showVer {
		fmt.Println("star-invaders", version)
		return nil
	}

	// A bare PORT (Heroku, Fly, Cloud Run, ...) wins over the default addr
	// but not over an explicitly supplied -addr.
	if port := os.Getenv("PORT"); port != "" && !flagPassed("addr") && os.Getenv("ADDR") == "" {
		*addr = ":" + port
	}

	logger := log.New(os.Stdout, "", log.LstdFlags|log.Lmsgprefix)
	logger.SetPrefix("star-invaders ")

	assets, err := assetFS(*dev)
	if err != nil {
		return err
	}

	store, err := scores.New(filepath.Join(*dataDir, "scores.json"))
	if err != nil {
		return err
	}
	levels, err := userlevels.New(filepath.Join(*dataDir, "userlevels.json"))
	if err != nil {
		return err
	}

	srv, err := api.New(api.Config{
		Assets:  assets,
		Store:   store,
		Levels:  levels,
		Logger:  logger,
		Version: version,
	})
	if err != nil {
		return err
	}
	defer srv.Close()

	persisterDone := make(chan struct{})
	go store.RunPersister(persisterDone, 20*time.Second, func(err error) {
		logger.Printf("persist error: %v", err)
	})
	go levels.RunPersister(persisterDone, 20*time.Second, func(err error) {
		logger.Printf("level persist error: %v", err)
	})

	httpSrv := &http.Server{
		Addr:              *addr,
		Handler:           logRequests(logger, srv),
		ReadHeaderTimeout: 10 * time.Second,
		// No WriteTimeout: /api/stream is a long-lived SSE response.
		IdleTimeout: 90 * time.Second,
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", *addr, err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		logger.Printf("listening on http://%s (%d levels, version %s, dev=%v)",
			ln.Addr(), game.MaxLevel(), version, *dev)
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		close(persisterDone)
		return err
	case <-ctx.Done():
		logger.Print("shutdown signal received; draining")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	shutdownErr := httpSrv.Shutdown(shutdownCtx)
	close(persisterDone)
	// Give the persister a moment to land its final write.
	time.Sleep(150 * time.Millisecond)
	if err := store.Flush(); err != nil {
		logger.Printf("final flush: %v", err)
	}
	if err := levels.Flush(); err != nil {
		logger.Printf("final level flush: %v", err)
	}
	if shutdownErr != nil && !errors.Is(shutdownErr, context.DeadlineExceeded) {
		return shutdownErr
	}
	logger.Print("stopped")
	return nil
}

// assetFS returns the web asset tree, either the embedded copy or the live
// directory when -dev is set.
func assetFS(dev bool) (fs.FS, error) {
	if dev {
		if _, err := os.Stat(filepath.Join("web", "index.html")); err != nil {
			return nil, fmt.Errorf("-dev requires ./web/index.html: %w", err)
		}
		return os.DirFS("web"), nil
	}
	sub, err := fs.Sub(embeddedWeb, "web")
	if err != nil {
		return nil, fmt.Errorf("embedded assets: %w", err)
	}
	return sub, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func flagPassed(name string) bool {
	found := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == name {
			found = true
		}
	})
	return found
}

// statusRecorder captures the response code for the access log.
type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wrote {
		s.status = code
		s.wrote = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wrote {
		s.status = http.StatusOK
		s.wrote = true
	}
	return s.ResponseWriter.Write(b)
}

// Flush forwards to the wrapped writer so SSE keeps working through the log
// middleware.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func logRequests(logger *log.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Long-lived streams would otherwise log only on disconnect with a
		// misleading duration; log them on open instead.
		if r.URL.Path == "/api/stream" {
			logger.Printf("%s %s stream opened", r.Method, r.URL.Path)
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		if rec.status >= 400 || r.Method != http.MethodGet {
			logger.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond))
		}
	})
}
