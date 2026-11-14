const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = {background:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'background/fluid.js'),'utf8'),context);
function frame(coverColor, theme = 'dark', { time = 8000, width = 384, colors } = {}) {
  const fills = [], glows = [];
  const ctx = {
    fillRect() { fills.push(this.fillStyle); },
    save() {},
    restore() {},
    translate(x, y) { glows.push({ x, y }); },
    scale() {},
    createRadialGradient(x0, y0, r0, x1, y1, radius) {
      const glow = glows.at(-1);
      glow.radius = radius;
      return {
        addColorStop(position, color) {
          const parts = /^hsla\(([\d.]+), ([\d.]+)%, ([\d.]+)%, ([\d.]+)\)$/.exec(color);
          assert.ok(parts, color);
          const [hue, saturation, lightness, alpha] = parts.slice(1).map(Number);
          if (position === 0) Object.assign(glow, { hue, saturation, lightness, alpha });
          else assert.equal(alpha, 0);
        }
      };
    }
  };
  context.background.render(ctx, { width, height: 854, theme, coverColor, colors }, time);
  return { background: fills[0], glows };
}

const dark = frame('#403020');
const light = frame('#403020', 'light');
const [main, second, third] = dark.glows;
assert.equal(main.hue, 30);
assert.equal(second.hue, 60);
assert.equal(third.hue, 0);
assert.ok(main.radius > second.radius && second.radius > third.radius);
assert.ok(second.lightness === main.lightness && third.lightness === main.lightness);
assert.ok(second.saturation === main.saturation && third.saturation === main.saturation);
assert.ok(main.lightness > 57 && light.glows[0].lightness > 70);
assert.notEqual(dark.background, light.background);
assert.notEqual(main.x, frame('#403020', 'dark', { time: 18000 }).glows[0].x);
assert.deepEqual(dark, frame('#403020'));
assert.equal(frame('#111111', 'dark', { width: 0 }).glows.length, 0);

assert.equal(frame('#400000').glows[2].hue, 330);
assert.equal(frame('#400008').glows[1].hue, 22.5);
assert.notEqual(frame('#403020').glows[0].hue, frame('#403220').glows[0].hue);
assert.ok(frame('#805020').glows[0].lightness > main.lightness);
assert.equal(frame('#777777').glows[0].saturation, 0);
assert.ok(frame('#777879').glows[0].saturation < 5);
assert.equal(frame(undefined).glows[0].saturation, 0);
assert.deepEqual(frame('#401020', 'dark', { colors: { coverBase: '#403020' } }), dark);

console.log('Canvas plugin: cover-derived colors, hue offsets, neutral fallback and motion checks passed.');
