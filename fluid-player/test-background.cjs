const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = {background:{}};
const presets=JSON.parse(fs.readFileSync(path.join(__dirname,'colors/palettes.json'),'utf8'));
function select(hex) {
 const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
 const hi=Math.max(r,g,b),lo=Math.min(r,g,b),delta=hi-lo;
 if(!delta || delta/hi < presets.minSaturation) return presets.neutral;
 let hue=(hi===r?(g-b)/delta:hi===g?(b-r)/delta+2:(r-g)/delta+4)*60;
 hue=(hue+360)%360;
 return presets.stops.findLast(p=>hue>=p.hue)||presets.stops.at(-1);
}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'background/fluid.js'),'utf8'),context);
function frame(coverColor,theme='dark',time=8000,width=384) {
  const paints=[],positions=[];
  const ctx={fillStyle:null,fillRect(){paints.push(String(this.fillStyle));},save(){},restore(){},translate(x,y){positions.push([x,y]);},scale(){},
    createRadialGradient(){return {addColorStop(n,c){paints.push(c);},toString(){return 'gradient';}};}};
  context.background.render(ctx,{width,height:854,theme,coverColor,colors:select(coverColor)[theme]},time);
  return {paints,positions};
}
assert.notDeepEqual(frame('#aa3311').paints,frame('#1155aa').paints);
assert.notDeepEqual(frame('#aa3311').positions,frame('#aa3311','dark',18000).positions);
assert.deepEqual(frame('#aa3311'),frame('#aa3311'));
assert.notEqual(frame('#aa3311').paints[0],frame('#aa3311','light').paints[0]);
assert.equal(frame('#111111','dark',0,0).paints.length,0);

assert.equal(select('#777D87').name,'neutral');
assert.deepEqual(frame('#777777').paints,frame('#FFFFFF').paints);
assert.deepEqual(frame('#AA3311').paints,frame('#FF5B29').paints);
for(const preset of [presets.neutral,...presets.stops]) {
 for(const theme of ['light','dark']) {
  for(const color of Object.values(preset[theme])) assert.match(color,/^#[0-9A-F]{6}$/);
 }
 const luminance=hex=>{
  const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);
  return c[0]*.2126+c[1]*.7152+c[2]*.0722;
 };
 assert.ok((luminance('#F7FAFD')+.05)/(luminance(preset.light.sung)+.05)>=4.5,preset.name+' light contrast');
 assert.ok((luminance(preset.dark.sung)+.05)/(luminance('#1D1E20')+.05)>=4.5,preset.name+' dark contrast');
}
console.log('Canvas plugin: presets, neutral fallback, contrast, motion, theme and empty-size checks passed.');
