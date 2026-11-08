package api

import (
	"strings"
	"unicode"
)

// sanitizeName normalises a player handle: collapse whitespace, drop control
// and non-printable runes, cap the length, and fall back to a default.
func sanitizeName(in string) string {
	cleaned := filterPrintable(in, 18)
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	if cleaned == "" {
		return "ANON"
	}
	return cleaned
}

// sanitizeText cleans a chat line. Returns "" when nothing usable is left.
func sanitizeText(in string, max int) string {
	cleaned := filterPrintable(in, max)
	return strings.Join(strings.Fields(cleaned), " ")
}

func filterPrintable(in string, max int) string {
	var b strings.Builder
	n := 0
	for _, r := range in {
		if n >= max {
			break
		}
		switch {
		case r == '\n' || r == '\t' || r == '\r':
			b.WriteRune(' ')
		case unicode.IsControl(r), !unicode.IsPrint(r):
			continue
		default:
			b.WriteRune(r)
		}
		n++
	}
	return strings.TrimSpace(b.String())
}
