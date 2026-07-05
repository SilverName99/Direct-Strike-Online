// Vector "puppet" characters: units composed of primitive shapes (design
// sheet "Varianta A1"), drawn in code on the canvas. Local coordinates:
// character centered at (0,0), facing +X, ~26 world units tall. The caller
// mirrors with scale(-1,1) for the right-side team.
//
// Each animation has exactly 2 frames (hard-switched, retro style):
// idle, walk, attack (windup/strike), die (falling/fallen).
// A pose = { partId: [dx, dy, rotationDeg], ..., root: [dx, dy, rotDeg] }.
// Rotations pivot on each part's base point (hip for legs, shoulder for arm).

// Palette slots from the design sheet; team 1 is the hue-swapped red set.
export const PALETTES = [
  { primary: '#4a7bd6', dark: '#2d3a4f', mid: '#3b5faf', metal: '#c8c8c8', grip: '#6b5b6b' },
  { primary: '#d65a66', dark: '#4f2d35', mid: '#af3b4f', metal: '#c8c8c8', grip: '#6b5b6b' },
];

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function circle(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function hexagon(ctx, x, y, r, fill, stroke) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

export const PUPPETS = {
  grunt: {
    // Parts in draw order (back → front). base = attach/pivot point.
    parts: [
      {
        id: 'shield',
        base: { x: 5.2, y: -0.5 },
        draw(ctx, P) {
          hexagon(ctx, 0, 0, 5, P.mid, P.dark);
        },
      },
      {
        id: 'backLeg',
        base: { x: -1.8, y: 4 },
        draw(ctx, P) {
          rect(ctx, -1.4, 0, 2.8, 7.5, P.mid);
        },
      },
      {
        id: 'body',
        base: { x: 0, y: -1.5 },
        draw(ctx, P) {
          rect(ctx, -4.5, -5, 9, 8, P.dark);
          rect(ctx, -4.5, 3, 9, 2.5, P.mid); // belt
        },
      },
      {
        id: 'frontLeg',
        base: { x: 1.8, y: 4 },
        draw(ctx, P) {
          rect(ctx, -1.4, 0, 2.8, 7.5, P.primary);
        },
      },
      {
        id: 'head',
        base: { x: 0.8, y: -9.5 },
        draw(ctx, P) {
          circle(ctx, 0, 0, 4.8, P.primary);
          rect(ctx, -4, -6.2, 8, 1.9, P.dark); // headband cap
        },
      },
      {
        id: 'arm', // sword arm; the sword hangs from the hand, so rotating
        base: { x: 1.5, y: -3.5 }, // the shoulder swings the whole weapon
        draw(ctx, P) {
          rect(ctx, -1.2, 0, 2.4, 6, P.primary); // upper arm hanging down
          rect(ctx, -2.4, 5.2, 4.8, 1.5, P.grip); // crossguard
          rect(ctx, -0.9, 6.4, 1.8, 10, P.metal); // blade (points down at rest)
          ctx.beginPath(); // blade tip
          ctx.moveTo(-0.9, 16.4);
          ctx.lineTo(0, 18.4);
          ctx.lineTo(0.9, 16.4);
          ctx.closePath();
          ctx.fillStyle = P.metal;
          ctx.fill();
        },
      },
    ],

    // frames: [frameA, frameB]; omitted parts stay at their base pose.
    anims: {
      idle: [
        {},
        { head: [0, 0.8, 0], body: [0, 0.5, 0], arm: [0, 0.5, 3], shield: [0, 0.6, 0] },
      ],
      walk: [
        { backLeg: [0, 0, 24], frontLeg: [0, 0, -22], arm: [0, 0, 12], body: [0, -0.4, 0], head: [0, -0.4, 0] },
        { backLeg: [0, 0, -22], frontLeg: [0, 0, 24], arm: [0, 0, -10], body: [0, 0.4, 0], head: [0, 0.4, 0] },
      ],
      attack: [
        // windup: sword raised behind the head, shield tucked in
        { arm: [-0.5, -0.5, -155], body: [0, 0, -4], head: [-0.6, 0, 0], shield: [-1, 0, 0] },
        // strike: blade thrust forward past the shield
        { arm: [1.5, -1, -75], body: [0.8, 0, 6], head: [0.6, 0, 0], shield: [0.5, 0.5, 0], backLeg: [0, 0, 14], frontLeg: [0, 0, -14] },
      ],
      die: [
        // falling backwards
        { root: [-2, 2, -35], arm: [0, 0, -60], shield: [1, 2, 30], backLeg: [0, 0, 10], frontLeg: [0, 0, -12] },
        // flat on the ground
        { root: [-6, 9, -85], arm: [0, 0, -100], shield: [2, 4, 60], backLeg: [0, 0, 18], frontLeg: [0, 0, -20] },
      ],
    },
  },
};

const DEG = Math.PI / 180;

export function drawPuppet(ctx, type, anim, frame, palette, scale = 1) {
  const def = PUPPETS[type];
  const pose = def.anims[anim][frame] || {};
  ctx.save();
  ctx.scale(scale, scale);
  const root = pose.root;
  if (root) {
    ctx.translate(root[0], root[1]);
    ctx.rotate(root[2] * DEG);
  }
  for (const part of def.parts) {
    const p = pose[part.id] || null;
    ctx.save();
    ctx.translate(part.base.x + (p ? p[0] : 0), part.base.y + (p ? p[1] : 0));
    if (p && p[2]) ctx.rotate(p[2] * DEG);
    part.draw(ctx, palette);
    ctx.restore();
  }
  ctx.restore();
}
