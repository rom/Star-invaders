package api

import (
	"testing"
	"time"
)

func TestSanitizeName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", "ANON"},
		{"   ", "ANON"},
		{"nova", "nova"},
		{"  spaced   out  ", "spaced out"},
		{"bell\x07and\x00nul", "bellandnul"},
		{"line\nbreak", "line break"},
		{"ABCDEFGHIJKLMNOPQRSTUVWXYZ", "ABCDEFGHIJKLMNOPQR"}, // capped at 18
		{"<script>alert(1)</script>", "<script>alert(1)</s"[:18]},
	}
	for _, c := range cases {
		if got := sanitizeName(c.in); got != c.want {
			t.Errorf("sanitizeName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSanitizeText(t *testing.T) {
	if got := sanitizeText("  hello   there  ", 120); got != "hello there" {
		t.Errorf("got %q", got)
	}
	if got := sanitizeText("   ", 120); got != "" {
		t.Errorf("whitespace should collapse to empty, got %q", got)
	}
	if got := sanitizeText("abcdefghij", 4); got != "abcd" {
		t.Errorf("length cap not applied, got %q", got)
	}
	if got := sanitizeText("tab\there", 120); got != "tab here" {
		t.Errorf("got %q", got)
	}
}

func TestFormatInt(t *testing.T) {
	cases := map[int]string{0: "0", 7: "7", 999: "999", 1000: "1,000", 1234567: "1,234,567", -4567: "-4,567"}
	for in, want := range cases {
		if got := formatInt(in); got != want {
			t.Errorf("formatInt(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestClamp(t *testing.T) {
	if clamp(5, 1, 3) != 3 || clamp(-2, 1, 3) != 1 || clamp(2, 1, 3) != 2 {
		t.Error("clamp misbehaved")
	}
}

func TestLimiterAllowsBurstThenThrottles(t *testing.T) {
	l := newLimiter(60, 3) // one per second, burst of 3
	for i := 0; i < 3; i++ {
		if !l.allow("ip") {
			t.Fatalf("burst token %d should have been available", i)
		}
	}
	if l.allow("ip") {
		t.Error("the fourth call should have been throttled")
	}
	if !l.allow("other-ip") {
		t.Error("buckets must be per key")
	}
}

func TestLimiterSweepDropsIdleBuckets(t *testing.T) {
	l := newLimiter(60, 1)
	l.allow("ip")
	if len(l.buckets) != 1 {
		t.Fatalf("expected one bucket, got %d", len(l.buckets))
	}
	l.sweep(0)
	if len(l.buckets) != 0 {
		t.Errorf("sweep left %d buckets", len(l.buckets))
	}
}

func TestRunRegistryPeekDoesNotSpend(t *testing.T) {
	rr := newRunRegistry(time.Hour)
	r := rr.start("A", "", "1.2.3.4", 1, "normal")

	if _, ok := rr.peek(r.ID); !ok {
		t.Fatal("a fresh run should peek")
	}
	if _, ok := rr.peek(r.ID); !ok {
		t.Fatal("peek must not consume the run")
	}
	if !rr.claim(r.ID) {
		t.Fatal("claim should succeed once")
	}
	if rr.claim(r.ID) {
		t.Error("a run must only be claimable once")
	}
	if _, ok := rr.peek(r.ID); ok {
		t.Error("a spent run must not peek")
	}
}

func TestRunRegistrySweepExpires(t *testing.T) {
	rr := newRunRegistry(time.Nanosecond)
	r := rr.start("A", "", "ip", 1, "normal")
	time.Sleep(2 * time.Millisecond)
	rr.sweep()
	if rr.count() != 0 {
		t.Errorf("sweep left %d runs", rr.count())
	}
	if _, ok := rr.peek(r.ID); ok {
		t.Error("an expired run must not resolve")
	}
}
