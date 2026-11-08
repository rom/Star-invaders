// Package game holds the authoritative content definitions for Star Invaders:
// the enemy archetypes, the hazard ("unknown space object") table and the
// twelve level scripts. The browser client never hard-codes this data; it
// fetches it from GET /api/levels so that balance changes only ever happen
// here, server side.
package game

// Kind classifies an archetype. The distinction matters for level
// completion: only Required archetypes gate progression, drifting space
// junk does not.
const (
	KindAlien  = "alien"
	KindObject = "object"
	KindBoss   = "boss"
)

// Behavior names a movement routine implemented by the client simulator.
//
//	march  - holds a slot in a marching formation (classic invader step)
//	dive   - holds formation, then peels off and dives at the player
//	weave  - formation slot plus a lateral sine wobble
//	orbit  - circles a moving anchor point
//	phase  - formation slot, cloaks in and out of targetability
//	charge - enters from the top edge and accelerates straight down
//	swarm  - flocks loosely toward the player in fast shoals
//	drift  - inert object on a straight heading
//	float  - near-stationary object with slow bobbing drift
//	boss   - scripted multi-phase pattern runner
const (
	BehaviorMarch  = "march"
	BehaviorDive   = "dive"
	BehaviorWeave  = "weave"
	BehaviorOrbit  = "orbit"
	BehaviorPhase  = "phase"
	BehaviorCharge = "charge"
	BehaviorSwarm  = "swarm"
	BehaviorDrift  = "drift"
	BehaviorFloat  = "float"
	BehaviorBoss   = "boss"
	BehaviorStrafe = "strafe" // crosses the field at a fixed height, reversing
)

// Archetype is a single kind of attacker or space object.
type Archetype struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Kind     string  `json:"kind"`
	Codex    string  `json:"codex"` // one-line flavour shown in the in-game codex
	HP       int     `json:"hp"`
	Score    int     `json:"score"`
	Radius   float64 `json:"radius"`
	Behavior string  `json:"behavior"`
	Speed    float64 `json:"speed"`  // px/s, meaning depends on behavior
	Sprite   string  `json:"sprite"` // renderer key
	Color    string  `json:"color"`
	Accent   string  `json:"accent"`

	// Gunnery.
	FireRate        float64 `json:"fireRate"`        // average shots per second
	ProjectileKind  string  `json:"projectileKind"`  // bolt | plasma | spread | laser | orb
	ProjectileSpeed float64 `json:"projectileSpeed"` // px/s

	// Optional traits.
	Required   bool     `json:"required"`             // must die before the level ends
	FrontArmor bool     `json:"frontArmor,omitempty"` // head-on hits do half damage
	SplitInto  string   `json:"splitInto,omitempty"`  // spawns these on death
	SplitCount int      `json:"splitCount,omitempty"`
	HatchInto  string   `json:"hatchInto,omitempty"`  // spawns these while alive
	HatchEvery float64  `json:"hatchEvery,omitempty"` // seconds between hatches
	Blast      float64  `json:"blast,omitempty"`      // death explosion radius that can hurt the player
	Patterns   []string `json:"patterns,omitempty"`   // boss phase attack scripts
	PhaseHP    []int    `json:"phaseHP,omitempty"`    // HP thresholds that advance boss phases
}

// Archetypes is the complete bestiary, keyed by ID.
var Archetypes = map[string]Archetype{
	// ---------------------------------------------------------------- aliens
	"grunt": {
		ID: "grunt", Name: "Krill Grunt", Kind: KindAlien,
		Codex:    "Mass-grown infantry. Harmless alone, lethal in a wall.",
		HP:       1,
		Score:    100,
		Radius:   15,
		Behavior: BehaviorMarch,
		Speed:    0,
		Sprite:   "grunt", Color: "#7cf3a0", Accent: "#1b5e3a",
		FireRate: 0.16, ProjectileKind: "bolt", ProjectileSpeed: 210,
		Required: true,
	},
	"gunner": {
		ID: "gunner", Name: "Volt Gunner", Kind: KindAlien,
		Codex:    "Carries a twin plasma rig. Fires three times as often as a grunt.",
		HP:       2,
		Score:    180,
		Radius:   17,
		Behavior: BehaviorMarch,
		Sprite:   "gunner", Color: "#ffd166", Accent: "#7a4b00",
		FireRate: 0.42, ProjectileKind: "plasma", ProjectileSpeed: 250,
		Required: true,
	},
	"scout": {
		ID: "scout", Name: "Needle Scout", Kind: KindAlien,
		Codex:    "Breaks formation to dive the player, then loops back around.",
		HP:       1,
		Score:    150,
		Radius:   13,
		Behavior: BehaviorDive,
		Speed:    190,
		Sprite:   "scout", Color: "#8ecae6", Accent: "#023047",
		FireRate: 0.3, ProjectileKind: "bolt", ProjectileSpeed: 265,
		Required: true,
	},
	"weaver": {
		ID: "weaver", Name: "Sine Weaver", Kind: KindAlien,
		Codex:    "Rides a lateral sine wave. Lead your shots.",
		HP:       2,
		Score:    220,
		Radius:   16,
		Behavior: BehaviorWeave,
		Speed:    78,
		Sprite:   "weaver", Color: "#c77dff", Accent: "#3c096c",
		FireRate: 0.34, ProjectileKind: "bolt", ProjectileSpeed: 240,
		Required: true,
	},
	"orbiter": {
		ID: "orbiter", Name: "Halo Orbiter", Kind: KindAlien,
		Codex:    "Circles a drifting anchor and strafes on the downswing.",
		HP:       2,
		Score:    260,
		Radius:   15,
		Behavior: BehaviorOrbit,
		Speed:    100,
		Sprite:   "orbiter", Color: "#ff8fab", Accent: "#6a0136",
		FireRate: 0.3, ProjectileKind: "plasma", ProjectileSpeed: 235,
		Required: true,
	},
	"phantom": {
		ID: "phantom", Name: "Phase Phantom", Kind: KindAlien,
		Codex:    "Cloaks on a two second cycle. Untargetable while faded.",
		HP:       2,
		Score:    300,
		Radius:   16,
		Behavior: BehaviorPhase,
		Speed:    64,
		Sprite:   "phantom", Color: "#9bf6ff", Accent: "#0b525b",
		FireRate: 0.38, ProjectileKind: "laser", ProjectileSpeed: 330,
		Required: true,
	},
	"splitter": {
		ID: "splitter", Name: "Mitosis Cell", Kind: KindAlien,
		Codex:    "Tough sac that bursts into two live scouts when killed.",
		HP:       3,
		Score:    280,
		Radius:   19,
		Behavior: BehaviorMarch,
		Sprite:   "splitter", Color: "#b5e48c", Accent: "#2d6a4f",
		FireRate: 0.2, ProjectileKind: "bolt", ProjectileSpeed: 215,
		Required: true, SplitInto: "scout", SplitCount: 2,
	},
	"bulwark": {
		ID: "bulwark", Name: "Iron Bulwark", Kind: KindAlien,
		Codex:    "Frontal plating halves head-on damage. Flank it or out-gun it.",
		HP:       7,
		Score:    450,
		Radius:   22,
		Behavior: BehaviorMarch,
		Sprite:   "bulwark", Color: "#ced4da", Accent: "#343a40",
		FireRate: 0.4, ProjectileKind: "spread", ProjectileSpeed: 205,
		Required: true, FrontArmor: true,
	},
	"lancer": {
		ID: "lancer", Name: "Void Lancer", Kind: KindAlien,
		Codex:    "Suicide ram. Drops in from the void and accelerates downward.",
		HP:       3,
		Score:    320,
		Radius:   17,
		Behavior: BehaviorCharge,
		Speed:    250,
		Sprite:   "lancer", Color: "#ff6b6b", Accent: "#6a040f",
		FireRate: 0.08, ProjectileKind: "bolt", ProjectileSpeed: 300,
		Required: true, Blast: 40,
	},
	"swarmer": {
		ID: "swarmer", Name: "Swarmlet", Kind: KindAlien,
		Codex:    "One hit kills it. There are never only a few.",
		HP:       1,
		Score:    60,
		Radius:   10,
		Behavior: BehaviorSwarm,
		Speed:    165,
		Sprite:   "swarmer", Color: "#ffea00", Accent: "#7f5500",
		FireRate: 0.05, ProjectileKind: "bolt", ProjectileSpeed: 260,
		Required: true,
	},

	"shrike": {
		ID: "shrike", Name: "Shrike", Kind: KindAlien,
		Codex:    "A scout that learned to commit. Dives harder and twice as often.",
		HP:       2,
		Score:    240,
		Radius:   14,
		Behavior: BehaviorDive,
		Speed:    250,
		Sprite:   "shrike", Color: "#ff9e00", Accent: "#6a2c00",
		FireRate: 0.34, ProjectileKind: "bolt", ProjectileSpeed: 290,
		Required: true,
	},
	"seraph": {
		ID: "seraph", Name: "Seraph", Kind: KindAlien,
		Codex:    "Wide, slow orbit and a lance that goes where you were going.",
		HP:       3,
		Score:    380,
		Radius:   18,
		Behavior: BehaviorOrbit,
		Speed:    120,
		Sprite:   "seraph", Color: "#e0aaff", Accent: "#3c096c",
		FireRate: 0.36, ProjectileKind: "laser", ProjectileSpeed: 325,
		Required: true,
	},
	"hive": {
		ID: "hive", Name: "Brood Hive", Kind: KindAlien,
		Codex:    "Hatches swarmlets for as long as it is allowed to live.",
		HP:       8,
		Score:    620,
		Radius:   23,
		Behavior: BehaviorMarch,
		Sprite:   "hive", Color: "#9ef01a", Accent: "#2b4a0a",
		FireRate: 0.18, ProjectileKind: "bolt", ProjectileSpeed: 210,
		Required: true, HatchInto: "swarmer", HatchEvery: 4.5,
	},
	"revenant": {
		ID: "revenant", Name: "Revenant", Kind: KindAlien,
		Codex:    "Cloaks like a phantom, and leaves two more behind when it dies.",
		HP:       4,
		Score:    520,
		Radius:   18,
		Behavior: BehaviorPhase,
		Speed:    70,
		Sprite:   "revenant", Color: "#48cae4", Accent: "#023e8a",
		FireRate: 0.4, ProjectileKind: "laser", ProjectileSpeed: 330,
		Required: true, SplitInto: "phantom", SplitCount: 2,
	},
	"marauder": {
		ID: "marauder", Name: "Marauder", Kind: KindAlien,
		Codex:    "Crosses the field broadside, raking as it goes.",
		HP:       5,
		Score:    420,
		Radius:   20,
		Behavior: BehaviorStrafe,
		Speed:    150,
		Sprite:   "marauder", Color: "#f4a261", Accent: "#6a3010",
		FireRate: 0.5, ProjectileKind: "spread", ProjectileSpeed: 225,
		Required: true,
	},

	// ------------------------------------------- unknown space objects
	"asteroid": {
		ID: "asteroid", Name: "Asteroid", Kind: KindObject,
		Codex:    "Unidentified rock. Does not shoot, does not stop.",
		HP:       4,
		Score:    75,
		Radius:   23,
		Behavior: BehaviorDrift,
		Speed:    62,
		Sprite:   "asteroid", Color: "#b08968", Accent: "#4a3728",
	},
	"comet": {
		ID: "comet", Name: "Ion Comet", Kind: KindObject,
		Codex:    "Fast, bright and entirely indifferent to your hull.",
		HP:       2,
		Score:    120,
		Radius:   15,
		Behavior: BehaviorDrift,
		Speed:    215,
		Sprite:   "comet", Color: "#80ffdb", Accent: "#168aad",
	},
	"mine": {
		ID: "mine", Name: "Drift Mine", Kind: KindObject,
		Codex:    "Dormant ordnance of unknown make. Detonates on contact or death.",
		HP:       1,
		Score:    90,
		Radius:   13,
		Behavior: BehaviorFloat,
		Speed:    34,
		Sprite:   "mine", Color: "#ff5d8f", Accent: "#590d22",
		Blast: 58,
	},
	"iceshard": {
		ID: "iceshard", Name: "Ice Shard", Kind: KindObject,
		Codex:    "Shatters into smaller shards. Still just ice, still fatal.",
		HP:       3,
		Score:    110,
		Radius:   19,
		Behavior: BehaviorDrift,
		Speed:    130,
		Sprite:   "iceshard", Color: "#caf0f8", Accent: "#0077b6",
		SplitInto: "comet", SplitCount: 2,
	},
	"gravmine": {
		ID: "gravmine", Name: "Gravity Mine", Kind: KindObject,
		Codex:    "A drift mine with a much larger opinion about personal space.",
		HP:       3,
		Score:    200,
		Radius:   17,
		Behavior: BehaviorFloat,
		Speed:    28,
		Sprite:   "gravmine", Color: "#c77dff", Accent: "#3c096c",
		Blast: 104,
	},
	"derelict": {
		ID: "derelict", Name: "Derelict Hulk", Kind: KindObject,
		Codex:    "A dead ship from no known fleet. Worth a lot of salvage.",
		HP:       12,
		Score:    600,
		Radius:   36,
		Behavior: BehaviorDrift,
		Speed:    38,
		Sprite:   "derelict", Color: "#8d99ae", Accent: "#2b2d42",
	},

	// ---------------------------------------------------------------- bosses
	"warden": {
		ID: "warden", Name: "The Warden", Kind: KindBoss,
		Codex:    "Orbital gaol-keeper. Fans, sweeps, and calls for help.",
		HP:       62,
		Score:    6000,
		Radius:   62,
		Behavior: BehaviorBoss,
		Speed:    68,
		Sprite:   "warden", Color: "#ffb703", Accent: "#9d0208",
		FireRate: 0.8, ProjectileKind: "plasma", ProjectileSpeed: 245,
		Required: true,
		Patterns: []string{"fan", "sweep", "summon"},
		PhaseHP:  []int{42, 22},
	},
	"harbinger": {
		ID: "harbinger", Name: "The Harbinger", Kind: KindBoss,
		Codex:    "Phases between planes and rains aimed lances when solid.",
		HP:       96,
		Score:    11000,
		Radius:   70,
		Behavior: BehaviorBoss,
		Speed:    86,
		Sprite:   "harbinger", Color: "#9bf6ff", Accent: "#3a0ca3",
		FireRate: 1, ProjectileKind: "laser", ProjectileSpeed: 320,
		Required: true,
		Patterns: []string{"spiral", "lance", "blink", "summon"},
		PhaseHP:  []int{68, 40, 17},
	},
	"leviathan": {
		ID: "leviathan", Name: "The Leviathan", Kind: KindBoss,
		Codex:    "Hull the size of a moonlet. Sweeps, beams, and keeps hatching.",
		HP:       190,
		Score:    15000,
		Radius:   78,
		Behavior: BehaviorBoss,
		Speed:    62,
		Sprite:   "leviathan", Color: "#52b788", Accent: "#081c15",
		FireRate: 1.05, ProjectileKind: "plasma", ProjectileSpeed: 250,
		Required: true,
		Patterns: []string{"sweep", "beam", "summon", "spiral"},
		PhaseHP:  []int{140, 92, 42},
	},
	"oracle": {
		ID: "oracle", Name: "The Oracle", Kind: KindBoss,
		Codex:    "Reads your line before you take it. Blinks, lances, repeats.",
		HP:       250,
		Score:    19000,
		Radius:   72,
		Behavior: BehaviorBoss,
		Speed:    96,
		Sprite:   "oracle", Color: "#ffd60a", Accent: "#4a3000",
		FireRate: 1.25, ProjectileKind: "laser", ProjectileSpeed: 340,
		Required: true,
		Patterns: []string{"spiral", "blink", "lance", "beam", "rage"},
		PhaseHP:  []int{190, 135, 80, 35},
	},
	"dreadnought": {
		ID: "dreadnought", Name: "Void Dreadnought", Kind: KindBoss,
		Codex:    "The thing the other twelve levels were a warning about.",
		HP:       148,
		Score:    25000,
		Radius:   92,
		Behavior: BehaviorBoss,
		Speed:    74,
		Sprite:   "dreadnought", Color: "#f72585", Accent: "#10002b",
		FireRate: 1.15, ProjectileKind: "orb", ProjectileSpeed: 230,
		Required: true,
		Patterns: []string{"fan", "spiral", "beam", "summon", "rage"},
		PhaseHP:  []int{116, 82, 50, 22},
	},
	"sovereign": {
		ID: "sovereign", Name: "The Sovereign", Kind: KindBoss,
		Codex:    "Whatever sent the other twenty-four. It does not improvise.",
		HP:       380,
		Score:    40000,
		Radius:   98,
		Behavior: BehaviorBoss,
		Speed:    80,
		Sprite:   "sovereign", Color: "#ff4d6d", Accent: "#1a001a",
		FireRate: 1.5, ProjectileKind: "orb", ProjectileSpeed: 240,
		Required: true,
		Patterns: []string{"fan", "lance", "beam", "spiral", "summon", "rage"},
		PhaseHP:  []int{320, 250, 180, 110, 50},
	},
}
