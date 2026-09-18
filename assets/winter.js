(() => {
  'use strict';
  const scene = document.querySelector('.winter-scene');
  const snow = document.getElementById('winterSnow');
  const traffic = document.getElementById('winterTraffic');
  if (!scene || !snow || !traffic) return;
  const ctx = snow.getContext('2d');
  const road = traffic.getContext('2d');
  if (!ctx || !road) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const PHOTO = {width:1672, height:941};
  const sprites = [
    {crop:[24,20,300,218], anchor:[.67,.95], lamps:[[.553,.725],[.933,.633]], near:[1030,985]},
    {crop:[372,42,264,188], anchor:[.64,.936], lamps:[[.542,.628],[.936,.548]], near:[1300,960]},
  ];
  // Shared lane speed and fixed spacing prevent cars from passing through one another.
  const cars = Array.from({length:10}, (_, i) => ({
    lane:i % 2, depth:.9 + Math.floor(i / 2) * 1.45 + (i % 2) * .52,
    size:.92 + (i % 3) * .06,
  }));
  const atlas = new Image();
  let ready = false, width = 0, height = 0, cover = 1, offsetX = 0, offsetY = 0;
  let flakes = [], frame = 0, last = 0, remainder = 0, elapsed = 0;
  const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));

  function lightTexture(tail) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const c = tile.getContext('2d');
    const g = c.createRadialGradient(64,64,0,64,64,64);
    const colors = tail
      ? [[0,'rgba(255,207,150,.96)'],[.22,'rgba(255,87,53,.94)'],[.44,'rgba(243,50,30,.65)'],[.72,'rgba(245,55,22,.14)'],[1,'rgba(245,55,22,0)']]
      : [[0,'rgba(255,255,239,1)'],[.23,'rgba(255,246,217,.98)'],[.45,'rgba(255,222,163,.78)'],[.72,'rgba(248,190,115,.14)'],[1,'rgba(248,190,115,0)']];
    colors.forEach(([stop,color]) => g.addColorStop(stop,color));
    c.fillStyle = g;
    c.fillRect(0,0,128,128);
    return tile;
  }
  const lights = [lightTexture(false), lightTexture(true)];

  function reflectionTexture(tail) {
    const tile = document.createElement('canvas');
    tile.width = 96; tile.height = 256;
    const c = tile.getContext('2d');
    const color = tail ? '246,61,35' : '255,214,155';
    // Broken horizontal bands suggest ripples on wet asphalt, not solid light columns.
    for (let y = 0; y < 256; y += 3) {
      const taper = 1 - y / 256;
      const middle = 48 + Math.sin(y * .09) * 5;
      const half = 9 + taper * 22 + Math.sin(y * .61) * 5;
      const g = c.createLinearGradient(middle-half,0,middle+half,0);
      g.addColorStop(0,`rgba(${color},0)`);
      g.addColorStop(.5,`rgba(${color},${taper * taper * (.24 + (1 + Math.sin(y * 1.7)) * .2)})`);
      g.addColorStop(1,`rgba(${color},0)`);
      c.fillStyle = g; c.fillRect(0,y,96,2);
    }
    return tile;
  }
  const reflections = [reflectionTexture(false), reflectionTexture(true)];

  atlas.onload = () => {
    for (const sprite of sprites) {
      const tile = document.createElement('canvas');
      const [x,y,w,h] = sprite.crop;
      tile.width = w + 24; tile.height = h + 24;
      const c = tile.getContext('2d');
      c.filter = 'blur(5px) brightness(.78) saturate(.65)';
      c.drawImage(atlas,x,y,w,h,12,12,w,h);
      sprite.image = tile;
    }
    ready = true;
    drawTraffic(0);
  };
  atlas.src = 'assets/winter-cars.png';

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    for (const canvas of [snow,traffic]) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext('2d').setTransform(scale,0,0,scale,0,0);
    }
    // Match the wallpaper's CSS cover/crop exactly, including the narrow-screen crop.
    cover = Math.max(width / PHOTO.width, height / PHOTO.height);
    offsetX = (width - PHOTO.width * cover) * (width <= 640 ? .53 : .5);
    offsetY = (height - PHOTO.height * cover) * .5;
    flakes = Array.from({length:width < 640 ? 42 : 86}, () => ({
      x:Math.random() * width, y:Math.random() * height,
      radius:.5 + Math.random() * 1.6, speed:11 + Math.random() * 22,
      drift:2 + Math.random() * 7, phase:Math.random() * Math.PI * 2,
      alpha:.2 + Math.random() * .5,
    }));
    draw(0);
  }

  function drawTraffic(delta) {
    road.clearRect(0,0,width,height);
    if (!ready) return;
    for (const car of cars) {
      car.depth += (car.lane ? .24 : -.28) * delta;
      if (car.depth < .65) car.depth += 7.25;
      if (car.depth > 7.9) car.depth -= 7.25;
    }
    road.save();
    road.translate(offsetX,offsetY);
    road.scale(cover,cover);
    // Constant road speed projects to increasing size/screen speed near the camera.
    const ordered = [...cars].sort((a,b) => b.depth - a.depth);
    for (const car of ordered) {
      const sprite = sprites[car.lane];
      const p = 1 / car.depth;
      const x = 420 + (sprite.near[0] - 420) * p;
      const y = 565 + (sprite.near[1] - 565) * p;
      const w = 220 * p * car.size;
      const h = w * sprite.crop[3] / sprite.crop[2];
      const alpha = clamp((7.9-car.depth) / 1.1) * clamp((PHOTO.height * 1.025-y) / 135);
      if (alpha <= 0 || (x+w)*cover+offsetX < 0 || (x-w)*cover+offsetX > width) continue;
      const left = x-w*sprite.anchor[0], top = y-h*sprite.anchor[1];
      const lamps = sprite.lamps.map(([u,v]) => ({x:left+w*u,y:top+h*v}));
      road.globalCompositeOperation = 'screen';
      for (const lamp of lamps) {
        road.globalAlpha = alpha * .86;
        road.drawImage(reflections[car.lane],lamp.x-w*.15,lamp.y+w*.12,w*.3,w*1.12);
      }
      road.globalCompositeOperation = 'source-over';
      road.globalAlpha = alpha * .88;
      const padding = w * 12 / sprite.crop[2];
      road.drawImage(sprite.image,left-padding,top-padding,w+padding*2,h+padding*2);
      road.globalCompositeOperation = 'screen';
      for (const lamp of lamps) {
        // A fixed glass field bends moving light; it never makes the car itself jitter.
        const wave = Math.sin(lamp.x*.047 + Math.sin(lamp.y*.031)*2);
        const bend = Math.sin(lamp.y*.063 + lamp.x*.021);
        const radius = (car.lane ? .12 : .155) * w + 1.5;
        const lx = lamp.x + wave * Math.min(2.8,w*.024);
        const ly = lamp.y + bend * Math.min(1.8,w*.018);
        road.globalAlpha = alpha * (.9 + wave*.1);
        road.drawImage(lights[car.lane],lx-radius,ly-radius*.87,radius*2,radius*1.74);
        // A faint offset refraction and vertical smear through condensation.
        road.globalAlpha = alpha * (.1 + Math.abs(bend)*.07);
        road.drawImage(lights[car.lane],lx-radius*.55+wave*5,ly-radius*1.75,radius*1.1,radius*3.5);
        road.globalAlpha = alpha * .07;
        road.drawImage(lights[car.lane],lx-radius*2.3,ly-radius*.25,radius*4.6,radius*.5);
      }
    }
    road.restore();
    road.globalAlpha = 1;
    road.globalCompositeOperation = 'source-over';
  }

  function draw(delta) {
    elapsed += delta;
    drawTraffic(delta);
    ctx.clearRect(0,0,width,height);
    for (const flake of flakes) {
      flake.y += flake.speed * delta;
      flake.x += (flake.drift + Math.sin(elapsed/2.4 + flake.phase)*5) * delta;
      if (flake.y > height+5) { flake.y = -5; flake.x = Math.random()*width; }
      if (flake.x > width+5) flake.x = -5;
      ctx.beginPath();
      ctx.arc(flake.x,flake.y,flake.radius,0,Math.PI*2);
      ctx.fillStyle = `rgba(236,246,255,${flake.alpha})`;
      ctx.fill();
    }
  }
  function tick(time) {
    if (document.hidden || reducedMotion.matches) { frame = 0; return; }
    if (!last) last = time;
    remainder += Math.min((time-last)/1000,.1);
    last = time;
    const steps = Math.floor((remainder + 1e-8) * 30);
    if (steps > 0) {
      const delta = steps / 30;
      remainder = Math.max(0,remainder-delta);
      draw(delta);
    }
    frame = requestAnimationFrame(tick);
  }
  function syncMotion() {
    cancelAnimationFrame(frame);
    frame = 0; last = 0; remainder = 0;
    if (!document.hidden && !reducedMotion.matches) frame = requestAnimationFrame(tick);
    else draw(0);
  }
  window.addEventListener('resize',resize,{passive:true});
  document.addEventListener('visibilitychange',syncMotion);
  reducedMotion.addEventListener('change',syncMotion);
  resize();
  syncMotion();
})();
