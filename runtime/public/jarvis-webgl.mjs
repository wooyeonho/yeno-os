import * as THREE from './vendor/three/three.module.js';

// Presentation only: all state and color decisions come from the existing core scene.
export function createWebGLOrb(canvas, scene, getTarget, getPulseAt, onLost) {
  const host = canvas.parentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const tokens = getComputedStyle(document.documentElement);
  const focus = tokens.getPropertyValue('--j-focus').trim();
  const offline = tokens.getPropertyValue('--j-offline').trim();
  const warning = new THREE.Color(tokens.getPropertyValue('--j-warn').trim());
  const surface = document.createElement('canvas');
  const context = surface.getContext('webgl2',{alpha:true,antialias:true,powerPreference:'low-power'});
  if(!context)return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({canvas:surface,context,alpha:true,antialias:true,powerPreference:'low-power'});
  } catch {
    return null;
  }
  renderer.domElement.id = 'orb-webgl';
  renderer.domElement.setAttribute('aria-hidden','true');
  renderer.setClearColor(0x000000,0);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1,1.5));
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(44,1,.1,40);
  camera.position.z = 7;
  const instrument = new THREE.Group();
  instrument.position.y = .84;
  world.add(instrument);
  const tint = new THREE.Color(focus);
  const uniforms = {
    uTint:{value:tint},
    uNight:{value:new THREE.Color(tokens.getPropertyValue('--j-core-night').trim())},
    uLight:{value:new THREE.Color(tokens.getPropertyValue('--j-core-light').trim())},
    uIntensity:{value:1},
  };
  const vertexShader = `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vec4 eye = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-eye.xyz);
      gl_Position = projectionMatrix * eye;
    }
  `;
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(.94,40,28),
    new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader:`
      uniform vec3 uTint;
      uniform vec3 uNight;
      uniform vec3 uLight;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float face = max(dot(normalize(vNormal), normalize(vView)), 0.0);
        float rim = pow(1.0 - face, 2.8);
        float center = pow(face, 2.2);
        float glint = pow(max(dot(normalize(vNormal),normalize(vec3(-.42,.48,1.0))),0.0),32.0);
        vec3 light = mix(uNight, uTint, center * .73 + rim * .42);
        light += uLight * .2 * pow(face, 8.0) * uIntensity;
        light += uLight * .4 * glint * uIntensity;
        gl_FragColor = vec4(light, 1.0);
      }
    `}),
  );
  instrument.add(core);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.09,40,28),
    new THREE.ShaderMaterial({uniforms,vertexShader,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fragmentShader:`
      uniform vec3 uTint;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)),0.0), 4.0);
        gl_FragColor = vec4(uTint * .8, rim * .28 * uIntensity);
      }
    `}),
  );
  instrument.add(halo);
  const rings = [1.30,1.54,1.78].map((radius,index)=>{
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius,index===1?.008:.013,6,72),
      new THREE.MeshBasicMaterial({color:focus,transparent:true,opacity:index===1?.39:.56,side:THREE.DoubleSide,depthWrite:false}),
    );
    ring.rotation.set([.32,.69,1.03][index],[.1,-.35,.58][index],index*.4);
    instrument.add(ring);
    return ring;
  });
  const satelliteGeometry=new THREE.SphereGeometry(.027,8,6);
  const satelliteMaterial=new THREE.MeshBasicMaterial({color:tokens.getPropertyValue('--j-satellite').trim()});
  const satellites=Array.from({length:12},()=>{
    const dot=new THREE.Mesh(satelliteGeometry,satelliteMaterial);
    dot.visible=false;
    instrument.add(dot);
    return dot;
  });
  let width=0,height=0,lastFrame=0,stopped=false,renderedFrames=0;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
    if(w===width&&h===height)return;
    width=w;height=h;
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
    instrument.scale.setScalar(Math.min(1,Math.max(.6,(w-72)/520)));
    renderer.setSize(w,h,false);
  }
  function frame(now) {
    if(stopped||document.hidden||now-lastFrame<(motion.matches?180:16))return;
    lastFrame=now;
    resize();
    const still=motion.matches;
    const active=scene.online;
    const target=new THREE.Color(active?getTarget():offline);
    if(still)tint.copy(target);
    else tint.lerp(target,.055);
    const activity=scene.core.activity;
    const pulseAt=getPulseAt();
    const pulseAge=now-pulseAt;
    const pulse=active&&!still&&pulseAt>0&&pulseAge>=0&&pulseAge<450?.075*(1-pulseAge/450):0;
    const breath=active&&!still?1+Math.sin(now*Math.PI*2/1400)*.035:1;
    const waiting=activity==='waiting_owner';
    const pending=Number(scene.core.pendingApprovalCount)>0;
    renderer.domElement.dataset.pendingRing=String(waiting||pending);
    uniforms.uIntensity.value=active?(waiting?.65:1.1):.35;
    const scale=breath+pulse;
    core.scale.setScalar(scale);
    halo.scale.setScalar(scale);
    for(let i=0;i<rings.length;i++) {
      const ring=rings[i];
      ring.material.color.copy((waiting||pending)&&i===2?warning:tint);
      ring.material.opacity=waiting?(i===1?.7:.38):active?(i===1?.43:.6):.2;
      if(!still&&active&&!waiting) {
        const speed=activity==='executing'||activity==='verifying'?.008:activity==='planning'?.004:.0017;
        ring.rotation.z += speed*[.65,-1,1.35][i];
        ring.rotation.y += speed*.4*(i===2?-1:1);
      }
    }
    const shadowCount=active?Math.min(satellites.length,Math.max(0,Math.floor(Number(scene.core.activeShadowCount)||0))):0;
    renderer.domElement.dataset.visibleSatellites=String(shadowCount);
    for(let i=0;i<satellites.length;i++) {
      const dot=satellites[i];
      dot.visible=i<shadowCount;
      if(!dot.visible)continue;
      const angle=(still||waiting?0:now/3500)+i*Math.PI*2/shadowCount;
      dot.position.set(Math.cos(angle)*2.03,Math.sin(angle)*1.88,.1);
    }
    renderer.render(world,camera);
    renderer.domElement.dataset.renderedFrames=String(++renderedFrames);
  }
  function stop() {
    if(stopped)return;
    stopped=true;
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize',resize);
    for(const mesh of [core,halo,...rings]){mesh.geometry.dispose();mesh.material.dispose();}
    satelliteGeometry.dispose();satelliteMaterial.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();stop();onLost();},{once:true});
  host.insertBefore(renderer.domElement,canvas.nextSibling);
  window.addEventListener('resize',resize,{passive:true});
  resize();
  renderer.render(world,camera);
  renderer.setAnimationLoop(frame);
  return {stop};
}
