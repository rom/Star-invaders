package game

import "testing"

func TestDifficultyTierIsComplete(t *testing.T) {
	want := []string{"supereasy", "easy", "normal", "hard", "superhard", "insane"}
	if len(Difficulties) != len(want) {
		t.Fatalf("%d tiers, want %d", len(Difficulties), len(want))
	}
	for i, d := range Difficulties {
		if d.ID != want[i] {
			t.Errorf("tier %d is %q, want %q", i, d.ID, want[i])
		}
		if d.Order != i {
			t.Errorf("tier %s has Order %d at index %d", d.ID, d.Order, i)
		}
		if d.Name == "" || d.Blurb == "" {
			t.Errorf("tier %s is missing a name or blurb", d.ID)
		}
		if d.BulletCap < 4 {
			t.Errorf("tier %s has an unusable bullet cap of %d", d.ID, d.BulletCap)
		}
		for name, v := range map[string]float64{
			"FireIntervalMul": d.FireIntervalMul, "AimScatterMul": d.AimScatterMul,
			"ProjectileSpeedMul": d.ProjectileSpeedMul, "FormationStepMul": d.FormationStepMul,
			"BossHPMul": d.BossHPMul, "DropChanceMul": d.DropChanceMul, "ScoreMul": d.ScoreMul,
		} {
			if v <= 0 {
				t.Errorf("tier %s has a non-positive %s (%v)", d.ID, name, v)
			}
		}
	}
}

// Normal has to be the campaign exactly as it was balanced, or the existing
// levels and the existing leaderboard no longer mean the same thing.
func TestNormalChangesNothing(t *testing.T) {
	d := DifficultyByID("normal")
	if !d.Default {
		t.Error("normal should be the default tier")
	}
	for name, v := range map[string]float64{
		"FireIntervalMul": d.FireIntervalMul, "AimScatterMul": d.AimScatterMul,
		"ProjectileSpeedMul": d.ProjectileSpeedMul, "FormationStepMul": d.FormationStepMul,
		"BossHPMul": d.BossHPMul, "DropChanceMul": d.DropChanceMul, "ScoreMul": d.ScoreMul,
	} {
		if v != 1 {
			t.Errorf("normal has %s = %v, want 1", name, v)
		}
	}
	if d.LivesBonus != 0 {
		t.Errorf("normal LivesBonus = %d, want 0", d.LivesBonus)
	}
	if got := d.StartingLives(DefaultRules.StartingLives); got != DefaultRules.StartingLives {
		t.Errorf("normal StartingLives = %d, want %d", got, DefaultRules.StartingLives)
	}
}

// Each tier must actually be harder than the one before it, or the picker
// is offering choices that do not differ.
func TestTiersAreMonotonic(t *testing.T) {
	for i := 1; i < len(Difficulties); i++ {
		a, b := Difficulties[i-1], Difficulties[i]
		if b.FireIntervalMul >= a.FireIntervalMul {
			t.Errorf("%s fires no more often than %s", b.ID, a.ID)
		}
		if b.AimScatterMul >= a.AimScatterMul {
			t.Errorf("%s aims no better than %s", b.ID, a.ID)
		}
		if b.ProjectileSpeedMul <= a.ProjectileSpeedMul {
			t.Errorf("%s shoots no faster than %s", b.ID, a.ID)
		}
		if b.FormationStepMul >= a.FormationStepMul {
			t.Errorf("%s marches no faster than %s", b.ID, a.ID)
		}
		if b.BossHPMul <= a.BossHPMul {
			t.Errorf("%s bosses are no tougher than %s", b.ID, a.ID)
		}
		if b.ScoreMul <= a.ScoreMul {
			t.Errorf("%s scores no better than %s", b.ID, a.ID)
		}
		if b.LivesBonus > a.LivesBonus {
			t.Errorf("%s starts with more hulls than %s", b.ID, a.ID)
		}
		if b.BulletCap <= a.BulletCap {
			t.Errorf("%s allows no more incoming fire than %s", b.ID, a.ID)
		}
	}
}

func TestStartingLivesNeverDropsBelowOne(t *testing.T) {
	for _, d := range Difficulties {
		if got := d.StartingLives(1); got < 1 {
			t.Errorf("tier %s with a base of 1 gives %d hulls", d.ID, got)
		}
	}
}

func TestDifficultyLookupFallsBack(t *testing.T) {
	if got := DifficultyByID("insane"); got.ID != "insane" {
		t.Errorf("lookup failed: %+v", got)
	}
	if got := DifficultyByID("  INSANE "); got.ID != "insane" {
		t.Errorf("lookup should trim and lowercase, got %q", got.ID)
	}
	for _, bad := range []string{"", "impossible", "nightmare"} {
		if got := DifficultyByID(bad); got.ID != "normal" {
			t.Errorf("DifficultyByID(%q) = %q, want the default", bad, got.ID)
		}
	}
}

// An insane run legitimately scores far above normal; the ceiling has to
// follow, or every one of those runs is rejected as a forgery.
func TestScoreCeilingFollowsTheTier(t *testing.T) {
	normal := ScoreCeilingFor(1, 5, DifficultyByID("normal"))
	insane := ScoreCeilingFor(1, 5, DifficultyByID("insane"))
	easy := ScoreCeilingFor(1, 5, DifficultyByID("supereasy"))

	if insane <= normal {
		t.Errorf("insane ceiling %d is not above normal's %d", insane, normal)
	}
	if easy >= normal {
		t.Errorf("super easy ceiling %d is not below normal's %d", easy, normal)
	}
	if normal != ScoreCeilingRange(1, 5) {
		t.Errorf("normal ceiling %d should equal the unscaled %d", normal, ScoreCeilingRange(1, 5))
	}
	if MaxScore() < insane {
		t.Errorf("MaxScore %d is below a reachable insane ceiling %d", MaxScore(), insane)
	}
}

func TestCampaignCarriesTheDifficulties(t *testing.T) {
	c := BuildCampaign()
	if len(c.Difficulties) != len(Difficulties) {
		t.Fatalf("campaign carries %d tiers, want %d", len(c.Difficulties), len(Difficulties))
	}
	defaults := 0
	for _, d := range c.Difficulties {
		if d.Default {
			defaults++
		}
	}
	if defaults != 1 {
		t.Errorf("%d tiers marked default, want exactly 1", defaults)
	}
}
