// BLACKHOLE Jarvis canvas renderer. Scene data comes from the runtime coordinator.
export function startJarvisOrb(scene,getTarget,getPulseAt) {
  const canvas=document.getElementById('orb');
  const fallback=startJarvis2DOrb(scene,getTarget,getPulseAt);
  canvas.dataset.renderer='2d';
  void import('./jarvis-webgl.mjs').then(({createWebGLOrb})=>{
    const webgl=createWebGLOrb(canvas,scene,getTarget,getPulseAt,()=>{
      canvas.parentElement.dataset.orbRenderer='2d';
      canvas.dataset.renderer='2d';
      fallback.resume();
    });
    if(!webgl)return;
    fallback.pause();
    canvas.parentElement.dataset.orbRenderer='webgl';
    canvas.dataset.renderer='webgl';
  }).catch(()=>{
    canvas.dataset.renderer='2d';
    fallback.resume();
  });
}

function startJarvis2DOrb(scene,getTarget,getPulseAt) {
  const $=id=>document.getElementById(id);
  const tokens=getComputedStyle(document.documentElement);
  const color=name=>tokens.getPropertyValue(`--j-${name}`).trim();
  const palette=Object.fromEntries(['bg','focus','offline','bg-rgb','field-rgb','muted-rgb','ink-rgb','focus-rgb','warn-rgb','core-line-rgb','star-rgb','satellite-rgb','core-light-rgb','core-shadow-rgb','core-night-rgb'].map(name=>[name.replaceAll('-',''),color(name)]));
  const cv = $('orb'), ctx = cv.getContext('2d', {alpha:false});
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const hex = h => ({r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)});
  let c = hex(palette.focus), viewW = 0, viewH = 0, pixelRatio = 1, lastFrame = 0, pointerX = 0, pointerY = 0, active = true;
  function resizeScene() {
    const rect = cv.getBoundingClientRect();
    viewW = Math.max(1,rect.width); viewH = Math.max(1,rect.height);
    pixelRatio = Math.min(devicePixelRatio || 1,2);
    cv.width = Math.round(viewW * pixelRatio); cv.height = Math.round(viewH * pixelRatio);
  }
  window.addEventListener('resize', resizeScene, {passive:true});
  window.addEventListener('pointermove', event => {
    if (motion.matches) return;
    pointerX = event.clientX / Math.max(1,viewW) - .5;
    pointerY = event.clientY / Math.max(1,viewH) - .5;
  }, {passive:true});
  resizeScene();
  const TAU = Math.PI * 2;
  function ring(x,y,r,color,width=1,start=0,end=TAU,dash=[]) {
    ctx.beginPath(); ctx.lineWidth=width; ctx.strokeStyle=color; ctx.setLineDash(dash); ctx.arc(x,y,r,start,end); ctx.stroke(); ctx.setLineDash([]);
  }
  function draw(t) {
    if(!active)return;
    requestAnimationFrame(draw);
    if (document.hidden || t-lastFrame<33) return;
    lastFrame=t;
    const W=viewW,H=viewH,still=motion.matches,px=still?0:pointerX,py=still?0:pointerY;
    const x=W*.5+px*12,y=H*.35+py*10;
    const base=Math.min(W*(W<640?.24:.15),H*.22,175);
    const online=scene.online;
    const breath=still||!online?1:1+Math.sin(t*TAU/1400)*.04;
    const pulseAt=getPulseAt();
    const pulseElapsed=t-pulseAt;
    const pulse=online&&!still&&pulseAt>0&&pulseElapsed>=0&&pulseElapsed<450?.08*(1-pulseElapsed/450):0;
    const R=base*(breath+pulse);
    const chosen=hex(online?getTarget():palette.offline);
    for(const channel of ['r','g','b']) c[channel]=still||!online?chosen[channel]:c[channel]+(chosen[channel]-c[channel])*.035;
    const cs=`${c.r|0},${c.g|0},${c.b|0}`;
    ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
    ctx.fillStyle=palette.bg; ctx.fillRect(0,0,W,H);
    const field=ctx.createRadialGradient(x,y,R*.1,x,y,Math.max(W,H)*.68);
    field.addColorStop(0,`rgba(${cs},.14)`);field.addColorStop(.28,`rgba(${palette.fieldrgb},.57)`);field.addColorStop(1,`rgba(${palette.bgrgb},0)`);
    ctx.fillStyle=field;ctx.fillRect(0,0,W,H);
    for(let i=1;i<=8;i++) ring(x,y,R*(1.9+i*.52),`rgba(${palette.mutedrgb},.027)`,1);
    for(let i=0;i<32;i++) {
      const a=i*TAU/32;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*R*1.75,y+Math.sin(a)*R*1.75);
      ctx.lineTo(x+Math.cos(a)*Math.max(W,H),y+Math.sin(a)*Math.max(W,H));
      ctx.strokeStyle=`rgba(${palette.mutedrgb},.018)`;ctx.lineWidth=1;ctx.stroke();
    }
    for(let i=0;i<86;i++) {
      const u=((i*37.37)%101)/101,v=((i*71.13)%103)/103;
      const dx=(u-.5)*W,dy=(v-.5)*H,near=1-Math.min(1,Math.hypot(dx,dy)/Math.max(W,H));
      ctx.fillStyle=`rgba(${palette.starrgb},${.035+near*.09})`;
      ctx.beginPath();ctx.arc(u*W+px*(i%3+1)*4,v*H+py*(i%4+1)*4,.35+near*.65,0,TAU);ctx.fill();
    }
    const halo=ctx.createRadialGradient(x,y,R*.28,x,y,R*1.9);
    const haloScale=scene.core.activity==='waiting_owner'?.5:1;
    halo.addColorStop(0,`rgba(${cs},${.19*haloScale})`);halo.addColorStop(.55,`rgba(${cs},${.09*haloScale})`);halo.addColorStop(1,`rgba(${cs},0)`);
    ctx.fillStyle=halo;ctx.beginPath();ctx.arc(x,y,R*1.9,0,TAU);ctx.fill();
    ring(x,y,R*1.06,`rgba(${cs},.3)`,1.2);
    ring(x,y,R*1.23,`rgba(${palette.corelinergb},.22)`,1);
    ring(x,y,R*1.39,`rgba(${palette.corelinergb},.1)`,1);
    ring(x,y,R*1.68,`rgba(${palette.corelinergb},.11)`,1);
    for(let i=0;i<56;i++) {
      const a=i*TAU/56,outer=R*(i%7===0?1.77:1.73),inner=R*1.69;
      ctx.beginPath();ctx.moveTo(x+Math.cos(a)*inner,y+Math.sin(a)*inner);
      ctx.lineTo(x+Math.cos(a)*outer,y+Math.sin(a)*outer);
      ctx.strokeStyle=`rgba(${palette.corelinergb},.16)`;ctx.lineWidth=1;ctx.stroke();
    }
    if(scene.core.pendingApprovalCount>0) ring(x,y,R*1.82,`rgba(${palette.warnrgb},.8)`,2,0,TAU,[4,8]);
    const count=Math.max(0,Math.floor(scene.core.activeShadowCount||0));
    for(let i=0;i<count;i++) {
      const a=(still||scene.core.activity==='waiting_owner'?0:t/(scene.core.activity==='executing'?1800:3900))+i*TAU/count;
      const sx=x+Math.cos(a)*R*2.01,sy=y+Math.sin(a)*R*2.01;
      ctx.fillStyle=`rgba(${palette.satellitergb},.8)`;ctx.beginPath();ctx.arc(sx,sy,Math.max(2,R*.025),0,TAU);ctx.fill();
    }
    if(scene.core.activity==='planning'){
      const a=still?0:t/1900;
      ring(x,y,R*.87,`rgba(${palette.inkrgb},.52)`,2,a,a+1.1);
    }
    if(['executing','verifying'].includes(scene.core.activity)){
      const a=still?0:t/300;
      ring(x,y,R*1.06,`rgba(${palette.inkrgb},.52)`,2,a,a+1.2);
      if(scene.core.activity==='verifying')ring(x,y,R*1.23,`rgba(${palette.focusrgb},.63)`,2,-a,-a+1.2);
    }
    const core=ctx.createRadialGradient(x-R*.28,y-R*.32,R*.02,x,y,R);
    core.addColorStop(0,`rgba(${palette.corelightrgb},.96)`);core.addColorStop(.18,`rgba(${cs},.93)`);
    core.addColorStop(.53,`rgba(${cs},.38)`);core.addColorStop(.87,`rgba(${palette.coreshadowrgb},.88)`);core.addColorStop(1,`rgba(${palette.corenightrgb},.98)`);
    ctx.fillStyle=core;ctx.beginPath();ctx.arc(x,y,R,0,TAU);ctx.fill();
    ring(x,y,R*.81,`rgba(${palette.inkrgb},.14)`,1);
    ring(x,y,R*.64,`rgba(${cs},.19)`,1);
    const elapsed=t-pulseAt;
    if(online&&!still&&pulseAt>0&&elapsed>=0&&elapsed<450) {
      const k=elapsed/450;
      ring(x,y,R*(1.05+k*1.3),`rgba(${cs},${(1-k)*.56})`,2.2*(1-k));
    }
  }
  requestAnimationFrame(draw);
  return {
    pause(){active=false;},
    resume(){if(active)return;active=true;lastFrame=0;requestAnimationFrame(draw);},
  };
}
