(() => {
  'use strict';
  const scene = document.querySelector('.winter-scene');
  const canvas = document.getElementById('winterSnow');
  if (!scene || !canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0, height = 0, flakes = [], frame = 0, last = 0;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    flakes = Array.from({length: width < 640 ? 42 : 86}, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: .5 + Math.random() * 1.6,
      speed: 11 + Math.random() * 22,
      drift: 2 + Math.random() * 7,
      phase: Math.random() * Math.PI * 2,
      alpha: .2 + Math.random() * .5,
    }));
    draw(0, 0);
  }
  function draw(delta, time) {
    ctx.clearRect(0, 0, width, height);
    for (const flake of flakes) {
      flake.y += flake.speed * delta;
      flake.x += (flake.drift + Math.sin(time / 2400 + flake.phase) * 5) * delta;
      if (flake.y > height + 5) { flake.y = -5; flake.x = Math.random() * width; }
      if (flake.x > width + 5) flake.x = -5;
      ctx.beginPath();
      ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(236,246,255,${flake.alpha})`;
      ctx.fill();
    }
  }
  function tick(time) {
    if (document.hidden || reducedMotion.matches) { frame = 0; return; }
    if (!last) last = time;
    if (time - last >= 1000 / 30) {
      draw(Math.min((time - last) / 1000, .06), time);
      last = time;
    }
    frame = requestAnimationFrame(tick);
  }
  function syncMotion() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    scene.classList.toggle('winter-paused', document.hidden || reducedMotion.matches);
    if (!document.hidden && !reducedMotion.matches) frame = requestAnimationFrame(tick);
    else draw(0, 0);
  }
  window.addEventListener('resize', resize, {passive:true});
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', syncMotion);
  resize();
  syncMotion();
})();
