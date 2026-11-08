package game

import "testing"

func TestCampaignHasTwentyFiveLevels(t *testing.T) {
	if got := MaxLevel(); got != 25 {
		t.Fatalf("MaxLevel() = %d, want 25", got)
	}
	for i, lv := range Levels {
		if lv.Number != i+1 {
			t.Errorf("level at index %d has Number %d", i, lv.Number)
		}
		if lv.Name == "" || lv.Tagline == "" {
			t.Errorf("level %d is missing a name or tagline", lv.Number)
		}
		if lv.Music == "" {
			t.Errorf("level %d has no music track", lv.Number)
		}
	}
}

// Every level is supposed to field a mix of attackers, not a single kind.
func TestEveryLevelHasSeveralAttackerTypes(t *testing.T) {
	for _, lv := range Levels {
		kinds := map[string]bool{}
		required := 0
		for _, w := range lv.Waves {
			a, ok := Archetypes[w.Archetype]
			if !ok {
				t.Fatalf("level %d references unknown archetype %q", lv.Number, w.Archetype)
			}
			kinds[w.Archetype] = true
			if a.Required {
				required += max(1, w.Count)
			}
		}
		for _, h := range lv.Hazards {
			if _, ok := Archetypes[h.Archetype]; !ok {
				t.Fatalf("level %d references unknown hazard %q", lv.Number, h.Archetype)
			}
			if h.Max <= 0 {
				t.Errorf("level %d hazard %s has no concurrency cap", lv.Number, h.Archetype)
			}
		}
		if len(kinds) < 2 {
			t.Errorf("level %d fields only %d attacker type(s); want at least 2", lv.Number, len(kinds))
		}
		if required == 0 {
			t.Errorf("level %d has no required attackers, so it could never be completed", lv.Number)
		}
	}
}

func TestHazardsAreNeverRequired(t *testing.T) {
	// A hazard that gated progression would make a level unwinnable, because
	// hazards spawn on a timer rather than from a finite wave list.
	for _, lv := range Levels {
		for _, h := range lv.Hazards {
			if Archetypes[h.Archetype].Required {
				t.Errorf("level %d hazard %s is marked Required", lv.Number, h.Archetype)
			}
		}
	}
}

func TestBossLevelsDeclareTheirBoss(t *testing.T) {
	bossLevels := map[int]string{
		5: "warden", 9: "harbinger", 12: "dreadnought",
		16: "leviathan", 20: "oracle", 25: "sovereign",
	}
	for _, lv := range Levels {
		want, isBoss := bossLevels[lv.Number]
		if isBoss {
			if lv.Boss != want {
				t.Errorf("level %d Boss = %q, want %q", lv.Number, lv.Boss, want)
			}
			found := false
			for _, w := range lv.Waves {
				if w.Archetype == want && w.Pattern == PatternBoss {
					found = true
				}
			}
			if !found {
				t.Errorf("level %d declares boss %q but has no boss wave", lv.Number, want)
			}
			continue
		}
		if lv.Boss != "" {
			t.Errorf("level %d unexpectedly declares boss %q", lv.Number, lv.Boss)
		}
	}
}

// The campaign has to end on its boss, and the bosses have to be spread
// through it rather than bunched at one end.
func TestBossesArePacedThroughTheCampaign(t *testing.T) {
	var bossAt []int
	for _, lv := range Levels {
		if lv.Boss != "" {
			bossAt = append(bossAt, lv.Number)
		}
	}
	if len(bossAt) < 5 {
		t.Errorf("only %d boss levels in a %d level campaign: %v", len(bossAt), MaxLevel(), bossAt)
	}
	if bossAt[len(bossAt)-1] != MaxLevel() {
		t.Errorf("the campaign ends on level %d, which is not a boss", MaxLevel())
	}
	for i := 1; i < len(bossAt); i++ {
		if gap := bossAt[i] - bossAt[i-1]; gap > 6 {
			t.Errorf("%d levels between bosses %d and %d", gap, bossAt[i-1], bossAt[i])
		}
	}
}

// Every archetype should earn its place: one that no level fields is dead
// weight in the bestiary and in the codex.
func TestEveryArchetypeIsUsed(t *testing.T) {
	used := map[string]bool{}
	for _, lv := range Levels {
		for _, w := range lv.Waves {
			used[w.Archetype] = true
		}
		for _, h := range lv.Hazards {
			used[h.Archetype] = true
		}
	}
	// Children spawned by a parent count as used.
	for id, a := range Archetypes {
		if used[id] {
			if a.SplitInto != "" {
				used[a.SplitInto] = true
			}
			if a.HatchInto != "" {
				used[a.HatchInto] = true
			}
		}
	}
	for id := range Archetypes {
		if !used[id] {
			t.Errorf("archetype %q is never fielded by any level", id)
		}
	}
}

// A hatching attacker needs something real to hatch, on a sane cadence.
func TestHatchingArchetypesAreCoherent(t *testing.T) {
	for id, a := range Archetypes {
		if a.HatchInto == "" {
			if a.HatchEvery != 0 {
				t.Errorf("%s has a hatch interval but nothing to hatch", id)
			}
			continue
		}
		child, ok := Archetypes[a.HatchInto]
		if !ok {
			t.Errorf("%s hatches unknown %q", id, a.HatchInto)
			continue
		}
		if child.Kind == KindBoss {
			t.Errorf("%s hatches a boss", id)
		}
		if a.HatchEvery < 1 {
			t.Errorf("%s hatches every %.2fs, which is too often to survive", id, a.HatchEvery)
		}
	}
}

func TestSplitterChildrenExist(t *testing.T) {
	for id, a := range Archetypes {
		if a.SplitInto == "" {
			continue
		}
		if _, ok := Archetypes[a.SplitInto]; !ok {
			t.Errorf("archetype %s splits into unknown %q", id, a.SplitInto)
		}
		if a.SplitCount <= 0 {
			t.Errorf("archetype %s has SplitInto but SplitCount %d", id, a.SplitCount)
		}
	}
}

func TestArchetypeIDsMatchTheirKeys(t *testing.T) {
	for key, a := range Archetypes {
		if a.ID != key {
			t.Errorf("archetype keyed %q has ID %q", key, a.ID)
		}
		if a.Sprite == "" || a.Color == "" || a.Codex == "" {
			t.Errorf("archetype %s is missing sprite, colour or codex text", key)
		}
		if a.HP <= 0 || a.Radius <= 0 {
			t.Errorf("archetype %s has non-positive hp/radius", key)
		}
	}
}

func TestScoreCeilingIsMonotonicAndBounded(t *testing.T) {
	prev := 0
	for n := 1; n <= MaxLevel(); n++ {
		got := ScoreCeiling(n)
		if got <= prev {
			t.Errorf("ScoreCeiling(%d) = %d, not greater than ScoreCeiling(%d) = %d", n, got, n-1, prev)
		}
		prev = got
	}
	// MaxScore bounds any run on any tier, so it tracks the most generously
	// scored difficulty rather than the unscaled campaign ceiling.
	hardest := Difficulties[0]
	for _, d := range Difficulties {
		if d.ScoreMul > hardest.ScoreMul {
			hardest = d
		}
	}
	if want := ScoreCeilingFor(1, MaxLevel(), hardest); MaxScore() != want {
		t.Errorf("MaxScore() = %d, want %d (the %s ceiling)", MaxScore(), want, hardest.ID)
	}
	if MaxScore() < ScoreCeiling(MaxLevel()) {
		t.Errorf("MaxScore() = %d is below the unscaled campaign ceiling %d",
			MaxScore(), ScoreCeiling(MaxLevel()))
	}
}

func TestScoreCeilingRangeIsNarrowerThanFromLevelOne(t *testing.T) {
	// Starting on level 7 must not inherit the allowance for levels 1-6.
	full := ScoreCeilingRange(1, 8)
	partial := ScoreCeilingRange(7, 8)
	if partial >= full {
		t.Errorf("ScoreCeilingRange(7,8) = %d, want less than ScoreCeilingRange(1,8) = %d", partial, full)
	}
	if got := ScoreCeilingRange(9, 3); got != ScoreCeilingRange(9, 9) {
		t.Errorf("an inverted range should collapse to a single level, got %d", got)
	}
	if got := ScoreCeilingRange(0, 99); got != ScoreCeilingRange(1, MaxLevel()) {
		t.Errorf("out of range bounds should clamp, got %d", got)
	}
}

func TestLevelByNumber(t *testing.T) {
	lv, ok := LevelByNumber(5)
	if !ok || lv.Name != "The Warden" {
		t.Errorf("LevelByNumber(5) = %q, %v", lv.Name, ok)
	}
	if _, ok := LevelByNumber(0); ok {
		t.Error("LevelByNumber(0) should not resolve")
	}
	if _, ok := LevelByNumber(MaxLevel()); !ok {
		t.Error("the last level should resolve")
	}
	if _, ok := LevelByNumber(MaxLevel() + 1); ok {
		t.Error("a level past the end should not resolve")
	}
}

func TestBuildCampaignIsComplete(t *testing.T) {
	c := BuildCampaign()
	if c.LevelCount != len(c.Levels) || c.LevelCount != 25 {
		t.Errorf("campaign reports %d levels, has %d", c.LevelCount, len(c.Levels))
	}
	if len(c.Archetypes) == 0 || len(c.Powerups) == 0 {
		t.Error("campaign is missing archetypes or powerups")
	}
	if c.Rules.StartingLives <= 0 || c.Rules.BulletSpeed <= 0 {
		t.Error("campaign rules look unset")
	}
	// Every powerup a level can drop must be described for the client.
	described := map[string]bool{}
	for _, p := range c.Powerups {
		described[p.ID] = true
	}
	for _, lv := range c.Levels {
		for _, id := range lv.Powerups {
			if !described[id] {
				t.Errorf("level %d can drop undescribed powerup %q", lv.Number, id)
			}
		}
	}
}
