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
  const moonMat=new T.MeshStandardMaterial({color:0xffffff,roughness:1,bumpScale:.066});
  const sphere=new T.SphereGeometry(1,mobile?48:80,mobile?32:48);
  const moon=new T.Mesh(sphere,moonMat);moon.scale.setScalar(3.15);moon.rotation.y=.8;world.add(moon);
  const sun=new T.DirectionalLight(0xffffff,3.5);sun.position.set(-5,6,4);
  const rim=new T.DirectionalLight(0xff5a1f,1.1);rim.position.set(4,3,-3);
  scene.add(sun,rim,new T.AmbientLight(0xffffff,.13));
  const halo=haloTexture();
  const glow=new T.Sprite(new T.SpriteMaterial({map:halo,transparent:true,opacity:.55,blending:T.AdditiveBlending,depthWrite:false}));
  glow.scale.set(4,2.6,1);world.add(glow);
  const earthMat=new T.ShaderMaterial({
    vertexShader:'varying vec3 n; void main(){n=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec3 n; void main(){vec3 s=normalize(n);float f=pow(1.-max(s.z,0.),2.6);
      float light=max(0.,dot(s,normalize(vec3(-.7,.45,.4))));
      float clouds=smoothstep(.52,.92,sin(12.*s.y+4.*sin(5.*s.x)+sin(17.*s.x)));
      vec3 c=mix(vec3(.014,.09,.44),vec3(.63,.72,.82),clouds*.68)*(.07+light)+vec3(.12,.42,1.)*f;
      gl_FragColor=vec4(c,1.);}`
  });
  const earth=new T.Mesh(sphere,earthMat);earth.scale.setScalar(mobile?.13:.19);world.add(earth);
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
  const metal=new T.MeshStandardMaterial({color:0xffffff,roughness:.6});
  const shaft=new T.Mesh(new T.CylinderGeometry(.009,.025,.31,6),metal);shaft.position.y=.155;mast.add(shaft);
  const tipMat=new T.MeshBasicMaterial({color:orange});
  const tip=new T.Mesh(sphere,tipMat);tip.scale.setScalar(.026);tip.position.y=.32;mast.add(tip);
  const tipLight=new T.PointLight(orange,.12,1);tipLight.position.copy(tip.position);mast.add(tipLight);
  const base=new T.Vector3(),end=new T.Vector3();
  const beamGeo=new T.BufferGeometry().setFromPoints([base,end]);
  const beamMat=new T.LineBasicMaterial({color:orange,transparent:true,opacity:.14});
  world.add(new T.Line(beamGeo,beamMat));
  // A fixed pool bounds both geometry allocations and visible packet effects.
  const pulses=Array.from({length:8},()=>{
    const dot=new T.Mesh(sphere,new T.MeshBasicMaterial());dot.scale.setScalar(.034);dot.visible=false;world.add(dot);
    const ring=new T.Mesh(new T.RingGeometry(.94,1,40),new T.MeshBasicMaterial({color:orange,side:T.DoubleSide,transparent:true,depthWrite:false}));
    ring.visible=false;ring.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),normal);world.add(ring);
    return {dot,ring,at:-Infinity,ack:false,final:false};
  });
  let state=initial, alive=true, visible=true, loaded=false, timer=0, slot=0, warnUntil=0,failUntil=0, rotation=0, last=performance.now();
  const mouse={x:0,y:0};
  const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
  const software=ext && /swiftshader|llvmpipe|software/i.test(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)));
  let settle = 0;
  const staticFrame=()=>state.reduced || software;
  function layout(){
    const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;
    const span=3*w/h;
    camera.left=-span;camera.right=span;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
    moon.position.set(span*(mobile?.52:.64),mobile?-4.05:-3.55,0);
    earth.position.set(span*.72,mobile?1.45:1.65,-2);
    mast.position.copy(moon.position).addScaledVector(normal,3.15);
    base.copy(mast.position).addScaledVector(normal,.32);end.copy(earth.position);
    const p=beamGeo.getAttribute('position');p.setXYZ(0,base.x,base.y,base.z);p.setXYZ(1,end.x,end.y,end.z);p.needsUpdate=true;beamGeo.computeBoundingSphere();
    schedule(true);
  }
  function draw(){
    timer=0;if(!alive||!loaded||document.hidden||!visible)return;
    const now=performance.now(),still=staticFrame(),dt=Math.min((now-last)/1000,.1);last=now;
    if(!still) rotation+=dt;
    moon.rotation.y=.8+rotation*.009;stars.rotation.z=rotation*.00045;
    const scroll=Math.min(1,window.scrollY/Math.max(innerHeight,1));
    camera.zoom=1+scroll*.11;camera.updateProjectionMatrix();
    world.position.set(still?0:mouse.x*.09+(mobile?.035*Math.sin(rotation*.12):0),still?0:mouse.y*.05,0);
    glow.position.set(moon.position.x+1.1,moon.position.y+(state.transferring?3.02:2.88),moon.position.z-.6);
    tipMat.color.setHex(now<failUntil?0xff4d5e:now<warnUntil?0xffd23d:orange);
    tipMat.color.multiplyScalar(state.listening||state.transferring?1:.52);
    tipLight.intensity=state.listening?.3:.10;beamMat.opacity=now<warnUntil?.045:state.listening?.32:.12;
    for(const p of pulses){
      const t=(now-p.at)/950,show=t>=0&&t<1;
      p.dot.visible=show;p.ring.visible=show&&(!p.ack||p.final);
      if(!show)continue;
      p.dot.position.lerpVectors(p.ack?end:base,p.ack?base:end,still?.5:t);
      p.ring.position.copy(mast.position).addScaledVector(normal,.015);
      p.ring.scale.setScalar((p.final?.7:.45)*(still?.55:t)+.024);p.ring.material.opacity=1-t;
      if(p.final)tipMat.color.setHex(0xffffff);
    }
    renderer.render(scene,camera);
    if(!still)schedule(false);
  }
  function schedule(immediate:boolean){
    if(!alive||!loaded||!visible||document.hidden)return;
    if(timer && !immediate)return;
    clearTimeout(timer);timer=window.setTimeout(draw,immediate?0:1000/(state.transferring?24:30));
  }
  const move=(e:PointerEvent)=>{if(!mobile && !staticFrame()){mouse.x=e.clientX/innerWidth-.5;mouse.y=e.clientY/innerHeight-.5;}};
  const visibility=()=>{clearTimeout(timer);timer=0;if(!document.hidden)schedule(true);};
  const scroll=()=>{if(!staticFrame())schedule(false);};
  const lost=(e:Event)=>{e.preventDefault();fail();};
  const regions = new Set<Element>();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) regions.add(entry.target);
      else regions.delete(entry.target);
    }
    visible = regions.size > 0;
    visibility();
  });
  document.querySelectorAll('.relay-hero,.console-shell').forEach(region => observer.observe(region));
  const resize=new ResizeObserver(layout);resize.observe(host);
  window.addEventListener('pointermove',move,{passive:true});window.addEventListener('scroll',scroll,{passive:true});
  document.addEventListener('visibilitychange',visibility);renderer.domElement.addEventListener('webglcontextlost',lost);
  const loader=new T.TextureLoader();let finished=0;const textures:T.Texture[]=[halo];
  for(const type of ['surface','relief']){
    const tex=loader.load('./lunar/'+type+'-'+(mobile?512:1024)+'.webp',()=>{
      if(!alive)return;
      finished++;progress(finished===1?65:90);
      if(finished===2){loaded=true;layout();draw();progress(100);}
    },undefined,()=>{if(alive)fail();});
    if(type==='surface'){tex.colorSpace=T.SRGBColorSpace;moonMat.map=tex;}else moonMat.bumpMap=tex;
    textures.push(tex);
  }
  return {
    update(next,events){
      if(next.failed&&!state.failed) failUntil=performance.now()+650;
      state=next;
      for(const e of events){
        if(e.direction==='timeout'||(e.attempt??1)>1)warnUntil=performance.now()+650;
        if(e.direction==='timeout'||![Kind.DATA,Kind.CONTENT_DATA_ALT,Kind.ACK,Kind.FIN_ACK].includes(e.kind))continue;
        const pulse=pulses[slot++%pulses.length];pulse.ack=e.kind===Kind.ACK||e.kind===Kind.FIN_ACK;pulse.final=e.kind===Kind.FIN_ACK;
        pulse.dot.material.color.setHex(pulse.ack?0xffffff:orange);pulse.at=performance.now();
      }
      schedule(false);
      if(staticFrame() && (events.length || next.failed)){clearTimeout(settle);settle=window.setTimeout(()=>schedule(true),1000);}
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
