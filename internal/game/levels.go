package game

// Pattern names the spawn layout a wave uses.
const (
	PatternGrid   = "grid"   // rectangular marching formation (rows x cols)
	PatternArc    = "arc"    // shallow arc of slots, marches as one formation
	PatternVee    = "vee"    // chevron formation
	PatternStream = "stream" // spawned one at a time from an edge
	PatternRandom = "random" // scattered across the upper field
	PatternBoss   = "boss"   // single scripted boss
)

// Wave is one group of attackers inside a level. Waves with a formation
// pattern (grid/arc/vee) march together as a unit; stream and random waves
// trickle in on a timer.
type Wave struct {
	Archetype string  `json:"archetype"`
	Count     int     `json:"count"`
	Rows      int     `json:"rows,omitempty"`
	Cols      int     `json:"cols,omitempty"`
	Pattern   string  `json:"pattern"`
	Delay     float64 `json:"delay"`              // seconds after level start
	Interval  float64 `json:"interval,omitempty"` // seconds between stream spawns
	SpeedMul  float64 `json:"speedMul,omitempty"` // multiplies archetype speed
	FireMul   float64 `json:"fireMul,omitempty"`  // multiplies archetype fire rate
	Side      string  `json:"side,omitempty"`     // left | right | top | random
	Y         float64 `json:"y,omitempty"`        // formation anchor, 0..1 of play height
	Amp       float64 `json:"amp,omitempty"`      // weave/orbit amplitude in px
}

// Hazard is a continuous trickle of unknown space objects. Hazards never
// gate level completion; they are scenery that can kill you.
type Hazard struct {
	Archetype string  `json:"archetype"`
	Rate      float64 `json:"rate"`  // expected spawns per second
	Max       int     `json:"max"`   // concurrent cap
	Delay     float64 `json:"delay"` // seconds before the first one
	SpeedMul  float64 `json:"speedMul,omitempty"`
}

// Level is one of the twelve stages.
type Level struct {
	Number    int     `json:"number"`
	Name      string  `json:"name"`
	Tagline   string  `json:"tagline"`
	Music     string  `json:"music"`    // audio engine track key
	Backdrop  string  `json:"backdrop"` // renderer nebula key
	StarSpeed float64 `json:"starSpeed"`

	// Formation tuning for this level.
	FormationStep float64 `json:"formationStep"` // seconds between marching steps at full strength
	FormationDrop float64 `json:"formationDrop"` // px dropped when the formation reverses
	GlobalFireMul float64 `json:"globalFireMul"` // scales every attacker's fire rate

	Bunkers int `json:"bunkers"` // destructible cover emplacements, 0-4

	Waves   []Wave   `json:"waves"`
	Hazards []Hazard `json:"hazards"`
	Boss    string   `json:"boss,omitempty"`

	DropChance float64  `json:"dropChance"` // chance a required kill drops a powerup
	Powerups   []string `json:"powerups"`
}

// Powerup identifiers understood by the client.
const (
	PowerRapid  = "rapid"  // faster cooldown, more bullets in flight
	PowerSpread = "spread" // three-way shot
	PowerShield = "shield" // absorbs one hit
	PowerPierce = "pierce" // bullets punch through one target
	PowerLife   = "life"   // extra life
	PowerBomb   = "bomb"   // screen-clearing smart bomb charge
	PowerMagnet = "magnet" // pulls score pickups in
)

// Levels is the twelve-level campaign, in order. Every level fields a mix of
// attacker types; levels 5, 9 and 12 add a boss on top.
var Levels = []Level{
	{
		Number: 1, Name: "First Contact", Tagline: "Three rows of them. They have not seen a gunship before.",
		Music: "march", Backdrop: "deepblue", StarSpeed: 1,
		FormationStep: 0.78, FormationDrop: 16, GlobalFireMul: 0.75, Bunkers: 4,
		Waves: []Wave{
			{Archetype: "grunt", Pattern: PatternGrid, Rows: 3, Cols: 7, Count: 21, Y: 0.14},
			{Archetype: "scout", Pattern: PatternStream, Count: 2, Delay: 16, Interval: 7, Side: "random"},
		},
		DropChance: 0.08, Powerups: []string{PowerRapid, PowerShield},
	},
	{
		Number: 2, Name: "Debris Field", Tagline: "Something shattered a moon out here. The rocks do not care about you.",
		Music: "march", Backdrop: "rust", StarSpeed: 1.15,
		FormationStep: 0.7, FormationDrop: 17, GlobalFireMul: 0.85, Bunkers: 4,
		Waves: []Wave{
			{Archetype: "grunt", Pattern: PatternGrid, Rows: 3, Cols: 8, Count: 24, Y: 0.13},
			{Archetype: "gunner", Pattern: PatternArc, Count: 4, Y: 0.07, Delay: 4},
			{Archetype: "scout", Pattern: PatternStream, Count: 4, Delay: 12, Interval: 6, Side: "random"},
		},
		Hazards: []Hazard{
			{Archetype: "asteroid", Rate: 0.22, Max: 3, Delay: 5},
		},
		DropChance: 0.09, Powerups: []string{PowerRapid, PowerShield, PowerSpread},
	},
	{
		Number: 3, Name: "Scout Patrol", Tagline: "Needle scouts. They peel off the line and come straight down at you.",
		Music: "march", Backdrop: "violet", StarSpeed: 1.25,
		FormationStep: 0.66, FormationDrop: 18, GlobalFireMul: 0.95, Bunkers: 3,
		Waves: []Wave{
			{Archetype: "grunt", Pattern: PatternGrid, Rows: 2, Cols: 8, Count: 16, Y: 0.12},
			{Archetype: "scout", Pattern: PatternGrid, Rows: 1, Cols: 6, Count: 6, Y: 0.26, SpeedMul: 1.05},
			{Archetype: "scout", Pattern: PatternStream, Count: 6, Delay: 10, Interval: 4.5, Side: "random"},
			{Archetype: "gunner", Pattern: PatternVee, Count: 5, Y: 0.05, Delay: 6},
		},
		Hazards: []Hazard{
			{Archetype: "asteroid", Rate: 0.18, Max: 3, Delay: 8},
		},
		DropChance: 0.1, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce},
	},
	{
		Number: 4, Name: "Zero Horizon", Tagline: "Weavers on a sine wave, comets on a straight line. Lead everything.",
		Music: "tension", Backdrop: "teal", StarSpeed: 1.4,
		FormationStep: 0.62, FormationDrop: 18, GlobalFireMul: 1, Bunkers: 3,
		Waves: []Wave{
			{Archetype: "weaver", Pattern: PatternGrid, Rows: 2, Cols: 7, Count: 14, Y: 0.14, Amp: 34},
			{Archetype: "gunner", Pattern: PatternGrid, Rows: 1, Cols: 6, Count: 6, Y: 0.05},
			{Archetype: "grunt", Pattern: PatternArc, Count: 8, Y: 0.27, Delay: 3},
			{Archetype: "scout", Pattern: PatternStream, Count: 5, Delay: 14, Interval: 5, Side: "random"},
		},
		Hazards: []Hazard{
			{Archetype: "comet", Rate: 0.3, Max: 4, Delay: 6},
			{Archetype: "asteroid", Rate: 0.12, Max: 2, Delay: 14},
		},
		DropChance: 0.11, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb},
	},
	{
		Number: 5, Name: "The Warden", Tagline: "BOSS - the gaol-keeper of the outer belt, and it brought the guard.",
		Music: "boss", Backdrop: "amber", StarSpeed: 1.1,
		FormationStep: 0.6, FormationDrop: 15, GlobalFireMul: 0.9, Bunkers: 2,
		Boss: "warden",
		Waves: []Wave{
			{Archetype: "warden", Pattern: PatternBoss, Count: 1, Y: 0.22},
			{Archetype: "grunt", Pattern: PatternGrid, Rows: 2, Cols: 6, Count: 12, Y: 0.36},
			{Archetype: "scout", Pattern: PatternStream, Count: 6, Delay: 18, Interval: 8, Side: "random"},
		},
		Hazards: []Hazard{
			{Archetype: "asteroid", Rate: 0.14, Max: 2, Delay: 12},
		},
		DropChance: 0.16, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerLife, PowerBomb},
	},
	{
		Number: 6, Name: "Splitter Cells", Tagline: "Kill one and you have made two. Mind your bullet count.",
		Music: "tension", Backdrop: "moss", StarSpeed: 1.35,
		FormationStep: 0.58, FormationDrop: 19, GlobalFireMul: 1.05, Bunkers: 3,
		Waves: []Wave{
			{Archetype: "splitter", Pattern: PatternGrid, Rows: 2, Cols: 6, Count: 12, Y: 0.13},
			{Archetype: "weaver", Pattern: PatternArc, Count: 6, Y: 0.28, Amp: 40, Delay: 2},
			{Archetype: "gunner", Pattern: PatternGrid, Rows: 1, Cols: 7, Count: 7, Y: 0.04},
			{Archetype: "scout", Pattern: PatternStream, Count: 6, Delay: 12, Interval: 5, Side: "random"},
		},
		Hazards: []Hazard{
			{Archetype: "asteroid", Rate: 0.16, Max: 3, Delay: 10},
			{Archetype: "derelict", Rate: 0.03, Max: 1, Delay: 25},
		},
		DropChance: 0.12, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb},
	},
	{
		Number: 7, Name: "Cold Orbit", Tagline: "Orbiters, live mines and a comet lane. Nothing here holds still.",
		Music: "tension", Backdrop: "ice", StarSpeed: 1.5,
		FormationStep: 0.55, FormationDrop: 19, GlobalFireMul: 1.1, Bunkers: 2,
		Waves: []Wave{
			{Archetype: "orbiter", Pattern: PatternRandom, Count: 8, Y: 0.2, Amp: 72},
			{Archetype: "gunner", Pattern: PatternGrid, Rows: 2, Cols: 7, Count: 14, Y: 0.1},
			{Archetype: "weaver", Pattern: PatternVee, Count: 5, Y: 0.3, Amp: 30, Delay: 5},
		},
		Hazards: []Hazard{
			{Archetype: "comet", Rate: 0.42, Max: 5, Delay: 4},
			{Archetype: "mine", Rate: 0.22, Max: 4, Delay: 9},
		},
		DropChance: 0.13, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet},
	},
	{
		Number: 8, Name: "Ghost Signal", Tagline: "Phantoms fade out of your targeting solution. Lancers do not.",
		Music: "tension", Backdrop: "void", StarSpeed: 1.6,
		FormationStep: 0.52, FormationDrop: 20, GlobalFireMul: 1.1, Bunkers: 2,
		Waves: []Wave{
			{Archetype: "phantom", Pattern: PatternGrid, Rows: 3, Cols: 6, Count: 18, Y: 0.13},
			{Archetype: "lancer", Pattern: PatternStream, Count: 5, Delay: 8, Interval: 6.5, Side: "top"},
			{Archetype: "gunner", Pattern: PatternArc, Count: 6, Y: 0.31, Delay: 4},
		},
		Hazards: []Hazard{
			{Archetype: "mine", Rate: 0.3, Max: 5, Delay: 6},
			{Archetype: "comet", Rate: 0.2, Max: 3, Delay: 12},
		},
		DropChance: 0.14, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet},
	},
	{
		Number: 9, Name: "The Harbinger", Tagline: "BOSS - it blinks between planes and it is not alone in there.",
		Music: "boss", Backdrop: "aurora", StarSpeed: 1.3,
		FormationStep: 0.5, FormationDrop: 16, GlobalFireMul: 1, Bunkers: 2,
		Boss: "harbinger",
		Waves: []Wave{
			{Archetype: "harbinger", Pattern: PatternBoss, Count: 1, Y: 0.22},
			{Archetype: "phantom", Pattern: PatternArc, Count: 6, Y: 0.37},
			{Archetype: "scout", Pattern: PatternStream, Count: 8, Delay: 14, Interval: 6, Side: "random"},
		},
		Hazards: []Hazard{
			{Archetype: "comet", Rate: 0.26, Max: 4, Delay: 10},
		},
		DropChance: 0.18, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerLife, PowerBomb, PowerPierce},
	},
	{
		Number: 10, Name: "Swarm Protocol", Tagline: "Thirty six swarmlets and a lancer screen. Keep moving.",
		Music: "swarm", Backdrop: "ember", StarSpeed: 1.8,
		FormationStep: 0.48, FormationDrop: 20, GlobalFireMul: 1.15, Bunkers: 1,
		Waves: []Wave{
			{Archetype: "swarmer", Pattern: PatternStream, Count: 36, Delay: 1, Interval: 0.7, Side: "top", SpeedMul: 1},
			{Archetype: "lancer", Pattern: PatternStream, Count: 7, Delay: 6, Interval: 5, Side: "top"},
			{Archetype: "gunner", Pattern: PatternGrid, Rows: 2, Cols: 6, Count: 12, Y: 0.1},
		},
		Hazards: []Hazard{
			{Archetype: "asteroid", Rate: 0.2, Max: 3, Delay: 8},
			{Archetype: "comet", Rate: 0.24, Max: 4, Delay: 14},
		},
		DropChance: 0.1, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet},
	},
	{
		Number: 11, Name: "Siege Line", Tagline: "Armoured bulwarks behind a gun line. Flank the plating or out-gun it.",
		Music: "siege", Backdrop: "steel", StarSpeed: 1.5,
		FormationStep: 0.46, FormationDrop: 21, GlobalFireMul: 1.2, Bunkers: 2,
		Waves: []Wave{
			{Archetype: "bulwark", Pattern: PatternGrid, Rows: 2, Cols: 5, Count: 10, Y: 0.11},
			{Archetype: "gunner", Pattern: PatternGrid, Rows: 2, Cols: 7, Count: 14, Y: 0.3},
			{Archetype: "splitter", Pattern: PatternArc, Count: 4, Y: 0.44, Delay: 6},
			{Archetype: "phantom", Pattern: PatternStream, Count: 5, Delay: 16, Interval: 7, Side: "random"},
		},
		Hazards: []Hazard{
			{Archetype: "comet", Rate: 0.3, Max: 4, Delay: 6},
			{Archetype: "asteroid", Rate: 0.2, Max: 3, Delay: 10},
			{Archetype: "mine", Rate: 0.14, Max: 3, Delay: 18},
		},
		DropChance: 0.15, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet, PowerLife},
	},
	{
		Number: 12, Name: "Void Dreadnought", Tagline: "BOSS - the thing the first eleven levels were warning you about.",
		Music: "final", Backdrop: "singularity", StarSpeed: 2,
		FormationStep: 0.44, FormationDrop: 18, GlobalFireMul: 1.15, Bunkers: 2,
		Boss: "dreadnought",
		Waves: []Wave{
			{Archetype: "dreadnought", Pattern: PatternBoss, Count: 1, Y: 0.22},
			{Archetype: "bulwark", Pattern: PatternArc, Count: 4, Y: 0.4},
			{Archetype: "swarmer", Pattern: PatternStream, Count: 20, Delay: 10, Interval: 1.8, Side: "top"},
			{Archetype: "lancer", Pattern: PatternStream, Count: 6, Delay: 22, Interval: 7, Side: "top"},
		},
		Hazards: []Hazard{
			{Archetype: "comet", Rate: 0.3, Max: 4, Delay: 8},
			{Archetype: "mine", Rate: 0.18, Max: 4, Delay: 16},
			{Archetype: "asteroid", Rate: 0.14, Max: 2, Delay: 20},
		},
		DropChance: 0.2, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet, PowerLife},
	},
	{
		Number: 13, Name: "Shrike Country", Tagline: "Scouts that commit. They dive twice as often and pull out half as late.",
		Music: "swarm", Backdrop: "ember", StarSpeed: 1.7,
		FormationStep: 0.44, FormationDrop: 20, GlobalFireMul: 1.1, Bunkers: 3,
		Waves: []Wave{
			{Archetype: "shrike", Pattern: PatternGrid, Rows: 2, Cols: 7, Count: 14, Y: 0.14},
			{Archetype: "grunt", Pattern: PatternGrid, Rows: 2, Cols: 8, Count: 16, Y: 0.3},
			{Archetype: "shrike", Pattern: PatternStream, Count: 6, Delay: 12, Interval: 5, Side: "random"},
		},
		Hazards: []Hazard{
			{Archetype: "comet", Rate: 0.28, Max: 4, Delay: 6},
		},
		DropChance: 0.14, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb},
	},
	{
		Number: 14, Name: "Broodfall", Tagline: "Kill the hives first. Everything else is a consequence of not doing that.",
		Music: "tension", Backdrop: "moss", StarSpeed: 1.45,
		FormationStep: 0.46, FormationDrop: 20, GlobalFireMul: 1.05, Bunkers: 3,
		Waves: []Wave{
			{Archetype: "hive", Pattern: PatternArc, Count: 3, Y: 0.12},
			{Archetype: "gunner", Pattern: PatternGrid, Rows: 2, Cols: 7, Count: 14, Y: 0.28},
			{Archetype: "scout", Pattern: PatternStream, Count: 6, Delay: 14, Interval: 6, Side: "random"},
		},
		Hazards: []Hazard{
			{Archetype: "asteroid", Rate: 0.18, Max: 3, Delay: 8},
		},
		DropChance: 0.15, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerBomb, PowerMagnet},
	},
	{
		Number: 15, Name: "Broadside", Tagline: "Marauders cross the field raking as they go. Pick your lane.",
		Music: "siege", Backdrop: "steel", StarSpeed: 1.5,
		FormationStep: 0.44, FormationDrop: 21, GlobalFireMul: 1.1, Bunkers: 2,
		Waves: []Wave{
			{Archetype: "marauder", Pattern: PatternRandom, Count: 5, Y: 0.18},
			{Archetype: "bulwark", Pattern: PatternGrid, Rows: 1, Cols: 6, Count: 6, Y: 0.1},
			{Archetype: "gunner", Pattern: PatternGrid, Rows: 2, Cols: 7, Count: 14, Y: 0.32},
		},
		Hazards: []Hazard{
			{Archetype: "iceshard", Rate: 0.22, Max: 3, Delay: 7},
			{Archetype: "comet", Rate: 0.2, Max: 3, Delay: 14},
		},
		DropChance: 0.15, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb},
	},
	{
		Number: 16, Name: "The Leviathan", Tagline: "BOSS - a hull the size of a moonlet, and it is still hatching.",
		Music: "boss", Backdrop: "aurora", StarSpeed: 1.3,
		FormationStep: 0.46, FormationDrop: 17, GlobalFireMul: 1, Bunkers: 2,
		Boss: "leviathan",
		Waves: []Wave{
			{Archetype: "leviathan", Pattern: PatternBoss, Count: 1, Y: 0.23},
			{Archetype: "hive", Pattern: PatternArc, Count: 2, Y: 0.42},
			{Archetype: "shrike", Pattern: PatternStream, Count: 8, Delay: 16, Interval: 6, Side: "random"},
		},
		Hazards: []Hazard{
			{Archetype: "comet", Rate: 0.24, Max: 4, Delay: 10},
		},
		DropChance: 0.2, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerLife, PowerBomb, PowerPierce},
	},
	{
		Number: 17, Name: "Seraph Choir", Tagline: "Wide orbits and aimed lances. They shoot where you were going.",
		Music: "tension", Backdrop: "violet", StarSpeed: 1.55,
		FormationStep: 0.42, FormationDrop: 21, GlobalFireMul: 1.1, Bunkers: 2,
		Waves: []Wave{
			{Archetype: "seraph", Pattern: PatternRandom, Count: 6, Y: 0.2, Amp: 96},
			{Archetype: "weaver", Pattern: PatternGrid, Rows: 2, Cols: 7, Count: 14, Y: 0.12, Amp: 38},
			{Archetype: "phantom", Pattern: PatternArc, Count: 5, Y: 0.34, Delay: 5},
		},
		Hazards: []Hazard{
			{Archetype: "gravmine", Rate: 0.14, Max: 3, Delay: 10},
		},
		DropChance: 0.16, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet},
	},
	{
		Number: 18, Name: "Deadfall", Tagline: "Gravity mines. Give every one of them more room than feels necessary.",
		Music: "tension", Backdrop: "void", StarSpeed: 1.65,
		FormationStep: 0.42, FormationDrop: 21, GlobalFireMul: 1.15, Bunkers: 2,
		Waves: []Wave{
			{Archetype: "splitter", Pattern: PatternGrid, Rows: 2, Cols: 6, Count: 12, Y: 0.13},
			{Archetype: "lancer", Pattern: PatternStream, Count: 7, Delay: 6, Interval: 5.5, Side: "top"},
			{Archetype: "gunner", Pattern: PatternVee, Count: 7, Y: 0.3, Delay: 4},
		},
		Hazards: []Hazard{
			{Archetype: "gravmine", Rate: 0.26, Max: 4, Delay: 5},
			{Archetype: "iceshard", Rate: 0.2, Max: 3, Delay: 12},
		},
		DropChance: 0.16, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb},
	},
	{
		Number: 19, Name: "Revenant Watch", Tagline: "Kill one and two more fade in where it stood.",
		Music: "tension", Backdrop: "ice", StarSpeed: 1.6,
		FormationStep: 0.4, FormationDrop: 22, GlobalFireMul: 1.15, Bunkers: 2,
		Waves: []Wave{
			{Archetype: "revenant", Pattern: PatternGrid, Rows: 2, Cols: 6, Count: 12, Y: 0.14},
			{Archetype: "seraph", Pattern: PatternArc, Count: 4, Y: 0.3, Amp: 70, Delay: 6},
			{Archetype: "shrike", Pattern: PatternStream, Count: 6, Delay: 14, Interval: 5, Side: "random"},
		},
		Hazards: []Hazard{
			{Archetype: "comet", Rate: 0.3, Max: 4, Delay: 6},
		},
		DropChance: 0.17, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet},
	},
	{
		Number: 20, Name: "The Oracle", Tagline: "BOSS - it reads your line before you take it.",
		Music: "boss", Backdrop: "amber", StarSpeed: 1.4,
		FormationStep: 0.42, FormationDrop: 17, GlobalFireMul: 1.05, Bunkers: 2,
		Boss: "oracle",
		Waves: []Wave{
			{Archetype: "oracle", Pattern: PatternBoss, Count: 1, Y: 0.23},
			{Archetype: "seraph", Pattern: PatternArc, Count: 4, Y: 0.42},
			{Archetype: "revenant", Pattern: PatternStream, Count: 5, Delay: 18, Interval: 8, Side: "random"},
		},
		Hazards: []Hazard{
			{Archetype: "gravmine", Rate: 0.16, Max: 3, Delay: 12},
		},
		DropChance: 0.2, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerLife, PowerBomb, PowerPierce},
	},
	{
		Number: 21, Name: "Iron Tide", Tagline: "Armour in two ranks with a gun line behind it. Nothing here is quick.",
		Music: "siege", Backdrop: "steel", StarSpeed: 1.5,
		FormationStep: 0.4, FormationDrop: 22, GlobalFireMul: 1.2, Bunkers: 2,
		Waves: []Wave{
			{Archetype: "bulwark", Pattern: PatternGrid, Rows: 2, Cols: 6, Count: 12, Y: 0.11},
			{Archetype: "marauder", Pattern: PatternRandom, Count: 4, Y: 0.24},
			{Archetype: "gunner", Pattern: PatternGrid, Rows: 2, Cols: 8, Count: 16, Y: 0.34},
		},
		Hazards: []Hazard{
			{Archetype: "asteroid", Rate: 0.22, Max: 3, Delay: 6},
			{Archetype: "gravmine", Rate: 0.14, Max: 3, Delay: 16},
		},
		DropChance: 0.17, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet},
	},
	{
		Number: 22, Name: "Hatchery", Tagline: "Four hives, and everything they have made since you arrived.",
		Music: "swarm", Backdrop: "moss", StarSpeed: 1.75,
		FormationStep: 0.4, FormationDrop: 22, GlobalFireMul: 1.15, Bunkers: 1,
		Waves: []Wave{
			{Archetype: "hive", Pattern: PatternArc, Count: 4, Y: 0.12},
			{Archetype: "swarmer", Pattern: PatternStream, Count: 24, Delay: 3, Interval: 1.1, Side: "top"},
			{Archetype: "shrike", Pattern: PatternGrid, Rows: 1, Cols: 6, Count: 6, Y: 0.3, Delay: 8},
		},
		Hazards: []Hazard{
			{Archetype: "comet", Rate: 0.26, Max: 4, Delay: 10},
		},
		DropChance: 0.15, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet},
	},
	{
		Number: 23, Name: "Cold Choir", Tagline: "Phantoms, revenants and seraphs. Half of it cannot be shot at all.",
		Music: "tension", Backdrop: "ice", StarSpeed: 1.7,
		FormationStep: 0.38, FormationDrop: 23, GlobalFireMul: 1.2, Bunkers: 1,
		Waves: []Wave{
			{Archetype: "revenant", Pattern: PatternGrid, Rows: 2, Cols: 5, Count: 10, Y: 0.12},
			{Archetype: "phantom", Pattern: PatternGrid, Rows: 2, Cols: 7, Count: 14, Y: 0.28},
			{Archetype: "seraph", Pattern: PatternRandom, Count: 5, Y: 0.2, Amp: 88, Delay: 6},
		},
		Hazards: []Hazard{
			{Archetype: "iceshard", Rate: 0.3, Max: 4, Delay: 5},
			{Archetype: "gravmine", Rate: 0.16, Max: 3, Delay: 14},
		},
		DropChance: 0.18, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet},
	},
	{
		Number: 24, Name: "The Long Approach", Tagline: "Everything the fleet still has, in one corridor, all at once.",
		Music: "final", Backdrop: "singularity", StarSpeed: 1.95,
		FormationStep: 0.36, FormationDrop: 23, GlobalFireMul: 1.2, Bunkers: 2,
		Waves: []Wave{
			{Archetype: "bulwark", Pattern: PatternGrid, Rows: 1, Cols: 6, Count: 6, Y: 0.1},
			{Archetype: "revenant", Pattern: PatternArc, Count: 5, Y: 0.22},
			{Archetype: "hive", Pattern: PatternVee, Count: 3, Y: 0.34, Delay: 5},
			{Archetype: "lancer", Pattern: PatternStream, Count: 8, Delay: 10, Interval: 4.5, Side: "top"},
			{Archetype: "marauder", Pattern: PatternRandom, Count: 4, Y: 0.26, Delay: 18},
		},
		Hazards: []Hazard{
			{Archetype: "comet", Rate: 0.3, Max: 4, Delay: 6},
			{Archetype: "gravmine", Rate: 0.18, Max: 3, Delay: 14},
			{Archetype: "asteroid", Rate: 0.16, Max: 2, Delay: 20},
		},
		DropChance: 0.2, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet, PowerLife},
	},
	{
		Number: 25, Name: "The Sovereign", Tagline: "FINAL BOSS - whatever sent the other twenty-four.",
		Music: "final", Backdrop: "singularity", StarSpeed: 2.1,
		FormationStep: 0.36, FormationDrop: 18, GlobalFireMul: 1.15, Bunkers: 2,
		Boss: "sovereign",
		Waves: []Wave{
			{Archetype: "sovereign", Pattern: PatternBoss, Count: 1, Y: 0.24},
			{Archetype: "bulwark", Pattern: PatternArc, Count: 4, Y: 0.44},
			{Archetype: "revenant", Pattern: PatternStream, Count: 6, Delay: 14, Interval: 7, Side: "random"},
			{Archetype: "swarmer", Pattern: PatternStream, Count: 20, Delay: 20, Interval: 1.6, Side: "top"},
		},
		Hazards: []Hazard{
			{Archetype: "comet", Rate: 0.3, Max: 4, Delay: 8},
			{Archetype: "gravmine", Rate: 0.2, Max: 4, Delay: 16},
			{Archetype: "iceshard", Rate: 0.16, Max: 3, Delay: 24},
		},
		DropChance: 0.22, Powerups: []string{PowerRapid, PowerSpread, PowerShield, PowerPierce, PowerBomb, PowerMagnet, PowerLife},
	},
}

// Campaign is the payload served by GET /api/levels.
type Campaign struct {
	Version    int                  `json:"version"`
	LevelCount int                  `json:"levelCount"`
	Archetypes map[string]Archetype `json:"archetypes"`
	Levels     []Level              `json:"levels"`
	Powerups   []PowerupInfo        `json:"powerups"`
	Rules      Rules                `json:"rules"`

	// Vocabularies, so the level editor builds its menus from the server
	// rather than keeping a second copy that can drift out of step.
	MusicTracks []string `json:"musicTracks"`
	Backdrops   []string `json:"backdrops"`
	Patterns    []string `json:"patterns"`
	Sides       []string `json:"sides"`
	Limits      Limits   `json:"limits"`

	// Difficulty tiers, easiest first. The client applies these as
	// multipliers; the server uses the score multiplier to scale the
	// anti-forgery ceiling.
	Difficulties []Difficulty `json:"difficulties"`
}

// Limits mirrors the validation bounds so the editor can mark a field before
// the server has to reject it.
type Limits struct {
	MaxWaves         int `json:"maxWaves"`
	MaxHazardKinds   int `json:"maxHazardKinds"`
	MaxWaveCount     int `json:"maxWaveCount"`
	MaxLevelEntities int `json:"maxLevelEntities"`
	MaxNameRunes     int `json:"maxNameRunes"`
	MaxTaglineRunes  int `json:"maxTaglineRunes"`
}

// PowerupInfo describes a pickup for the client renderer and the codex.
type PowerupInfo struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Blurb    string  `json:"blurb"`
	Color    string  `json:"color"`
	Glyph    string  `json:"glyph"`
	Duration float64 `json:"duration"` // seconds, 0 = instant or permanent
}

// Rules holds the handful of global constants the client simulation needs.
type Rules struct {
	StartingLives    int     `json:"startingLives"`
	ExtraLifeEvery   int     `json:"extraLifeEvery"`
	BaseFireCooldown float64 `json:"baseFireCooldown"`
	BaseBulletCap    int     `json:"baseBulletCap"`
	PlayerSpeed      float64 `json:"playerSpeed"`
	BulletSpeed      float64 `json:"bulletSpeed"`
	ComboWindow      float64 `json:"comboWindow"`
	ComboMax         int     `json:"comboMax"`
	PerfectBonus     int     `json:"perfectBonus"`
	ClearBonusPerLvl int     `json:"clearBonusPerLevel"`
}

var powerupTable = []PowerupInfo{
	{ID: PowerRapid, Name: "Rapid Coils", Blurb: "Halves the cannon cooldown and lifts the bullet cap.", Color: "#ffd166", Glyph: "R", Duration: 18},
	{ID: PowerSpread, Name: "Spread Array", Blurb: "Three bolts per trigger pull, fanned outward.", Color: "#06d6a0", Glyph: "W", Duration: 18},
	{ID: PowerShield, Name: "Deflector", Blurb: "Absorbs the next hit that would kill you.", Color: "#4cc9f0", Glyph: "S", Duration: 0},
	{ID: PowerPierce, Name: "Lance Rounds", Blurb: "Bolts punch through the first target they kill.", Color: "#f72585", Glyph: "P", Duration: 16},
	{ID: PowerLife, Name: "Spare Hull", Blurb: "One extra life.", Color: "#ff8fab", Glyph: "+", Duration: 0},
	{ID: PowerBomb, Name: "Smart Bomb", Blurb: "Stored charge. Press B to clear every shot on screen and scorch the field.", Color: "#b5179e", Glyph: "B", Duration: 0},
	{ID: PowerMagnet, Name: "Salvage Magnet", Blurb: "Draws pickups and salvage toward your hull.", Color: "#a9def9", Glyph: "M", Duration: 20},
}

// DefaultRules are the balance constants shipped with the campaign.
var DefaultRules = Rules{
	StartingLives:    3,
	ExtraLifeEvery:   25000,
	BaseFireCooldown: 0.26,
	BaseBulletCap:    3,
	PlayerSpeed:      330,
	BulletSpeed:      560,
	ComboWindow:      1.6,
	ComboMax:         8,
	PerfectBonus:     3000,
	ClearBonusPerLvl: 750,
}

// BuildCampaign assembles the payload served to clients.
func BuildCampaign() Campaign {
	return Campaign{
		Version:    1,
		LevelCount: len(Levels),
		Archetypes: Archetypes,
		Levels:     Levels,
		Powerups:   powerupTable,
		Rules:      DefaultRules,

		MusicTracks:  MusicTracks,
		Backdrops:    Backdrops,
		Patterns:     Patterns,
		Sides:        Sides,
		Difficulties: Difficulties,
		Limits: Limits{
			MaxWaves:         MaxWaves,
			MaxHazardKinds:   MaxHazardKinds,
			MaxWaveCount:     MaxWaveCount,
			MaxLevelEntities: MaxLevelEntities,
			MaxNameRunes:     MaxNameRunes,
			MaxTaglineRunes:  MaxTaglineRunes,
		},
	}
}

// MaxLevel is the number of levels in the campaign.
func MaxLevel() int { return len(Levels) }

// LevelByNumber returns the level with the given 1-based number.
func LevelByNumber(n int) (Level, bool) {
	if n < 1 || n > len(Levels) {
		return Level{}, false
	}
	return Levels[n-1], true
}

// MaxScore is the ceiling for a full campaign on the most generously scored
// tier. It bounds presence figures, which carry no difficulty of their own.
func MaxScore() int {
	best := 1.0
	for _, d := range Difficulties {
		if d.ScoreMul > best {
			best = d.ScoreMul
		}
	}
	return int(float64(ScoreCeilingRange(1, len(Levels))) * best)
}

// ScoreCeilingFor is the ceiling for a run over levels from..to on a given
// difficulty. Scaling it with the tier's score multiplier is what keeps an
// insane run from being rejected and a super easy one from being waved
// through at normal's allowance.
func ScoreCeilingFor(from, to int, d Difficulty) int {
	mul := d.ScoreMul
	if mul <= 0 {
		mul = 1
	}
	return int(float64(ScoreCeilingRange(from, to)) * mul)
}

// ScoreCeiling returns the ceiling for a run that started on level 1.
func ScoreCeiling(level int) int { return ScoreCeilingRange(1, level) }

// ScoreCeilingRange returns a generous upper bound on the score a legitimate
// run could have reached by playing levels from..to inclusive. It is used by
// the score endpoint to reject obviously forged submissions; it is
// deliberately loose, because the simulation itself runs on the client.
func ScoreCeilingRange(from, to int) int {
	if from < 1 {
		from = 1
	}
	if to > len(Levels) {
		to = len(Levels)
	}
	if to < from {
		to = from
	}
	total := 0
	for i := from - 1; i < to; i++ {
		lv := Levels[i]
		levelMax := 0
		for _, w := range lv.Waves {
			a, ok := Archetypes[w.Archetype]
			if !ok {
				continue
			}
			n := w.Count
			if n == 0 {
				n = 1
			}
			// Splitters can yield their children too; be generous.
			mult := 1
			if a.SplitCount > 0 {
				mult = 1 + a.SplitCount
			}
			levelMax += a.Score * n * mult
		}
		for _, h := range lv.Hazards {
			a, ok := Archetypes[h.Archetype]
			if !ok {
				continue
			}
			// Assume the player farms hazards for four solid minutes.
			levelMax += int(float64(a.Score) * h.Rate * 240)
		}
		// Combo multiplier up to 8x, plus clear and perfect bonuses.
		levelMax = levelMax*DefaultRules.ComboMax + DefaultRules.PerfectBonus + DefaultRules.ClearBonusPerLvl*(i+1)
		total += levelMax
	}
	return total
}
