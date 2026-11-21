import * as T from 'three';
import { Kind } from '../protocol';
import type { PacketEvent } from '../transport';

export type VisualState = { listening:boolean; transferring:boolean; failed:boolean; reduced:boolean };
export interface RelayScene { update(state:VisualState, packets:PacketEvent[]):void; dispose():void }

function haloTexture() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d')!;
  const g=ctx.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'#fff4dc');g.addColorStop(.12,'#ffbd80');g.addColorStop(.34,'#ff5a1f99');g.addColorStop(1,'#ff5a1f00');
  ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;return texture;
}

export function createRelay(host:HTMLDivElement, initial:VisualState, progress:(n:number)=>void, fail:()=>void):RelayScene {
  const mobile=matchMedia('(max-width:720px)').matches;
  const renderer=new T.WebGLRenderer({alpha:true,antialias:!mobile,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.25:1.75));
  renderer.setClearColor(0,0);host.appendChild(renderer.domElement);
  const scene=new T.Scene(), camera=new T.OrthographicCamera(-5,5,3,-3,.1,100);
  camera.position.z=12;
  const world=new T.Group();scene.add(world);
  const moonMat=new T.MeshStandardMaterial({color:0xffffff,roughness:1,bumpScale:.011});
  const sphere=new T.SphereGeometry(1,mobile?48:80,mobile?32:48);
  const moon=new T.Mesh(sphere,moonMat);moon.scale.setScalar(3.15);moon.rotation.y=.8;world.add(moon);
  // A full moon is lit from almost the same direction as the viewer.
  const sun = new T.DirectionalLight(0xfffaf3, 2.65);
  sun.position.set(-.7, .6, 8);
  scene.add(sun, new T.AmbientLight(0xe7ebf4, .48));
  const halo=haloTexture();
  const glow=new T.Sprite(new T.SpriteMaterial({map:halo,transparent:true,opacity:.22,blending:T.AdditiveBlending,depthWrite:false}));
  glow.scale.set(4,2.6,1);world.add(glow);
  const earthMat = new T.MeshStandardMaterial({roughness: .94});
  const earth = new T.Mesh(sphere, earthMat);
  earth.scale.setScalar(mobile ? .135 : .21);
  earth.rotation.set(.15, -1.36, -.21);
  world.add(earth);
  const atmosphere = new T.Mesh(sphere, new T.ShaderMaterial({
    vertexShader: 'varying vec3 n; void main(){n=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 n; void main() {
      float rim = pow(1.0 - abs(normalize(n).z), 4.0);
      gl_FragColor = vec4(.27,.59,1.,rim*.68);
    }`,
    transparent: true, blending: T.AdditiveBlending, depthWrite: false,
  }));
  atmosphere.scale.setScalar(1.035);
  earth.add(atmosphere);
  const count=mobile?1800:3800;
  const starPos=new Float32Array(count*3),starColor=new Float32Array(count*3);
  let seed=41; const rand=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);
  for(let i=0;i<count;i++){
    const phi=rand()*Math.PI*2, z=rand()*2-1, r=Math.sqrt(1-z*z)*30;
    starPos.set([Math.cos(phi)*r,Math.sin(phi)*r,z*30-30],i*3);
    const t=.25+.7*rand();starColor.set([t,t*(i%19?.98:.86),t*(i%19?1:.65)],i*3);
  }
  const starGeo=new T.BufferGeometry();starGeo.setAttribute('position',new T.BufferAttribute(starPos,3));starGeo.setAttribute('color',new T.BufferAttribute(starColor,3));
  const stars=new T.Points(starGeo,new T.PointsMaterial({vertexColors:true,size:1.4,sizeAttenuation:false}));scene.add(stars);
  const orange=0xff5a1f, normal=new T.Vector3(-.24,.94,.24).normalize();
  const mast=new T.Group();mast.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),normal);world.add(mast);
  const metal = new T.MeshStandardMaterial({color: 0xc3ccd4, metalness: .28, roughness: .53});
  const footing = new T.Mesh(new T.CylinderGeometry(.16,.19,.085,12), metal);
  footing.position.y = .043;
  const pedestal = new T.Mesh(new T.CylinderGeometry(.055,.09,.32,12), metal);
  pedestal.position.y = .2;
  mast.add(footing, pedestal);

  const dish = new T.Group();
  mast.add(dish);
  const reflector = new T.Mesh(new T.LatheGeometry(Array.from({length: 11}, (_, i) => {
    const radius = i * .033;
    return new T.Vector2(radius, radius * radius * .94);
  }), 36), new T.MeshStandardMaterial({color: 0xe4e9ed, roughness: .48, side: T.DoubleSide}));
  dish.add(reflector);
  const lip = new T.Mesh(new T.TorusGeometry(.33,.013,8,36), metal);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = .103;
  dish.add(lip);
  const tipMat = new T.MeshBasicMaterial({color: orange});
  const tip = new T.Mesh(sphere,tipMat);
  tip.scale.setScalar(.045);
  tip.position.y = .265;
  dish.add(tip);
  const up = new T.Vector3(0,1,0);
  const dishTarget = new T.Vector3();
  const dishCenter = new T.Vector3();
  const earthRadius = mobile ? .135 : .21;
  const base=new T.Vector3(),end=new T.Vector3();
  const beamGeo=new T.BufferGeometry().setFromPoints([base,end]);
  const beamMat=new T.LineBasicMaterial({color:orange,transparent:true,opacity:.14});
  world.add(new T.Line(beamGeo,beamMat));
  // A fixed pool bounds both geometry allocations and visible packet effects.
  const pulses=Array.from({length:8},()=>{
    const dot=new T.Mesh(sphere,new T.MeshBasicMaterial());dot.scale.setScalar(.034);dot.visible=false;world.add(dot);
    const rings = [0, 1].map(() => {
      const ring = new T.Mesh(new T.RingGeometry(.86,1,40), new T.MeshBasicMaterial({
        transparent: true, depthWrite: false, depthTest: false,
        side: T.DoubleSide, blending: T.AdditiveBlending,
      }));
      ring.visible = false;
      world.add(ring);
      return ring;
    });
    return {dot,rings,at:-Infinity,incoming:false,final:false};
  });
  let state=initial, alive=true, visible=true, loaded=false, timer=0, slot=0, warnUntil=0,failUntil=0, rotation=0, last=performance.now();
  const mouse={x:0,y:0};
  const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
  const software=ext && /swiftshader|llvmpipe|software/i.test(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)));
  // A software renderer can move its cached frame on the compositor without
  // taking CPU time to shade the crater textures again on every animation frame.
  const drift = software ? renderer.domElement.animate([
    { transform: 'scale(1.02) translate(0%, 0%)' },
    { transform: 'scale(1.10) translate(-1.8%, -1.1%)' },
  ], { duration: 6500, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' }) : undefined;
  function syncDrift() {
    if (!drift) return;
    if (state.reduced) drift.cancel();
    else if (document.hidden || !visible || state.transferring) drift.pause();
    else drift.play();
  }
  syncDrift();
  let settle = 0;
  const staticFrame=()=>state.reduced || software;
  const hero = document.querySelector<HTMLElement>('.relay-hero');
  const consolePreview = document.querySelector<HTMLElement>('.relay-console-preview');
  let viewport: HTMLElement = host;
  function layout(){
    const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;
    const span=3*w/h;
    camera.left=-span;camera.right=span;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
    const compact = viewport === consolePreview;
    const radius = compact ? .96 : mobile ? Math.min(span * .58, 1.12) : Math.min(span * .34, 1.73);
    const heroHeight = hero?.offsetHeight ?? h;
    const diskBottom = Math.min(h, heroHeight) - 66;
    const moonY = compact ? -.52 : mobile ? 3 - (diskBottom / h) * 6 + radius : -.12;
    moon.scale.setScalar(radius);
    moon.position.set(span * (compact ? -.38 : mobile ? .23 : .49), moonY, 0);
    earth.position.set(span * (compact ? .4 : .76), moonY + radius * (compact ? 1.8 : 1.34), -2);
    earth.scale.setScalar(compact ? .5 : earthRadius);
    mast.position.copy(moon.position).addScaledVector(normal,radius);
    mast.scale.setScalar(compact ? .78 : Math.min(.53, radius * .40));
    dishCenter.copy(mast.position).addScaledVector(normal, .37 * mast.scale.y);
    dish.position.set(0,.37,0);
    dishTarget.copy(earth.position).sub(dishCenter).normalize();
    dish.quaternion.setFromUnitVectors(up, dishTarget).premultiply(mast.quaternion.clone().invert());
    base.copy(dishCenter).addScaledVector(dishTarget, .265 * mast.scale.y);
    end.copy(earth.position).addScaledVector(dishTarget, -earth.scale.x * .84);
    const p=beamGeo.getAttribute('position');p.setXYZ(0,base.x,base.y,base.z);p.setXYZ(1,end.x,end.y,end.z);p.needsUpdate=true;beamGeo.computeBoundingSphere();
    schedule(true);
  }
  function draw(){
    timer=0;if(!alive||!loaded||document.hidden||!visible)return;
    const now=performance.now(),still=staticFrame(),dt=Math.min((now-last)/1000,.1);last=now;
    if(!still) rotation+=dt;
    moon.rotation.y=-1.46+Math.sin(rotation*.38)*.085;stars.rotation.z=rotation*.003;
    const scroll=Math.min(1,window.scrollY/Math.max(innerHeight,1));
    camera.zoom=viewport === consolePreview ? 1 : 1+scroll*.11;camera.updateProjectionMatrix();
    world.position.set(still?0:mouse.x*.24+.075*Math.sin(rotation*.45),still?0:mouse.y*.14+.035*Math.sin(rotation*.32),0);
    glow.position.set(moon.position.x+moon.scale.x*.75,moon.position.y+moon.scale.x*(state.transferring?.56:.45),-1);
    tipMat.color.setHex(now<failUntil?0xff4d5e:now<warnUntil?0xffd23d:orange);
    tipMat.color.multiplyScalar(state.listening||state.transferring?1:.52);
    earth.rotation.y = -1.36 + rotation * .062;
    beamMat.opacity = now < warnUntil ? .09 : state.transferring ? .65 : state.listening ? .4 : .22;
    for(const p of pulses){
      const t = (now - p.at) / 1150;
      const show = t >= 0 && t < 1;
      p.dot.visible = show;
      if (show) p.dot.position.lerpVectors(p.incoming ? end : base, p.incoming ? base : end, state.reduced ? .5 : t);
      p.rings.forEach((ring, index) => {
        const phase = state.reduced ? .35 : (t - index * .55) / .46;
        ring.visible = show && phase >= 0 && phase < 1;
        if (!ring.visible) return;
        ring.position.copy((index === 0) === p.incoming ? end : base);
        ring.scale.setScalar(.04 + phase * (p.final ? .54 : .34));
        ring.material.opacity = 1 - phase;
      });
      if (show && p.final) tipMat.color.setHex(0xffffff);
    }
    renderer.render(scene,camera);
    if (!still || (!state.reduced && pulses.some(p => now - p.at < 1150))) schedule(false);
  }
  function schedule(immediate:boolean){
    if(!alive||!loaded||!visible||document.hidden)return;
    if(timer && !immediate)return;
    clearTimeout(timer);timer=window.setTimeout(draw,immediate?0:1000 / (software ? 15 : state.transferring ? 24 : 30));
  }
  const move=(e:PointerEvent)=>{if(!mobile && !staticFrame()){mouse.x=e.clientX/innerWidth-.5;mouse.y=e.clientY/innerHeight-.5;}};
  const visibility=()=>{clearTimeout(timer);timer=0;syncDrift();if(!document.hidden)schedule(true);};
  const scroll=()=>{if(!staticFrame())schedule(false);};
  const lost=(e:Event)=>{e.preventDefault();fail();};
  const regions = new Set<Element>();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) regions.add(entry.target);
      else regions.delete(entry.target);
    }
    const target = hero && regions.has(hero) ? host : consolePreview ?? host;
    if (target !== viewport) {
      viewport = target;
      target.appendChild(renderer.domElement);
      layout();
    }
    visible = target === host ? !!hero && regions.has(hero) : regions.has(target);
    visibility();
  });
  const resize = new ResizeObserver(layout);
  resize.observe(host);
  if (hero) { observer.observe(hero); resize.observe(hero); }
  if (consolePreview) { observer.observe(consolePreview); resize.observe(consolePreview); }
  window.addEventListener('pointermove',move,{passive:true});window.addEventListener('scroll',scroll,{passive:true});
  document.addEventListener('visibilitychange',visibility);renderer.domElement.addEventListener('webglcontextlost',lost);
  const loader=new T.TextureLoader();let finished=0;const textures:T.Texture[]=[halo];
  for(const type of ['surface','relief','earth']){
    const filename = type === 'earth' ? 'earth.webp' : type+'-'+(mobile?512:1024)+'.webp';
    const tex=loader.load('./lunar/'+filename,()=>{
      if(!alive)return;
      finished++;progress(finished===1?65:90);
      if(finished===3){loaded=true;layout();progress(100);}
    },undefined,()=>{if(alive)fail();});
    if(type==='surface'){tex.colorSpace=T.SRGBColorSpace;moonMat.map=tex;}else if(type==='relief') moonMat.bumpMap=tex;
    else { tex.colorSpace=T.SRGBColorSpace; earthMat.map=tex; }
    textures.push(tex);
  }
  return {
    update(next,events){
      if(next.failed&&!state.failed) failUntil=performance.now()+650;
      state=next;
      syncDrift();
      for(const e of events){
        if(e.direction==='timeout'||(e.attempt??1)>1)warnUntil=performance.now()+650;
        if(e.direction==='timeout'||![Kind.DATA,Kind.CONTENT_DATA_ALT,Kind.ACK,Kind.FIN_ACK].includes(e.kind))continue;
        const pulse=pulses[slot++%pulses.length];pulse.incoming=e.direction==='decode';pulse.final=e.kind===Kind.FIN_ACK;
        const signalColor = e.kind === Kind.ACK || e.kind === Kind.FIN_ACK ? 0xd2efff : 0xff883d;
        pulse.dot.material.color.setHex(signalColor);
        pulse.rings.forEach(ring => ring.material.color.setHex(signalColor));
        pulse.at = performance.now();
      }
      schedule(false);
      if(staticFrame() && (events.length || next.failed)){clearTimeout(settle);settle=window.setTimeout(()=>schedule(true),1180);}
    },
    dispose(){
      alive=false;drift?.cancel();clearTimeout(timer);clearTimeout(settle);observer.disconnect();resize.disconnect();
      window.removeEventListener('pointermove',move);window.removeEventListener('scroll',scroll);document.removeEventListener('visibilitychange',visibility);
      renderer.domElement.removeEventListener('webglcontextlost',lost);
      const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();
      scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line||o instanceof T.Points||o instanceof T.Sprite){if(o.geometry)geometries.add(o.geometry);for(const m of [o.material].flat())materials.add(m);}});
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
      renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
    }
  };
}
