package game

import "strings"

// Difficulty scales the threat rather than the player. Every tier runs the
// same levels with the same archetypes; what changes is how often the swarm
// may fire, how well it aims, how fast its shots travel, how quickly the
// formation marches, how much hull a boss has, and how many lives you start
// with. Normal is the campaign exactly as it was balanced, so every
// multiplier on it is 1.
//
// Scoring is scaled too, and the server's anti-forgery ceiling is scaled
// with it: without that, a leaderboard would simply rank whoever picked the
// easiest tier.
type Difficulty struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Blurb string `json:"blurb"`
	Order int    `json:"order"`

	// Threat multipliers. Above 1 means "more forgiving" for the interval
	// and scatter fields, because a longer interval is less fire and a
	// wider scatter is worse aim.
	FireIntervalMul    float64 `json:"fireIntervalMul"`
	AimScatterMul      float64 `json:"aimScatterMul"`
	ProjectileSpeedMul float64 `json:"projectileSpeedMul"`
	FormationStepMul   float64 `json:"formationStepMul"`
	BossHPMul          float64 `json:"bossHpMul"`
	DropChanceMul      float64 `json:"dropChanceMul"`

	// Absolute figures.
	LivesBonus int `json:"livesBonus"`
	BulletCap  int `json:"bulletCap"`

	// ScoreMul scales everything scored, and with it the extra-life
	// threshold, so extra lives arrive at the same point in a run on every
	// tier.
	ScoreMul float64 `json:"scoreMul"`

	Default bool `json:"default,omitempty"`
}

// Difficulties are the selectable tiers, easiest first.
var Difficulties = []Difficulty{
	{
		ID: "supereasy", Name: "Super easy", Order: 0,
		Blurb:              "Sparse, slow fire and six hulls. For learning the levels.",
		FireIntervalMul:    2.0,
		AimScatterMul:      2.2,
		ProjectileSpeedMul: 0.72,
		FormationStepMul:   1.5,
		BossHPMul:          0.55,
		DropChanceMul:      2.0,
		LivesBonus:         3,
		BulletCap:          14,
		ScoreMul:           0.35,
	},
	{
		ID: "easy", Name: "Easy", Order: 1,
		Blurb:              "Fewer shots, worse aim, an extra hull.",
		FireIntervalMul:    1.45,
		AimScatterMul:      1.6,
		ProjectileSpeedMul: 0.85,
		FormationStepMul:   1.22,
		BossHPMul:          0.75,
		DropChanceMul:      1.5,
		LivesBonus:         1,
		BulletCap:          18,
		ScoreMul:           0.65,
	},
	{
		ID: "normal", Name: "Normal", Order: 2,
		Blurb:              "The campaign as it was balanced.",
		FireIntervalMul:    1,
		AimScatterMul:      1,
		ProjectileSpeedMul: 1,
		FormationStepMul:   1,
		BossHPMul:          1,
		DropChanceMul:      1,
		LivesBonus:         0,
		BulletCap:          24,
		ScoreMul:           1,
		Default:            true,
	},
	{
		ID: "hard", Name: "Hard", Order: 3,
		Blurb:              "Tighter fire, sharper aim, tougher capital ships.",
		FireIntervalMul:    0.78,
		AimScatterMul:      0.7,
		ProjectileSpeedMul: 1.12,
		FormationStepMul:   0.88,
		BossHPMul:          1.25,
		DropChanceMul:      0.8,
		LivesBonus:         0,
		BulletCap:          28,
		ScoreMul:           1.4,
	},
	{
		ID: "superhard", Name: "Super hard", Order: 4,
		Blurb:              "One hull fewer, and the swarm barely misses.",
		FireIntervalMul:    0.62,
		AimScatterMul:      0.45,
		ProjectileSpeedMul: 1.22,
		FormationStepMul:   0.78,
		BossHPMul:          1.5,
		DropChanceMul:      0.65,
		LivesBonus:         -1,
		BulletCap:          32,
		ScoreMul:           1.9,
	},
	{
		ID: "insane", Name: "Insane", Order: 5,
		Blurb:              "Two hulls, aimed fire and bosses that will not die.",
		FireIntervalMul:    0.5,
		AimScatterMul:      0.25,
		ProjectileSpeedMul: 1.35,
		FormationStepMul:   0.7,
		BossHPMul:          1.85,
		DropChanceMul:      0.5,
		LivesBonus:         -1,
		BulletCap:          38,
		ScoreMul:           2.6,
	},
}

// DefaultDifficulty is the tier used when none was chosen.
func DefaultDifficulty() Difficulty {
	for _, d := range Difficulties {
		if d.Default {
			return d
		}
	}
	return Difficulties[0]
}

// DifficultyByID resolves a tier, falling back to the default for anything
// unknown, so an old client or a hand-made request never breaks a run.
func DifficultyByID(id string) Difficulty {
	want := strings.ToLower(strings.TrimSpace(id))
	for _, d := range Difficulties {
		if d.ID == want {
			return d
		}
	}
	return DefaultDifficulty()
}

// StartingLives is how many hulls a run begins with on this tier, never
// fewer than one.
func (d Difficulty) StartingLives(base int) int {
	n := base + d.LivesBonus
	if n < 1 {
		return 1
	}
	return n
}
