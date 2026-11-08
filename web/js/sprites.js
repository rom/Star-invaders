/**
 * Procedural pixel-art sprites.
 *
 * Every ship, rock and boss in the game is a small character grid rendered
 * into an offscreen canvas once and then blitted. '#' is a highlight, 'X' the
 * body colour, 'o' the accent colour and '.' is transparent. Keeping the art
 * as text means no image assets ship with the game and each archetype reads
 * as a distinct silhouette at a glance.
 */

export const PIXEL_SPRITES = {
  player: [[
    '.....X.....',
    '....XXX....',
    '....X#X....',
    '...XX#XX...',
    '..XXX#XXX..',
    '.XXXXXXXXX.',
    'XXXoXXXoXXX',
    'XX.o...o.XX',
    'X..o...o..X',
  ]],

  grunt: [[
    '..X.....X..',
    '...X...X...',
    '..XXXXXXX..',
    '.XX.XXX.XX.',
    'XXXXXXXXXXX',
    'X.XXXXXXX.X',
    'X.X.....X.X',
    '...XX.XX...',
  ], [
    '..X.....X..',
    'X..X...X..X',
    'X.XXXXXXX.X',
    'XXX.XXX.XXX',
    'XXXXXXXXXXX',
    '.XXXXXXXXX.',
    '..X.....X..',
    '.X.......X.',
  ]],

  gunner: [[
    '.o.......o.',
    '.o.XXXXX.o.',
    '.oXXoooXXo.',
    '.XXXXXXXXX.',
    'XX.XXXXX.XX',
    'X..XXXXX..X',
    '...X...X...',
    '..oo...oo..',
  ], [
    '.o.......o.',
    '.o.XXXXX.o.',
    '.oXXoooXXo.',
    '.XXXXXXXXX.',
    'XX.XXXXX.XX',
    'X..XXXXX..X',
    '..X.....X..',
    '.oo.....oo.',
  ]],

  scout: [[
    '.....X.....',
    '....XXX....',
    '...XXXXX...',
    '..XX.#.XX..',
    '.XXX.#.XXX.',
    'XX..XXX..XX',
    '....ooo....',
    '.....o.....',
  ], [
    '.....X.....',
    '....XXX....',
    '...XXXXX...',
    '..XX.#.XX..',
    '.XXX.#.XXX.',
    '.X..XXX..X.',
    '....ooo....',
    '....o.o....',
  ]],

  weaver: [[
    '..XX...XX..',
    '.XXXX.XXXX.',
    'XX.XXXXX.XX',
    'X.XXoooXX.X',
    'XXXXXXXXXXX',
    '.X.XXXXX.X.',
    '..XX...XX..',
    '.o..o.o..o.',
  ], [
    '.o..o.o..o.',
    '..XX...XX..',
    '.X.XXXXX.X.',
    'XXXXXXXXXXX',
    'X.XXoooXX.X',
    'XX.XXXXX.XX',
    '.XXXX.XXXX.',
    '..XX...XX..',
  ]],

  orbiter: [[
    '...XXXXX...',
    '..XX...XX..',
    '.XX.ooo.XX.',
    'XX.oo#oo.XX',
    'XX.ooooo.XX',
    '.XX.ooo.XX.',
    '..XX...XX..',
    '...XXXXX...',
  ], [
    '..XXXXXXX..',
    '.XX.....XX.',
    'XX..ooo..XX',
    'X..oo#oo..X',
    'X..ooooo..X',
    'XX..ooo..XX',
    '.XX.....XX.',
    '..XXXXXXX..',
  ]],

  phantom: [[
    '..XXXXXXX..',
    '.XXXXXXXXX.',
    'XX.ooooo.XX',
    'XXoo#o#ooXX',
    'XXXXXXXXXXX',
    '.X.X.X.X.X.',
    '..X...X...X',
    '.X..X...X..',
  ], [
    '..XXXXXXX..',
    '.XXXXXXXXX.',
    'XX.ooooo.XX',
    'XXoo#o#ooXX',
    'XXXXXXXXXXX',
    '.X.X.X.X.X.',
    'X...X...X..',
    '..X...X..X.',
  ]],

  splitter: [[
    '..XXX.XXX..',
    '.XXXXoXXXX.',
    'XXoXXoXXoXX',
    'XXo#XoX#oXX',
    'XXXXXoXXXXX',
    '.XXXXoXXXX.',
    '..XXX.XXX..',
    '...X...X...',
  ], [
    '..XXX.XXX..',
    '.XXXXoXXXX.',
    'XXoXXoXXoXX',
    'XXo#XoX#oXX',
    'XXXXXoXXXXX',
    '.XXXXoXXXX.',
    '..XX...XX..',
    '..X.....X..',
  ]],

  bulwark: [[
    '.#########.',
    '###########',
    '#X#XXXXX#X#',
    'XXXXXXXXXXX',
    'XX.XXXXX.XX',
    'X.ooooooo.X',
    'X.o.....o.X',
    '..XX...XX..',
  ], [
    '.#########.',
    '###########',
    '#X#XXXXX#X#',
    'XXXXXXXXXXX',
    'XX.XXXXX.XX',
    'X.ooooooo.X',
    'X.o.....o.X',
    '.XX.....XX.',
  ]],

  lancer: [[
    'X.........X',
    'XX.......XX',
    'XXX.ooo.XXX',
    '.XXXo#oXXX.',
    '..XXXoXXX..',
    '...XXoXX...',
    '....XoX....',
    '.....o.....',
  ]],

  swarmer: [[
    '..XXX..',
    '.XXXXX.',
    'XX.#.XX',
    'XXXXXXX',
    '.X...X.',
    'o.....o',
  ], [
    '..XXX..',
    '.XXXXX.',
    'XX.#.XX',
    'XXXXXXX',
    '.XX.XX.',
    '.o...o.',
  ]],

  asteroid: [[
    '...XXXX....',
    '..XXXXXXX..',
    '.XXXoXXXXX.',
    'XXXXXXXoXXX',
    'XXoXXXXXXXX',
    'XXXXXoXXXX.',
    '.XXXXXXXX..',
    '..XXXoXXX..',
    '...XXXX....',
  ]],

  comet: [[
    '...XXX...',
    '..XX#XX..',
    '.X#####X.',
    'X###X###X',
    '.X#####X.',
    '..XX#XX..',
    '...XXX...',
  ]],

  mine: [[
    '..o.o.o..',
    '.ooXXXoo.',
    'o.XX#XX.o',
    '..X###X..',
    'o.XX#XX.o',
    '.ooXXXoo.',
    '..o.o.o..',
  ]],

  derelict: [[
    '..XXX...XXX..',
    '.XXXXX.XXXXX.',
    'XXoXXXXXXXoXX',
    'XXXXX#X#XXXXX',
    '.XXXX###XXXX.',
    '..XX.XXX.XX..',
    '...X.....X...',
    '..o.......o..',
    '.o.........o.',
  ]],

  warden: [[
    '....XXXXXXX....',
    '..XXXXXXXXXXX..',
    '.XXXoooooooXXX.',
    'XXXoo#####ooXXX',
    'XXoo##XXX##ooXX',
    'XXoo#XX#XX#ooXX',
    'XXoo##XXX##ooXX',
    'XXXoo#####ooXXX',
    '.XXXoooooooXXX.',
    '..XX.XXXXX.XX..',
    '.oX...XXX...Xo.',
  ]],

  harbinger: [[
    '.X...........X.',
    '.XX.........XX.',
    '.XXX..ooo..XXX.',
    '.XXXXoooooXXXX.',
    'XXXXoo###ooXXXX',
    'XXXoo##X##ooXXX',
    'XXXXoo###ooXXXX',
    '.XXXXoooooXXXX.',
    '..XXX.ooo.XXX..',
    '...XX..o..XX...',
    '....X.....X....',
  ]],

  dreadnought: [[
    '..XX.........XX..',
    '.XXXX.......XXXX.',
    'XXXXXX.....XXXXXX',
    'XXoXXXX...XXXXoXX',
    'XXooXXXXXXXXXooXX',
    'XXooo#######oooXX',
    'XXoo###XXX###ooXX',
    'XXooo#######oooXX',
    'XXooXXXXXXXXXooXX',
    '.XXoXXX...XXXoXX.',
    '..XXXXX...XXXXX..',
    '...XXX.....XXX...',
    '....X.......X....',
  ]],

  shrike: [[
    '.....X.....',
    '....XXX....',
    '...XX#XX...',
    '..XXX#XXX..',
    '.XX.XXX.XX.',
    'XX..XXX..XX',
    'X...ooo...X',
    '.....o.....',
  ], [
    '.....X.....',
    '....XXX....',
    '...XX#XX...',
    '..XXX#XXX..',
    '.XX.XXX.XX.',
    '.X..XXX..X.',
    '....ooo....',
    '....o.o....',
  ]],

  seraph: [[
    '.X.......X.',
    '.XX.ooo.XX.',
    '.XXXoooXXX.',
    'XXXXo#oXXXX',
    'XXXXoooXXXX',
    '.XXXXXXXXX.',
    '..XX...XX..',
    '...X...X...',
  ], [
    '.X.......X.',
    '.XX.ooo.XX.',
    'XXXXoooXXXX',
    'XXXXo#oXXXX',
    '.XXXoooXXX.',
    '.XXXXXXXXX.',
    '..X.....X..',
    '.X.......X.',
  ]],

  hive: [[
    '...XXXXX...',
    '..XXoooXX..',
    '.XXoo#ooXX.',
    'XXoo###ooXX',
    'XXo#####oXX',
    'XXoo###ooXX',
    '.XXoo#ooXX.',
    '..XXoooXX..',
    '...XX.XX...',
  ], [
    '...XXXXX...',
    '..XXoooXX..',
    '.XXoo#ooXX.',
    'XXoo###ooXX',
    'XXo#####oXX',
    'XXoo###ooXX',
    '.XXoo#ooXX.',
    '..XXoooXX..',
    '...X.X.X...',
  ]],

  revenant: [[
    '..XXXXXXX..',
    '.XX#####XX.',
    'XX#o###o#XX',
    'XX#######XX',
    '.XXXXXXXXX.',
    '..X.X.X.X..',
    '.X.X...X.X.',
    'X...X.X...X',
  ], [
    '..XXXXXXX..',
    '.XX#####XX.',
    'XX#o###o#XX',
    'XX#######XX',
    '.XXXXXXXXX.',
    '..X.X.X.X..',
    'X.X...X.X.X',
    '.X..X.X..X.',
  ]],

  marauder: [[
    '..XXXXXXXXX..',
    '.XXXXXXXXXXX.',
    'XX#XXXXXXX#XX',
    'XXXXXoooXXXXX',
    'XXXXoo#ooXXXX',
    '.XXXXXoXXXXX.',
    '..XX.....XX..',
    '.o.o.....o.o.',
  ], [
    '..XXXXXXXXX..',
    '.XXXXXXXXXXX.',
    'XX#XXXXXXX#XX',
    'XXXXXoooXXXXX',
    'XXXXoo#ooXXXX',
    '.XXXXXoXXXXX.',
    '..X.......X..',
    '.o..o...o..o.',
  ]],

  iceshard: [[
    '....X....',
    '...X#X...',
    '..X###X..',
    '.X##X##X.',
    'X##XXX##X',
    '.X##X##X.',
    '..X###X..',
    '...X#X...',
    '....X....',
  ]],

  gravmine: [[
    '..o..o..o..',
    '.o.......o.',
    'o...XXX...o',
    '...XX#XX...',
    '..XX###XX..',
    '.oX##X##Xo.',
    '..XX###XX..',
    '...XX#XX...',
    'o...XXX...o',
    '.o.......o.',
    '..o..o..o..',
  ]],

  leviathan: [[
    '....XXXXXXXXX....',
    '..XXXXXXXXXXXXX..',
    '.XXXoooooooooXXX.',
    'XXXoo#######ooXXX',
    'XXoo##XXXXX##ooXX',
    'XXo##XX###XX##oXX',
    'XXo##XX###XX##oXX',
    'XXoo##XXXXX##ooXX',
    'XXXoo#######ooXXX',
    '.XXXoooooooooXXX.',
    '..XX.XXXXXXX.XX..',
    '.o....XXXXX....o.',
  ]],

  oracle: [[
    '.......X.......',
    '......XXX......',
    '.....XX#XX.....',
    '....XX###XX....',
    '...XXooooXXX...',
    '..XXoo###ooXX..',
    '.XXoo##X##ooXX.',
    '..XXoo###ooXX..',
    '...XXXooooXX...',
    '....XX###XX....',
    '.....XX#XX.....',
    '......XXX......',
    '.......X.......',
  ]],

  sovereign: [[
    '...X....XXX....X...',
    '...XX..XX#XX..XX...',
    '...XXX.X###X.XXX...',
    '..XXXXXX###XXXXXX..',
    '.XXXoooXX#XXoooXXX.',
    'XXXoo#########ooXXX',
    'XXoo###XXXXX###ooXX',
    'XXo##XX#####XX##oXX',
    'XXoo###XXXXX###ooXX',
    'XXXoo#########ooXXX',
    '.XXXoooXXXXXoooXXX.',
    '..XXXXX.....XXXXX..',
    '...XXX.......XXX...',
    '....X.........X....',
  ]],

  bunker: [[
    '..#######..',
    '.#########.',
    '###########',
    '###########',
    '###########',
    '####...####',
    '###.....###',
    '##.......##',
  ]],
};

/* --------------------------------------------------------------- utilities */

function clamp255(n) { return n < 0 ? 0 : n > 255 ? 255 : Math.round(n); }

function parseHex(hex) {
  const h = (hex || '#ffffff').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

/** Mixes a colour toward white by amount 0..1. */
export function lighten(hex, amount = 0.45) {
  const [r, g, b] = parseHex(hex);
  return `rgb(${clamp255(r + (255 - r) * amount)},${clamp255(g + (255 - g) * amount)},${clamp255(b + (255 - b) * amount)})`;
}

/** Mixes a colour toward black by amount 0..1. */
export function darken(hex, amount = 0.4) {
  const [r, g, b] = parseHex(hex);
  return `rgb(${clamp255(r * (1 - amount))},${clamp255(g * (1 - amount))},${clamp255(b * (1 - amount))})`;
}

export function rgba(hex, alpha) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* --------------------------------------------------------------- rendering */

const cache = new Map();
const MAX_CACHE = 400;

/**
 * Renders a sprite frame into an offscreen canvas and memoises it.
 * @param {string} name sprite key
 * @param {number} frame animation frame index
 * @param {number} width target width in device pixels
 * @param {string} color body colour
 * @param {string} accent accent colour
 */
export function spriteCanvas(name, frame, width, color, accent) {
  const frames = PIXEL_SPRITES[name] || PIXEL_SPRITES.grunt;
  const grid = frames[frame % frames.length];
  const cols = grid[0].length;
  const rows = grid.length;
  const px = Math.max(1, Math.round(width / cols));
  const key = `${name}|${frame % frames.length}|${px}|${color}|${accent}`;

  const hit = cache.get(key);
  if (hit) return hit;

  const cv = document.createElement('canvas');
  cv.width = cols * px;
  cv.height = rows * px;
  const c = cv.getContext('2d');
  const hi = lighten(color, 0.6);
  const sh = darken(color, 0.45);

  for (let y = 0; y < rows; y++) {
    const row = grid[y];
    for (let x = 0; x < cols; x++) {
      const ch = row[x];
      if (!ch || ch === '.') continue;
      c.fillStyle = ch === '#' ? hi : ch === 'o' ? (accent || sh) : color;
      c.fillRect(x * px, y * px, px, px);
    }
  }

  if (cache.size > MAX_CACHE) {
    // Simple eviction: drop the oldest insertions.
    const keys = cache.keys();
    for (let i = 0; i < 80; i++) {
      const k = keys.next();
      if (k.done) break;
      cache.delete(k.value);
    }
  }
  cache.set(key, cv);
  return cv;
}

/**
 * Draws a sprite centred on (x, y).
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawSprite(ctx, name, {
  x, y, width, frame = 0, color = '#ffffff', accent = null,
  alpha = 1, rotation = 0, glow = 0, flip = false, raster = 1,
}) {
  // The sprite is rasterised at device resolution (raster = devicePixelRatio
  // times the canvas scale) but drawn in logical units, so pixel art stays
  // crisp on high-DPI screens without the caller doing any maths.
  const cv = spriteCanvas(name, frame, Math.max(4, Math.round(width * raster)), color, accent);
  const w = width;
  const h = width * (cv.height / cv.width);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (rotation) ctx.rotate(rotation);
  if (flip) ctx.scale(1, -1);
  if (glow > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
  }
  ctx.drawImage(cv, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** Measures the on-screen height a sprite will occupy for a given width. */
export function spriteAspect(name) {
  const frames = PIXEL_SPRITES[name] || PIXEL_SPRITES.grunt;
  const grid = frames[0];
  return grid.length / grid[0].length;
}

/** Number of animation frames a sprite has. */
export function spriteFrames(name) {
  return (PIXEL_SPRITES[name] || PIXEL_SPRITES.grunt).length;
}

/* --------------------------------------------------------------- backdrops */

export const BACKDROPS = {
  deepblue: { top: '#040616', bottom: '#0a1030', glow: '#1b3a8a', nebula: '#2a4fb0' },
  rust: { top: '#140804', bottom: '#2a1208', glow: '#8a3a1b', nebula: '#b05a2a' },
  violet: { top: '#0b0418', bottom: '#1c0930', glow: '#6a1b8a', nebula: '#9d4edd' },
  teal: { top: '#02100f', bottom: '#06231f', glow: '#1b8a7a', nebula: '#2ab0a0' },
  amber: { top: '#140d02', bottom: '#2a1d06', glow: '#8a6a1b', nebula: '#ffb703' },
  moss: { top: '#05100a', bottom: '#0a2415', glow: '#2b8a4a', nebula: '#52b788' },
  ice: { top: '#030c16', bottom: '#082033', glow: '#1b6a8a', nebula: '#48cae4' },
  void: { top: '#030308', bottom: '#0a0a14', glow: '#3a3a6a', nebula: '#6a6aa0' },
  aurora: { top: '#040f14', bottom: '#0a2430', glow: '#1b8a6a', nebula: '#80ffdb' },
  ember: { top: '#160604', bottom: '#2e0f08', glow: '#a03020', nebula: '#ff6b35' },
  steel: { top: '#080a0e', bottom: '#151b24', glow: '#4a5a6a', nebula: '#8d99ae' },
  singularity: { top: '#0a0210', bottom: '#1a0424', glow: '#8a1b5a', nebula: '#f72585' },
};

export function backdropFor(key) {
  return BACKDROPS[key] || BACKDROPS.deepblue;
}
