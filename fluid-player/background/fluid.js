// Background API v1. All visual choices and animation are owned by this plugin.
(() => {
  function brightenCover(hex, dark) {
    const color = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#404040';
    const [red, green, blue] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    const chroma = high - low;
    let hue = 0;
    if (chroma > 0) {
      if (high === red) hue = (green - blue) / chroma;
      else if (high === green) hue = 2 + (blue - red) / chroma;
      else hue = 4 + (red - green) / chroma;
    }

    // Fade toward gray as cover chroma drops, so nearly gray covers stay muted.
    const saturation = (dark ? 69 : 84) * Math.min(chroma / 0.20, 1);
    const lightness = (dark ? 57 : 70) + 16 * (high + low) / 2;
    return { hue: hue * 60, saturation, lightness };
  }

  background.render=(ctx,s,time)=>{
    const w=s.width,h=s.height;if(w<=0||h<=0)return;
    const dark=s.theme==='dark';
    const t=(time+8000)/1000*0.65;
    ctx.fillStyle=dark?'#1d1e20':'#F7FAFD';ctx.fillRect(0,0,w,h);
    const sway=Math.sin(t*.16),breathe=Math.sin(t*.11+1.2);
    const { hue, saturation, lightness } = brightenCover(s.colors?.coverBase ?? s.coverColor, dark);
    function glow(hueOffset,x,y,radius,stretch,alpha){
      const r=Math.min(w,h)*radius;
      ctx.save();ctx.translate(w*x,h*y);ctx.scale(1,stretch);
      const g=ctx.createRadialGradient(0,0,0,0,0,r);
      const shiftedHue = (hue + hueOffset + 360) % 360;
      g.addColorStop(0, `hsla(${shiftedHue}, ${saturation}%, ${lightness}%, ${alpha * .8})`);
      g.addColorStop(1, `hsla(${shiftedHue}, ${saturation}%, ${lightness}%, 0)`);
      ctx.fillStyle=g;ctx.fillRect(-r,-r,2*r,2*r);ctx.restore();
    }
    glow(0,.18+sway*.13,1.05+breathe*.04,.95+breathe*.08,.85,dark?.58:.78);
    glow(30,.92-sway*.17,1.02-breathe*.04,.85,.84,dark?.46:.68);
    glow(-30,.58+Math.sin(t*.09)*.25,.86,.68,.74,dark?.17:.32);
  };
})();
