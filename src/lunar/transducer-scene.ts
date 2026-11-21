import {
  AmbientLight, BoxGeometry, CylinderGeometry, DirectionalLight, Group,
  LatheGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene,
  TorusGeometry, Vector2, WebGLRenderer,
} from 'three';

export interface TransducerScene {
  update(peak: number, verified: boolean): void;
  dispose(): void;
}

export function createTransducer(host: HTMLDivElement): TransducerScene {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const canvas = renderer.domElement;
  const scene = new Scene();
  const camera = new PerspectiveCamera(29, 1, 0.1, 20);
  camera.position.set(3.4, 1.65, 4.4);
  camera.lookAt(0, 0, -.05);

  const speaker = new Group();
  scene.add(speaker);
  const cast = new MeshStandardMaterial({ color: 0x30343a, metalness: .52, roughness: .48 });
  const alloy = new MeshStandardMaterial({ color: 0x818387, metalness: .65, roughness: .32 });
  const cap = new MeshStandardMaterial({ color: 0x40464e, metalness: .36, roughness: .32 });
  const rubber = new MeshStandardMaterial({ color: 0x171719, roughness: .7 });
  const cone = new MeshStandardMaterial({ color: 0x24282e, metalness: .15, roughness: .55 });
  const copper = new MeshStandardMaterial({ color: 0xff632d, metalness: .46, roughness: .36, emissive: 0xff3812, emissiveIntensity: .14 });

  function profile(points: [number, number][], material: MeshStandardMaterial, parent = speaker) {
    const mesh = new Mesh(new LatheGeometry(points.map(([radius, depth]) => new Vector2(radius, depth)), 64), material);
    mesh.rotation.x = Math.PI / 2;
    parent.add(mesh);
  }

  // Rear magnet and cast frame flare toward the machined mounting rim.
  profile([[0,-.7],[.44,-.7],[.48,-.66],[.48,-.45],[.42,-.4],[0,-.4]], cast);
  profile([[.44,-.42],[.53,-.42],[.6,-.33],[.95,-.26],[1.07,-.2],[1.12,-.13],[1.12,.16],[1.08,.21],[.95,.21],[.91,.16],[.9,.08]], cast);
  profile([[1.079,-.137],[1.123,-.137],[1.127,-.104],[1.119,-.078]], alloy);
  profile([[.98,.15],[1.12,.15],[1.138,.192],[1.138,.22],[1.11,.245],[.98,.245],[.95,.221],[.94,.116]], alloy);

  const trim = new Mesh(new TorusGeometry(.959, .012, 8, 80), copper);
  trim.position.z = .223;
  speaker.add(trim);
  profile([[.94,.117],[.899,.123],[.868,.169],[.831,.188],[.797,.168],[.77,.12],[.72,.085]], rubber);

  const diaphragm = new Group();
  speaker.add(diaphragm);
  profile([[.77,.12],[.72,.083],[.66,.033],[.58,-.018],[.48,-.068],[.33,-.125],[.24,-.19],[0,-.19]], cone, diaphragm);
  profile([[0,.022],[.083,.017],[.164,-.006],[.228,-.06],[.26,-.12],[.277,-.18]], cap, diaphragm);
  // Fine concentric ridges follow the contour of the cone.
  for (const [radius, depth] of [[.43,-.088],[.52,-.047],[.59,-.013],[.65,.024],[.7,.067]]) {
    const rib = new Mesh(new TorusGeometry(radius, .004, 6, 64), rubber);
    rib.position.z = depth;
    diaphragm.add(rib);
  }

  const fastenerGeometry = new CylinderGeometry(.036, .039, .014, 8);
  fastenerGeometry.rotateX(Math.PI / 2);
  const slotGeometry = new BoxGeometry(.052, .008, .003);
  const braceGeometry = new BoxGeometry(.48, .075, .11);
  for (let index = 0; index < 6; index++) {
    const angle = (index + .5) * Math.PI / 3;
    const bolt = new Mesh(fastenerGeometry, cast);
    bolt.position.set(1.035 * Math.cos(angle), 1.035 * Math.sin(angle), .249);
    bolt.rotation.z = angle;
    const slot = new Mesh(slotGeometry, rubber);
    slot.position.z = .008;
    bolt.add(slot);
    speaker.add(bolt);

    const brace = new Mesh(braceGeometry, alloy);
    brace.position.set(.76 * Math.cos(angle), .76 * Math.sin(angle), -.23);
    brace.rotation.set(0, -.55, angle, 'ZYX');
    speaker.add(brace);
  }

  const key = new DirectionalLight(0xfff3eb, 3.55);
  key.position.set(-1, 3, 5);
  const rim = new DirectionalLight(0xff6129, 2.3);
  rim.position.set(3, 1, -3);
  const fill = new DirectionalLight(0xc4d2e2, 1.35);
  fill.position.set(2, -3, 3);
  scene.add(new AmbientLight(0xffffff, 1.35), key, rim, fill);

  let visible = true;
  let lost = false;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  function draw() {
    if (!visible || lost || document.hidden || !canvas.width || !canvas.height) return;
    renderer.render(scene, camera);
    host.dataset.rendered = 'true';
  }
  function resize() {
    const { clientWidth: width, clientHeight: height } = host;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    draw();
  }
  function contextLost() {
    lost = true;
    delete host.dataset.rendered;
  }
  function contextRestored() {
    lost = false;
    draw();
  }
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  document.addEventListener('visibilitychange', draw);
  host.append(canvas);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    draw();
  });
  visibility.observe(host);
  return {
    update(peak, verified) {
      const position = motion.matches ? 0 : Math.min(1, peak) * .065;
      const intensity = .14 + (verified ? .23 : 0) + Math.min(1, peak) * .52;
      if (diaphragm.position.z === position && copper.emissiveIntensity === intensity) return;
      diaphragm.position.z = position;
      copper.emissiveIntensity = intensity;
      draw();
    },
    dispose() {
      observer.disconnect();
      visibility.disconnect();
      document.removeEventListener('visibilitychange', draw);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      const geometries = new Set<LatheGeometry | TorusGeometry | CylinderGeometry | BoxGeometry>();
      speaker.traverse(object => { if (object instanceof Mesh) geometries.add(object.geometry); });
      for (const geometry of geometries) geometry.dispose();
      for (const material of [cast, alloy, cap, rubber, cone, copper]) material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      delete host.dataset.rendered;
    },
  };
}
