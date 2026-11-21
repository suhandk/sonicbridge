import * as T from 'three';
import { Kind } from '../protocol';
import type { PacketEvent } from '../transport';

export type VisualState = { listening:boolean; transferring:boolean; failed:boolean; reduced:boolean };
export interface RelayScene { update(state:VisualState, packets:PacketEvent[]):void; setPreview(target: HTMLDivElement | null): void; dispose():void }

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
  renderer.setClearColor(0,0);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(renderer.domElement);
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
  const earthMat = new T.MeshStandardMaterial({roughness: .65, color: 0xe6efff});
  const earth = new T.Mesh(sphere, earthMat);
  earth.scale.setScalar(mobile ? .135 : .21);
  earth.rotation.set(.15, -1.36, -.21, 'ZXY');
  world.add(earth);
  const atmosphere = new T.Mesh(sphere, new T.ShaderMaterial({
    vertexShader: 'varying vec3 n; void main(){n=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 n; void main() {
      float rim = pow(1.0 - abs(normalize(n).z), 4.0);
      gl_FragColor = vec4(.27,.59,1.,rim*.42);
    }`,
    transparent: true, blending: T.AdditiveBlending, depthWrite: false,
  }));
  atmosphere.scale.setScalar(1.025);
  earth.add(atmosphere);
  const cloudMaterial = new T.MeshStandardMaterial({
    color: 0xf4f8ff, transparent: true, opacity: .64, depthWrite: false, roughness: 1,
  });
  const clouds = new T.Mesh(sphere, cloudMaterial);
  clouds.scale.setScalar(1.016);
  earth.add(clouds);
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
  const orange = 0xff5a1f;
  const satellite = new T.Group();
  world.add(satellite);
  const metal = new T.MeshStandardMaterial({color: 0xe1e9f5, roughness: .5, metalness: .22});
  const foil = new T.MeshStandardMaterial({color: 0xd39a49, roughness: .57, metalness: .31});
  const solar = new T.MeshStandardMaterial({color: 0x183b74, emissive: 0x122a53, emissiveIntensity: .55});
  const graphite = new T.MeshStandardMaterial({color: 0x262c35, roughness: .84});
  const hullProfile = [
    [0, -.39], [.16, -.39], [.218, -.335], [.218, -.04],
    [.181, .025], [.181, .12], [.141, .18], [.141, .31],
    [.17, .345], [.17, .385], [0, .385],
  ].map(([radius, height]) => new T.Vector2(radius, height));
  satellite.add(new T.Mesh(new T.LatheGeometry(hullProfile, 24), metal));

  const insulation = new T.Mesh(new T.CylinderGeometry(.183, .183, .093, 24), foil);
  insulation.position.y = .072;
  const equipmentCollar = new T.Mesh(new T.CylinderGeometry(.224, .224, .077, 24), graphite);
  equipmentCollar.position.y = -.305;
  const ribs = new T.TorusGeometry(.22, .009, 5, 24);
  for (const height of [-.35, -.265, -.13, -.075]) {
    const rib = new T.Mesh(ribs, metal);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = height;
    satellite.add(rib);
  }
  satellite.add(insulation, equipmentCollar);

  const radiator = new T.BoxGeometry(.062, .15, .018);
  for (let index = 0; index < 6; index++) {
    const angle = index * Math.PI / 3;
    const tile = new T.Mesh(radiator, graphite);
    tile.position.set(Math.sin(angle) * .216, -.18, Math.cos(angle) * .216);
    tile.rotation.y = angle;
    satellite.add(tile);
  }
  const sensorBarrel = new T.Mesh(new T.CylinderGeometry(.127, .149, .087, 20), graphite);
  sensorBarrel.position.y = .395;
  const sensorGlass = new T.Mesh(new T.SphereGeometry(.088, 16, 10),
    new T.MeshStandardMaterial({color: 0x253e53, roughness: .21, metalness: .34}));
  sensorGlass.scale.y = .26;
  sensorGlass.position.y = .435;
  const sensorRim = new T.Mesh(new T.TorusGeometry(.111, .014, 6, 20), foil);
  sensorRim.position.y = .438;
  sensorRim.rotation.x = Math.PI / 2;
  satellite.add(sensorBarrel, sensorGlass, sensorRim);
  const cell = new T.BoxGeometry(.232, .39, .023);
  const panelFrame = new T.BoxGeometry(.247, .409, .017);
  const gridMaterial = new T.LineBasicMaterial({color: 0x8aadd8, transparent: true, opacity: .48});
  const gridPoints: T.Vector3[] = [];
  for (const x of [-.07, 0, .07]) {
    gridPoints.push(new T.Vector3(x, -.181, .013), new T.Vector3(x, .181, .013));
  }
  for (const y of [-.15, -.10, -.05, 0, .05, .10, .15]) {
    gridPoints.push(new T.Vector3(-.099, y, .013), new T.Vector3(.099, y, .013));
  }
  const grid = new T.BufferGeometry().setFromPoints(gridPoints);
  const wingBoom = new T.CylinderGeometry(.024, .034, .19, 10);
  const hingeGeometry = new T.CylinderGeometry(.023, .023, .407, 8);
  for (const side of [-1, 1]) {
    const wing = new T.Group();
    wing.position.set(side * .31, .015, 0);
    wing.rotation.y = side * .16;
    const boom = new T.Mesh(wingBoom, metal);
    boom.rotation.z = Math.PI / 2;
    boom.position.x = -side * .07;
    wing.add(boom);
    for (let section = 0; section < 3; section++) {
      const panel = new T.Mesh(cell, solar);
      panel.position.set(side * (.134 + section * .254), 0, section * .022);
      panel.rotation.y = -side * section * .075;
      const frame = new T.Mesh(panelFrame, metal);
      frame.position.z = -.011;
      const hinge = new T.Mesh(hingeGeometry, metal);
      hinge.position.x = -side * .119;
      panel.add(frame, hinge, new T.LineSegments(grid, gridMaterial));
      wing.add(panel);
    }
    satellite.add(wing);
  }
  const terminal = new T.Group();
  const terminalMount = new T.Mesh(new T.CylinderGeometry(.052, .07, .06, 12), metal);
  terminalMount.position.y = -.028;
  terminal.add(terminalMount);
  const reflector = new T.Mesh(new T.LatheGeometry([
    new T.Vector2(0, 0), new T.Vector2(.095, .018), new T.Vector2(.18, .075),
  ], 24), new T.MeshStandardMaterial({color: 0xeaf5ff, roughness: .45, side: T.DoubleSide}));
  const tipMat = new T.MeshBasicMaterial({color: orange});
  const tip = new T.Mesh(sphere, tipMat);
  tip.scale.setScalar(.048);
  tip.position.y = .15;
  const braces: T.Vector3[] = [];
  for (let index = 0; index < 3; index++) {
    const angle = index * 2 * Math.PI / 3;
    braces.push(new T.Vector3(Math.cos(angle) * .166, .067, Math.sin(angle) * .166),
      new T.Vector3(0, .15, 0));
  }
  const supports = new T.LineSegments(new T.BufferGeometry().setFromPoints(braces),
    new T.LineBasicMaterial({color: 0xd3deea}));
  terminal.add(reflector, supports, tip);
  world.add(terminal);

  const orbitTilt = new T.Euler(.86, -.38, -.28, 'ZYX');
  const eccentricity = .16;
  const minorAxis = Math.sqrt(1 - eccentricity ** 2);
  // The origin of this ellipse is its near focus, where the Moon sits.
  function orbitPoint(point: T.Vector3, anomaly: number) {
    return point.set(Math.cos(anomaly) - eccentricity, Math.sin(anomaly) * minorAxis, 0)
      .applyEuler(orbitTilt);
  }
  const orbitDirection = new T.Vector3();
  const terminalDirection = new T.Vector3();
  const terminalOffset = new T.Vector3();
  const moonRest = new T.Vector3();
  const earthRest = new T.Vector3();
  const solarOffset = new T.Vector3();
  const up = new T.Vector3(0, 1, 0);
  const orbit = new T.LineLoop(new T.BufferGeometry().setFromPoints(
    Array.from({length: 96}, (_, index) => {
      const angle = index * 2 * Math.PI / 96;
      return orbitPoint(new T.Vector3(), angle);
    }),
  ), new T.LineBasicMaterial({color: 0x71839a, transparent: true, opacity: .23}));
  world.add(orbit);
  const earthRadius = mobile ? .155 : .25;
  const base=new T.Vector3(),end=new T.Vector3();
  const beamGeo=new T.BufferGeometry().setFromPoints([base,end]);
  const beamMat=new T.LineBasicMaterial({color:orange,transparent:true,opacity:.14});
  const beam = new T.Line(beamGeo, beamMat);
  beam.frustumCulled = false;
  world.add(beam);
  const beamPositions = beamGeo.getAttribute('position');
  const nearest = new T.Vector3();
  // A fixed pool bounds both geometry allocations and visible packet effects.
  const pulses=Array.from({length:8},()=>{
    const dot=new T.Mesh(sphere,new T.MeshBasicMaterial());dot.scale.setScalar(.034);dot.visible=false;world.add(dot);
    const rings = [0, 1].map(() => {
      const ring = new T.Mesh(new T.RingGeometry(.86,1,40), new T.MeshBasicMaterial({
        transparent: true, depthWrite: false, depthTest: true,
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
  let settle = 0;
  const staticFrame = () => state.reduced;
  const hero = document.querySelector<HTMLElement>('.relay-hero');
  let consolePreview: HTMLDivElement | null = null;
  let viewport: HTMLElement = host;
  function layout(){
    const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;
    const span=3*w/h;
    camera.left=-span;camera.right=span;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
    const compact = viewport === consolePreview;
    const radius = compact ? .96 : mobile ? Math.min(span * .73, 1.75) : Math.min(span * .36, 2.05);
    const moonY = compact ? -.52 : mobile ? -.25 : -.1;
    moon.scale.setScalar(radius);
    moonRest.set(span * (compact ? -.38 : mobile ? -.08 : .43), moonY, 0);
    earthRest.set(span * (compact ? .4 : .76), moonY + radius * (compact ? 1.8 : mobile ? 1.28 : 1.04), .4);
    earth.scale.setScalar(compact ? .5 : earthRadius);
    orbit.scale.setScalar(radius * 1.48);
    satellite.scale.setScalar(compact ? .64 : mobile ? .32 : .48);
    terminal.scale.copy(satellite.scale);
    schedule(true);
  }
  function draw(){
    timer=0;if(!alive||!loaded||document.hidden||!visible)return;
    const now=performance.now(),still=staticFrame(),dt=Math.min((now-last)/1000,.1);last=now;
    if(!still) rotation+=dt;
    moon.rotation.y=-1.46+Math.sin(rotation*.38)*.085;stars.rotation.z=rotation*.003;
    const scroll=still ? 0 : Math.min(1,window.scrollY/Math.max(innerHeight,1));
    camera.zoom=viewport === consolePreview ? 1 : 1+scroll*.08;camera.updateProjectionMatrix();
    world.position.set(still?0:mouse.x*.24+.075*Math.sin(rotation*.45),still?0:mouse.y*.14+.035*Math.sin(rotation*.32),0);
    // Screen-space projection of the shared solar orbit, with compressed scale and timing.
    const solarPhase = rotation * .19;
    solarOffset.set(Math.sin(solarPhase) * (mobile ? .125 : .22), (Math.cos(solarPhase) - 1) * .09, 0);
    earth.position.copy(earthRest).add(solarOffset);
    // Show a small projected arc of the Moon's wider orbit around Earth.
    const lunarPhase = rotation * .29;
    moon.position.copy(moonRest).add(solarOffset);
    moon.position.x += Math.sin(lunarPhase) * .08;
    moon.position.y += (1 - Math.cos(lunarPhase)) * .065;
    orbit.position.copy(moon.position);
    glow.position.set(moon.position.x+moon.scale.x*.75,moon.position.y+moon.scale.x*(state.transferring?.56:.45),-1);
    tipMat.color.setHex(now<failUntil?0xff4d5e:now<warnUntil?0xffd23d:orange);
    tipMat.color.multiplyScalar(state.listening||state.transferring?1:.52);
    earth.rotation.y = -1.36 + rotation * .24;
    clouds.rotation.y = .1 + rotation * .018;
    // Uniform time advances mean anomaly. Kepler's equation gives the actual position.
    const meanAnomaly = (1.26 - rotation * .37) % (2 * Math.PI);
    let angle = meanAnomaly;
    for (let step = 0; step < 3; step++) {
      angle -= (angle - eccentricity * Math.sin(angle) - meanAnomaly) /
        (1 - eccentricity * Math.cos(angle));
    }
    orbitPoint(orbitDirection, angle);
    satellite.position.copy(moon.position).addScaledVector(orbitDirection, orbit.scale.x);
    satellite.rotation.set(.21 + Math.sin(angle) * .12, .28 + Math.cos(angle) * .22, angle + Math.PI / 2);
    terminalOffset.set(0, -.12, .255).applyEuler(satellite.rotation).multiplyScalar(satellite.scale.y);
    terminal.position.copy(satellite.position).add(terminalOffset);
    terminalDirection.copy(earth.position).sub(terminal.position).normalize();
    terminal.quaternion.setFromUnitVectors(up, terminalDirection);
    base.copy(terminal.position).addScaledVector(terminalDirection, .15 * terminal.scale.y);
    end.copy(earth.position).addScaledVector(terminalDirection, -earth.scale.x * 1.028);
    const linkLength = base.distanceTo(end);
    const distanceAlongLink = nearest.subVectors(moon.position, base).dot(terminalDirection);
    nearest.copy(base).addScaledVector(terminalDirection, T.MathUtils.clamp(distanceAlongLink, 0, linkLength));
    const clearPath = nearest.distanceToSquared(moon.position) > moon.scale.x ** 2;
    beam.visible = false;
    beamPositions.setXYZ(0, base.x, base.y, base.z);
    beamPositions.setXYZ(1, end.x, end.y, end.z);
    beamPositions.needsUpdate = true;
    beamMat.opacity = now < warnUntil ? .13 : .40;
    for(const p of pulses){
      const t = (now - p.at) / 1150;
      const show = t >= 0 && t < 1;
      p.dot.visible = show && clearPath;
      beam.visible ||= p.dot.visible;
      if (p.dot.visible) p.dot.position.lerpVectors(p.incoming ? end : base, p.incoming ? base : end, state.reduced ? .5 : t);
      p.rings.forEach((ring, index) => {
        const phase = state.reduced ? .35 : (t - index * .55) / .46;
        ring.visible = show && (clearPath || index === 0) && phase >= 0 && phase < 1;
        if (!ring.visible) return;
        ring.position.copy((index === 0) === p.incoming ? end : base);
        ring.position.z += .018;
        ring.scale.setScalar(.04 + phase * (p.final ? .54 : .34));
        ring.material.opacity = 1 - phase;
      });
      if (show && p.final) tipMat.color.setHex(0xffffff);
    }
    renderer.render(scene,camera);
    renderer.domElement.dataset.drawn = 'true';
    if (!still) schedule(false);
  }
  function schedule(immediate:boolean){
    if(!alive||!loaded||!visible||document.hidden)return;
    if(timer && !immediate)return;
    clearTimeout(timer);timer=window.setTimeout(draw,immediate?0:1000 / (software ? 12 : state.transferring ? 24 : 30));
  }
  const move=(e:PointerEvent)=>{if(!mobile && !staticFrame()){mouse.x=e.clientX/innerWidth-.5;mouse.y=e.clientY/innerHeight-.5;}};
  const visibility=()=>{clearTimeout(timer);timer=0;if(!document.hidden)schedule(true);};
  const scroll=()=>{if(!staticFrame())schedule(false);};
  const lost=(e:Event)=>{e.preventDefault();fail();};
  const regions = new Set<Element>();
  function placeCanvas() {
    const target = consolePreview && regions.has(consolePreview) ? consolePreview : host;
    visible = target === host ? !!hero && regions.has(hero) : true;
    if (target !== viewport) {
      viewport = target;
      delete renderer.domElement.dataset.drawn;
      target.appendChild(renderer.domElement);
      layout();
    }
    visibility();
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.target !== hero && entry.target !== consolePreview) continue;
      if (entry.isIntersecting) regions.add(entry.target);
      else regions.delete(entry.target);
    }
    placeCanvas();
  });
  const resize = new ResizeObserver(layout);
  resize.observe(host);
  if (hero) { observer.observe(hero); resize.observe(hero); }
  window.addEventListener('pointermove',move,{passive:true});window.addEventListener('scroll',scroll,{passive:true});
  document.addEventListener('visibilitychange',visibility);renderer.domElement.addEventListener('webglcontextlost',lost);
  const loader=new T.TextureLoader();let finished=0;const textures:T.Texture[]=[halo];
  for(const type of ['surface','relief','earth','earth-clouds']){
    const filename = type.startsWith('earth') ? type+'.webp' : type+'-'+(mobile?512:1024)+'.webp';
    const tex=loader.load('./lunar/'+filename,()=>{
      if(!alive)return;
      finished++;progress(finished===1?65:90);
      if(finished===4){loaded=true;layout();progress(100);}
    },undefined,()=>{if(alive)fail();});
    if(type==='surface'){tex.colorSpace=T.SRGBColorSpace;moonMat.map=tex;}else if(type==='relief') moonMat.bumpMap=tex;
    else if(type==='earth') { tex.colorSpace=T.SRGBColorSpace; earthMat.map=tex; }
    else cloudMaterial.alphaMap=tex;
    textures.push(tex);
  }
  return {
    setPreview(target) {
      if (target === consolePreview) return;
      if (consolePreview) {
        observer.unobserve(consolePreview);
        resize.unobserve(consolePreview);
        regions.delete(consolePreview);
      }
      consolePreview = target;
      if (target) {
        observer.observe(target);
        resize.observe(target);
      }
      placeCanvas();
    },
    update(next,events){
      if(next.failed&&!state.failed) failUntil=performance.now()+650;
      state=next;
      for(const e of events){
        if(e.direction==='timeout'||(e.attempt??1)>1)warnUntil=performance.now()+650;
        if (e.direction === 'timeout') continue;
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
      alive=false;clearTimeout(timer);clearTimeout(settle);observer.disconnect();resize.disconnect();
      window.removeEventListener('pointermove',move);window.removeEventListener('scroll',scroll);document.removeEventListener('visibilitychange',visibility);
      renderer.domElement.removeEventListener('webglcontextlost',lost);
      const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();
      scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line||o instanceof T.Points||o instanceof T.Sprite){if(o.geometry)geometries.add(o.geometry);for(const m of [o.material].flat())materials.add(m);}});
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
      renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
    }
  };
}
