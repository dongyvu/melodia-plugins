// Background API v1. All visual choices and animation are owned by this plugin.
(() => {
  function rgb(hex) {return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
  function css(rgb,a=1) {return `rgba(${rgb.map(Math.round).join(',')},${a})`;}
  background.render=(ctx,s,time)=>{
    const w=s.width,h=s.height;if(w<=0||h<=0)return;
    const dark=s.theme==='dark';
    const t=(time+8000)/1000*0.65;
    ctx.fillStyle=dark?'#1d1e20':'#F7FAFD';ctx.fillRect(0,0,w,h);
    const sway=Math.sin(t*.16),breathe=Math.sin(t*.11+1.2);
    const fallback=dark?['#7B99BF','#6888B0','#AAC4E1']:['#A8C5E7','#C1D8EE','#D7E7F5'];
    const colors=['glow1','glow2','glow3'].map((name,i)=>rgb(s.colors?.[name]||fallback[i]));
    function glow(color,x,y,radius,stretch,alpha){
      const r=Math.min(w,h)*radius;
      ctx.save();ctx.translate(w*x,h*y);ctx.scale(1,stretch);
      const g=ctx.createRadialGradient(0,0,0,0,0,r);
      g.addColorStop(0,css(color,alpha*.8));g.addColorStop(1,css(color,0));
      ctx.fillStyle=g;ctx.fillRect(-r,-r,2*r,2*r);ctx.restore();
    }
    glow(colors[0],.18+sway*.13,1.05+breathe*.04,.95+breathe*.08,.85,dark?.58:.78);
    glow(colors[1],.92-sway*.17,1.02-breathe*.04,.85,.84,dark?.46:.68);
    glow(colors[2],.58+Math.sin(t*.09)*.25,.86,.68,.74,dark?.17:.32);
  };
})();
