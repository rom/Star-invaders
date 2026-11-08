package game

import (
	"strings"
	"testing"
)

func problemFields(ps []Problem) []string {
	out := make([]string, 0, len(ps))
	for _, p := range ps {
		out = append(out, p.Field)
	}
	return out
}

func fatalAbout(t *testing.T, ps []Problem, field string) Problem {
	t.Helper()
	for _, p := range ps {
		if p.Field == field && p.Fatal {
			return p
		}
	}
	t.Fatalf("expected a fatal problem about %q, got %v", field, problemFields(ps))
	return Problem{}
}

// The campaign that ships has to satisfy the same rules a hand-authored
// level does, otherwise the validator is wrong about one of them.
func TestShippedCampaignValidates(t *testing.T) {
	for _, lv := range Levels {
		ps := ValidateLevel(lv)
		for _, p := range ps {
			if p.Fatal {
				t.Errorf("level %d (%s): %s: %s", lv.Number, lv.Name, p.Field, p.Message)
			}
		}
	}
}

func TestShippedCampaignSurvivesNormalisation(t *testing.T) {
	// Normalising a valid level must not change it.
	for _, lv := range Levels {
		got := NormalizeLevel(lv)
		if got.Name != lv.Name || got.Music != lv.Music || got.Backdrop != lv.Backdrop {
			t.Errorf("level %d had its text changed by normalisation", lv.Number)
		}
		if len(got.Waves) != len(lv.Waves) || len(got.Hazards) != len(lv.Hazards) {
			t.Errorf("level %d lost waves or hazards in normalisation", lv.Number)
		}
		if got.Boss != lv.Boss {
			t.Errorf("level %d: derived boss %q != declared %q", lv.Number, got.Boss, lv.Boss)
		}
	}
}

func minimalLevel() Level {
	return Level{
		Name: "Test", Tagline: "A test", Music: "march", Backdrop: "deepblue",
		StarSpeed: 1, FormationStep: 0.6, FormationDrop: 18, GlobalFireMul: 1,
		Waves: []Wave{{Archetype: "grunt", Pattern: PatternGrid, Rows: 2, Cols: 4, Count: 8, Y: 0.15}},
	}
}

func TestMinimalLevelIsValid(t *testing.T) {
	if ps := ValidateLevel(minimalLevel()); HasFatal(ps) {
		t.Fatalf("a minimal level should be playable: %v", ps)
	}
}

func TestLevelWithNothingRequiredIsRejected(t *testing.T) {
	lv := minimalLevel()
	lv.Waves = []Wave{{Archetype: "asteroid", Pattern: PatternGrid, Rows: 1, Cols: 3, Count: 3}}
	p := fatalAbout(t, ValidateLevel(lv), "waves")
	if !strings.Contains(p.Message, "never be completed") {
		t.Errorf("message = %q", p.Message)
	}
}

func TestUnknownArchetypeIsRejected(t *testing.T) {
	lv := minimalLevel()
	lv.Waves[0].Archetype = "space-goose"
	fatalAbout(t, ValidateLevel(lv), "waves[0].archetype")
}

func TestUnknownPatternIsRejected(t *testing.T) {
	lv := minimalLevel()
	lv.Waves[0].Pattern = "spiral-of-doom"
	fatalAbout(t, ValidateLevel(lv), "waves[0].pattern")
}

func TestBossNeedsTheBossPattern(t *testing.T) {
	lv := minimalLevel()
	lv.Waves = append(lv.Waves, Wave{Archetype: "warden", Pattern: PatternGrid, Count: 1})
	fatalAbout(t, ValidateLevel(lv), "waves[1].pattern")
}

func TestNonBossCannotUseTheBossPattern(t *testing.T) {
	lv := minimalLevel()
	lv.Waves = append(lv.Waves, Wave{Archetype: "grunt", Pattern: PatternBoss, Count: 1})
	fatalAbout(t, ValidateLevel(lv), "waves[1].archetype")
}

func TestOnlyOneBossPerLevel(t *testing.T) {
	lv := minimalLevel()
	lv.Waves = append(lv.Waves,
		Wave{Archetype: "warden", Pattern: PatternBoss, Count: 1},
		Wave{Archetype: "harbinger", Pattern: PatternBoss, Count: 1},
	)
	fatalAbout(t, ValidateLevel(lv), "waves")
}

// A required archetype as a hazard would gate completion on something that
// spawns on a timer, so the level could never be cleared.
func TestRequiredArchetypeCannotBeAHazard(t *testing.T) {
	lv := minimalLevel()
	lv.Hazards = []Hazard{{Archetype: "grunt", Rate: 0.2, Max: 3}}
	fatalAbout(t, ValidateLevel(lv), "hazards[0].archetype")
}

func TestUnknownMusicAndBackdropAreRejected(t *testing.T) {
	lv := minimalLevel()
	lv.Music = "jazz"
	lv.Backdrop = "plaid"
	ps := ValidateLevel(lv)
	fatalAbout(t, ps, "music")
	fatalAbout(t, ps, "backdrop")
}

func TestEntityBudgetIsEnforced(t *testing.T) {
	lv := minimalLevel()
	lv.Waves = nil
	for i := 0; i < 5; i++ {
		lv.Waves = append(lv.Waves, Wave{Archetype: "grunt", Pattern: PatternGrid, Rows: 10, Cols: 10, Count: MaxWaveCount})
	}
	fatalAbout(t, ValidateLevel(lv), "waves")
}

func TestStreamNeedsAnInterval(t *testing.T) {
	lv := minimalLevel()
	lv.Waves = append(lv.Waves, Wave{Archetype: "scout", Pattern: PatternStream, Count: 4, Interval: 0})
	// Normalisation supplies a default, so validate the raw level.
	fatalAbout(t, ValidateLevel(lv), "waves[1].interval")
	if ps := ValidateLevel(NormalizeLevel(lv)); HasFatal(ps) {
		t.Errorf("normalisation should have supplied an interval: %v", ps)
	}
}

func TestNormalizeClampsAndTrims(t *testing.T) {
	lv := Level{
		Name:    "   Spaced   \x07Out   ",
		Tagline: strings.Repeat("x", MaxTaglineRunes+50),
		Music:   "", Backdrop: "",
		StarSpeed: 99, FormationStep: 0, GlobalFireMul: -4, Bunkers: 17, DropChance: 5,
		Powerups: []string{"rapid", "rapid", "not-a-powerup"},
		Waves:    []Wave{{Archetype: "grunt", Pattern: "", Count: 9999, Y: 3}},
		Hazards:  []Hazard{{Archetype: "comet", Rate: 99, Max: 0}},
	}
	got := NormalizeLevel(lv)

	if got.Name != "Spaced Out" {
		t.Errorf("Name = %q", got.Name)
	}
	if len([]rune(got.Tagline)) > MaxTaglineRunes {
		t.Errorf("tagline not capped: %d runes", len([]rune(got.Tagline)))
	}
	if got.Music != "march" || got.Backdrop != "deepblue" {
		t.Errorf("defaults not applied: %q %q", got.Music, got.Backdrop)
	}
	if got.StarSpeed != 4 || got.GlobalFireMul != 0 || got.Bunkers != 4 || got.DropChance != 1 {
		t.Errorf("numbers not clamped: %+v", got)
	}
	if got.FormationStep == 0 {
		t.Error("FormationStep should have taken its default")
	}
	if len(got.Powerups) != 1 || got.Powerups[0] != "rapid" {
		t.Errorf("powerups = %v, want the known one, deduplicated", got.Powerups)
	}
	if got.Waves[0].Count != MaxWaveCount || got.Waves[0].Y != 0.85 || got.Waves[0].Pattern != PatternGrid {
		t.Errorf("wave not clamped: %+v", got.Waves[0])
	}
	if got.Hazards[0].Rate != 5 || got.Hazards[0].Max != 3 {
		t.Errorf("hazard not clamped: %+v", got.Hazards[0])
	}
}

// Boss is derived from the waves, so an author cannot claim a boss the level
// does not field, or forget to declare one it does.
func TestNormalizeDerivesTheBossField(t *testing.T) {
	lv := minimalLevel()
	lv.Boss = "dreadnought"
	if got := NormalizeLevel(lv); got.Boss != "" {
		t.Errorf("Boss = %q, want cleared when there is no boss wave", got.Boss)
	}

	lv.Boss = ""
	lv.Waves = append(lv.Waves, Wave{Archetype: "warden", Pattern: PatternBoss, Count: 1, Y: 0.22})
	if got := NormalizeLevel(lv); got.Boss != "warden" {
		t.Errorf("Boss = %q, want warden", got.Boss)
	}
}

func TestCampaignCarriesTheEditorVocabularies(t *testing.T) {
	c := BuildCampaign()
	if len(c.MusicTracks) == 0 || len(c.Backdrops) == 0 || len(c.Patterns) == 0 || len(c.Sides) == 0 {
		t.Fatal("the editor would have nothing to populate its menus from")
	}
	if c.Limits.MaxWaves != MaxWaves || c.Limits.MaxLevelEntities != MaxLevelEntities {
		t.Error("limits in the payload do not match the validator's")
	}
	// Every backdrop and track the shipped campaign uses must be listed.
	for _, lv := range Levels {
		if !contains(c.MusicTracks, lv.Music) {
			t.Errorf("level %d uses unlisted track %q", lv.Number, lv.Music)
		}
		if !contains(c.Backdrops, lv.Backdrop) {
			t.Errorf("level %d uses unlisted backdrop %q", lv.Number, lv.Backdrop)
		}
	}
}
