'use strict';
// Bootstrap and main loop.

(function () {
  const game = new Game();
  const renderer = new Renderer(document.getElementById('game'), game);
  const ui = new UI(game, renderer);
  const input = new Input(game, renderer, ui);
  ui.init();
  window.cb = { game, renderer, ui, input }; // handy for the console

  function centerCamera() {
    const w = game.world;
    renderer.cam.zoom = 1;
    renderer.centerOn(w.W / 2, w.H / 2);
  }
  window.startNewGame = (opts) => {
    game.newGame(opts);
    centerCamera();
    ui.setSpeed(1);
    ui.drawMinimap();
    ui.autoSave();
  };
  window.loadGame = (data) => {
    game.load(data);
    centerCamera();
    let best = null, n = 0, sx = 0, sy = 0;
    for (const b of game.world.buildings.values()) { if (b.zoned) { sx += b.x; sy += b.y; n++; } }
    if (n) best = [sx / n, sy / n];
    if (best) renderer.centerOn(best[0], best[1]);
    ui.setSpeed(1);
    ui.drawMinimap();
  };

  // A quiet demo map behind the title screen
  game.newGame({ name: 'CityBuilder', size: 64, seed: 4242, mapType: 'continental', quiet: true });
  centerCamera();
  ui.setSpeed(0);
  ui.showNewGame(true);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      input.update(dt);
      game.update(dt);
      game.agents.update(dt, [0, 1, 1.6, 2.4, 3.2][game.speed]);
      renderer.render(dt);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  setInterval(() => { if (game.speed > 0 && !ui.modalOpen) ui.autoSave(); }, 120000);
  window.addEventListener('beforeunload', () => { if (game.state && game.state.day > 0) ui.autoSave(); });
})();
