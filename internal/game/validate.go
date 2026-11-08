package game

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"
)

// Limits on a single level. They exist to keep a hand-authored or
// user-submitted level from being unplayable, unwinnable, or heavy enough to
// bog a browser down.
const (
	MaxWaves         = 24
	MaxHazardKinds   = 6
	MaxWaveCount     = 120
	MaxLevelEntities = 400
	MaxNameRunes     = 48
	MaxTaglineRunes  = 160
)

// MusicTracks are the chiptune tracks the client's audio engine can play.
// Naming anything else leaves a level silent, so it is rejected.
var MusicTracks = []string{"menu", "march", "tension", "boss", "swarm", "siege", "final"}

// Backdrops are the renderer's nebula palettes.
var Backdrops = []string{
	"deepblue", "rust", "violet", "teal", "amber", "moss",
	"ice", "void", "aurora", "ember", "steel", "singularity",
}

// Patterns are the spawn layouts the client simulator understands.
var Patterns = []string{PatternGrid, PatternArc, PatternVee, PatternStream, PatternRandom, PatternBoss}

// Sides are the edges a stream wave can enter from.
var Sides = []string{"left", "right", "top", "random"}

// Problem is one thing wrong with a level. Fatal problems make the level
// unplayable or unwinnable and block it from being stored; the rest are
// advice the editor shows without getting in the way.
type Problem struct {
	Field   string `json:"field"`
	Message string `json:"message"`
	Fatal   bool   `json:"fatal"`
}

// HasFatal reports whether any problem blocks the level.
func HasFatal(ps []Problem) bool {
	for _, p := range ps {
		if p.Fatal {
			return true
		}
	}
	return false
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

func clampF(v, lo, hi float64) float64 {
	if math.IsNaN(v) {
		return lo
	}
	return math.Max(lo, math.Min(hi, v))
}

func clampI(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// trimText strips control characters and collapses whitespace, capping the
// result at max runes.
func trimText(in string, max int) string {
	var b strings.Builder
	n := 0
	for _, r := range in {
		if n >= max {
			break
		}
		if unicode.IsControl(r) || !unicode.IsPrint(r) {
			if r == '\t' || r == '\n' {
				b.WriteRune(' ')
				n++
			}
			continue
		}
		b.WriteRune(r)
		n++
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// NormalizeLevel returns a copy with text trimmed, numbers clamped into
// range and empty fields given sane defaults. It never makes a level valid
// on its own - anything that cannot be fixed by clamping is left for
// ValidateLevel to report.
func NormalizeLevel(lv Level) Level {
	out := lv
	out.Name = trimText(lv.Name, MaxNameRunes)
	out.Tagline = trimText(lv.Tagline, MaxTaglineRunes)

	if out.Music == "" {
		out.Music = "march"
	}
	if out.Backdrop == "" {
		out.Backdrop = "deepblue"
	}
	out.StarSpeed = clampF(orDefault(out.StarSpeed, 1), 0, 4)
	out.FormationStep = clampF(orDefault(out.FormationStep, 0.65), 0.1, 3)
	out.FormationDrop = clampF(orDefault(out.FormationDrop, 18), 0, 60)
	out.GlobalFireMul = clampF(orDefault(out.GlobalFireMul, 1), 0, 3)
	out.DropChance = clampF(out.DropChance, 0, 1)
	out.Bunkers = clampI(out.Bunkers, 0, 4)

	if len(out.Waves) > MaxWaves {
		out.Waves = out.Waves[:MaxWaves]
	}
	waves := make([]Wave, 0, len(out.Waves))
	for _, w := range out.Waves {
		w.Archetype = strings.TrimSpace(w.Archetype)
		w.Pattern = strings.TrimSpace(w.Pattern)
		if w.Pattern == "" {
			w.Pattern = PatternGrid
		}
		w.Count = clampI(orDefaultI(w.Count, 1), 1, MaxWaveCount)
		w.Rows = clampI(w.Rows, 0, 20)
		w.Cols = clampI(w.Cols, 0, 20)
		w.Delay = clampF(w.Delay, 0, 600)
		w.Interval = clampF(w.Interval, 0, 60)
		w.SpeedMul = clampF(w.SpeedMul, 0, 5)
		w.FireMul = clampF(w.FireMul, 0, 5)
		w.Y = clampF(w.Y, 0, 0.85)
		w.Amp = clampF(w.Amp, 0, 200)
		if w.Pattern == PatternStream && w.Interval == 0 {
			w.Interval = 1.2
		}
		if w.Pattern == PatternStream && w.Side == "" {
			w.Side = "top"
		}
		if w.Pattern == PatternBoss {
			w.Count = 1
		}
		waves = append(waves, w)
	}
	out.Waves = waves

	if len(out.Hazards) > MaxHazardKinds {
		out.Hazards = out.Hazards[:MaxHazardKinds]
	}
	hazards := make([]Hazard, 0, len(out.Hazards))
	for _, h := range out.Hazards {
		h.Archetype = strings.TrimSpace(h.Archetype)
		h.Rate = clampF(h.Rate, 0, 5)
		h.Max = clampI(orDefaultI(h.Max, 3), 1, 12)
		h.Delay = clampF(h.Delay, 0, 600)
		h.SpeedMul = clampF(h.SpeedMul, 0, 5)
		hazards = append(hazards, h)
	}
	out.Hazards = hazards

	// Keep only powerups the client knows, without duplicates.
	known := map[string]bool{}
	for _, p := range powerupTable {
		known[p.ID] = true
	}
	seen := map[string]bool{}
	powerups := make([]string, 0, len(out.Powerups))
	for _, id := range out.Powerups {
		id = strings.TrimSpace(id)
		if known[id] && !seen[id] {
			seen[id] = true
			powerups = append(powerups, id)
		}
	}
	out.Powerups = powerups

	// The Boss field is derived, not authored: it is whatever boss wave the
	// level actually contains.
	out.Boss = ""
	for _, w := range out.Waves {
		if w.Pattern == PatternBoss {
			if a, ok := Archetypes[w.Archetype]; ok && a.Kind == KindBoss {
				out.Boss = w.Archetype
				break
			}
		}
	}
	return out
}

func orDefault(v, def float64) float64 {
	if v == 0 {
		return def
	}
	return v
}

func orDefaultI(v, def int) int {
	if v == 0 {
		return def
	}
	return v
}

// ValidateLevel reports everything wrong with a level, most serious first.
// A level with no fatal problems is playable and winnable.
func ValidateLevel(lv Level) []Problem {
	var ps []Problem
	add := func(fatal bool, field, format string, args ...any) {
		ps = append(ps, Problem{Field: field, Message: fmt.Sprintf(format, args...), Fatal: fatal})
	}

	if strings.TrimSpace(lv.Name) == "" {
		add(true, "name", "the level needs a name")
	}
	if lv.Tagline == "" {
		add(false, "tagline", "a tagline is shown on the briefing screen; this level has none")
	}
	if !contains(MusicTracks, lv.Music) {
		add(true, "music", "%q is not a track the audio engine has; pick one of %s",
			lv.Music, strings.Join(MusicTracks, ", "))
	}
	if !contains(Backdrops, lv.Backdrop) {
		add(true, "backdrop", "%q is not a known backdrop", lv.Backdrop)
	}

	if len(lv.Waves) == 0 {
		add(true, "waves", "a level with no waves has nothing to shoot")
	}
	if len(lv.Waves) > MaxWaves {
		add(true, "waves", "%d waves exceeds the limit of %d", len(lv.Waves), MaxWaves)
	}

	required := 0
	total := 0
	bossWaves := 0
	for i, w := range lv.Waves {
		field := fmt.Sprintf("waves[%d]", i)
		a, ok := Archetypes[w.Archetype]
		if !ok {
			add(true, field+".archetype", "there is no archetype called %q", w.Archetype)
			continue
		}
		if !contains(Patterns, w.Pattern) {
			add(true, field+".pattern", "%q is not a spawn pattern; use one of %s",
				w.Pattern, strings.Join(Patterns, ", "))
			continue
		}
		if w.Count < 1 || w.Count > MaxWaveCount {
			add(true, field+".count", "count %d is outside 1..%d", w.Count, MaxWaveCount)
		}

		switch w.Pattern {
		case PatternBoss:
			bossWaves++
			if a.Kind != KindBoss {
				add(true, field+".archetype", "%s is not a boss, so it cannot use the boss pattern", a.Name)
			}
		case PatternGrid:
			if w.Rows < 1 || w.Cols < 1 {
				add(false, field, "a grid without rows and cols falls back to a guessed square")
			} else if w.Rows*w.Cols < w.Count {
				add(false, field, "%d rows x %d cols holds %d, fewer than the count of %d; the rest will not spawn",
					w.Rows, w.Cols, w.Rows*w.Cols, w.Count)
			}
		case PatternStream:
			if w.Interval <= 0 {
				add(true, field+".interval", "a stream needs an interval between spawns")
			}
			if w.Side != "" && !contains(Sides, w.Side) {
				add(true, field+".side", "%q is not an edge; use one of %s", w.Side, strings.Join(Sides, ", "))
			}
		}

		if a.Kind == KindBoss && w.Pattern != PatternBoss {
			add(true, field+".pattern", "%s is a boss and needs the boss pattern", a.Name)
		}
		if a.Kind == KindObject {
			add(false, field+".archetype", "%s is a drifting object; it is usually a hazard rather than a wave", a.Name)
		}
		if w.Y > 0.6 {
			add(false, field+".y", "spawning at %.2f of the field puts this wave almost on the player", w.Y)
		}

		total += w.Count
		if a.Required {
			required += w.Count
		}
	}

	if bossWaves > 1 {
		add(true, "waves", "a level can only have one boss, this one has %d", bossWaves)
	}
	if len(lv.Waves) > 0 && required == 0 {
		add(true, "waves", "nothing in this level is required, so it can never be completed")
	}

	hazardLoad := 0
	for i, h := range lv.Hazards {
		field := fmt.Sprintf("hazards[%d]", i)
		a, ok := Archetypes[h.Archetype]
		if !ok {
			add(true, field+".archetype", "there is no archetype called %q", h.Archetype)
			continue
		}
		if a.Required {
			add(true, field+".archetype", "%s must be destroyed to clear a level, so it cannot trickle in as a hazard", a.Name)
		}
		if h.Rate <= 0 {
			add(false, field+".rate", "a rate of zero means this hazard never appears")
		}
		if h.Max < 1 {
			add(true, field+".max", "a hazard needs a concurrency cap of at least 1")
		}
		hazardLoad += h.Max
	}
	if len(lv.Hazards) > MaxHazardKinds {
		add(true, "hazards", "%d hazard kinds exceeds the limit of %d", len(lv.Hazards), MaxHazardKinds)
	}

	if total+hazardLoad > MaxLevelEntities {
		add(true, "waves", "%d attackers plus %d concurrent hazards is over the budget of %d",
			total, hazardLoad, MaxLevelEntities)
	}

	if lv.Bunkers < 0 || lv.Bunkers > 4 {
		add(true, "bunkers", "bunkers must be 0 to 4")
	}
	if lv.DropChance > 0 && len(lv.Powerups) == 0 {
		add(false, "powerups", "a drop chance above zero with no powerups listed will never drop anything")
	}

	sort.SliceStable(ps, func(i, j int) bool { return ps[i].Fatal && !ps[j].Fatal })
	return ps
}
