import { GameManager } from './game.ts';
import { TankControls } from './tank.ts';
import { sound } from './audio.ts';
import { NetworkManager } from './network.ts';

type PlayMode = 'local-2p' | 'vs-ai' | 'online-host' | 'online-guest';

// ===== DOM Elements =====
// Lobby
const lobbyScreen = document.getElementById('lobby-screen')!;
const lobbyModes = document.getElementById('lobby-modes')!;
const btnLocal2P = document.getElementById('btn-local-2p') as HTMLButtonElement;
const btnVsAI = document.getElementById('btn-vs-ai') as HTMLButtonElement;
const btnOnlineHost = document.getElementById('btn-online-host') as HTMLButtonElement;
const btnOnlineJoin = document.getElementById('btn-online-join') as HTMLButtonElement;

const hostPanel = document.getElementById('host-panel')!;
const roomCodeDisplay = document.getElementById('room-code-display')!;
const btnHostCancel = document.getElementById('btn-host-cancel') as HTMLButtonElement;

const joinPanel = document.getElementById('join-panel')!;
const joinCodeInput = document.getElementById('join-code-input') as HTMLInputElement;
const btnJoinConnect = document.getElementById('btn-join-connect') as HTMLButtonElement;
const btnJoinCancel = document.getElementById('btn-join-cancel') as HTMLButtonElement;
const joinError = document.getElementById('join-error')!;

const connectingPanel = document.getElementById('connecting-panel')!;
const btnConnectingCancel = document.getElementById('btn-connecting-cancel') as HTMLButtonElement;

// Game HUD
const appEl = document.getElementById('app')!;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const p1ScoreEl = document.getElementById('p1-score')!;
const p2ScoreEl = document.getElementById('p2-score')!;
const p1WeaponEl = document.getElementById('p1-weapon')!;
const p2WeaponEl = document.getElementById('p2-weapon')!;
const p2NameEl = document.getElementById('p2-name')!;
const p2BadgeEl = document.getElementById('p2-badge')!;
const timerBoxEl = document.getElementById('timer-box')!;
const timerValEl = document.getElementById('sudden-death-timer')!;
const suddenDeathBannerEl = document.getElementById('sudden-death-banner')!;
const killFeedEl = document.getElementById('kill-feed')!;
const controlHintsEl = document.getElementById('control-hints')!;
const pingBadgeEl = document.getElementById('ping-badge')!;

const matchModalEl = document.getElementById('match-modal')!;
const modalTitleEl = document.getElementById('modal-title')!;
const modalSubtitleEl = document.getElementById('modal-subtitle')!;
const btnNextRound = document.getElementById('btn-next-round') as HTMLButtonElement;
const btnBackToLobby = document.getElementById('btn-back-to-lobby') as HTMLButtonElement;

const disconnectBanner = document.getElementById('disconnect-banner')!;
const btnDisconnectLobby = document.getElementById('btn-disconnect-lobby') as HTMLButtonElement;

const btnToggleSound = document.getElementById('btn-toggle-sound') as HTMLButtonElement;
const soundStateTextEl = document.getElementById('sound-state-text')!;
const btnRestartMatch = document.getElementById('btn-restart-match') as HTMLButtonElement;
const btnLobbyReturn = document.getElementById('btn-lobby-return') as HTMLButtonElement;

// ===== State =====
let playMode: PlayMode = 'local-2p';
let game: GameManager | null = null;
const net = new NetworkManager();
let loopRunning = false;
let lastTime = 0;

const keysDown = new Set<string>();

window.addEventListener('keydown', (e) => {
  keysDown.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
  if (game && game.state === 'MATCH_OVER' && e.code === 'Space' && playMode !== 'online-guest') {
    game.resetMatch();
    matchModalEl.classList.add('hidden');
    if (playMode === 'online-host') {
      net.sendMaze(game.buildMazeData());
    }
  }
});

window.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
});

// ===== Lobby UI =====
function showLobbyPanel(panel: 'modes' | 'host' | 'join' | 'connecting') {
  lobbyModes.classList.toggle('hidden', panel !== 'modes');
  hostPanel.classList.toggle('hidden', panel !== 'host');
  joinPanel.classList.toggle('hidden', panel !== 'join');
  connectingPanel.classList.toggle('hidden', panel !== 'connecting');
  joinError.classList.add('hidden');
}

function goToLobby() {
  loopRunning = false;
  net.disconnect();
  lobbyScreen.classList.remove('hidden');
  appEl.classList.add('hidden');
  matchModalEl.classList.add('hidden');
  disconnectBanner.classList.add('hidden');
  pingBadgeEl.classList.add('hidden');
  showLobbyPanel('modes');
  game = null;
}

// ===== Start Game =====
function startGame(mode: PlayMode) {
  playMode = mode;
  lobbyScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  matchModalEl.classList.add('hidden');
  disconnectBanner.classList.add('hidden');

  game = new GameManager(canvas);
  wireGameCallbacks(game);

  if (mode === 'vs-ai') {
    game.p2IsBot = true;
    p2NameEl.textContent = 'LAIKA 2.0 (BOT)';
    p2BadgeEl.textContent = 'AI';
    controlHintsEl.innerHTML = `<span class="hint-p1"><strong>YOU:</strong> WASD to Move, <strong>SPACE</strong> to Shoot, <strong>SHIFT</strong> to Boost</span>`;
  } else if (mode === 'local-2p') {
    game.p2IsBot = false;
    p2NameEl.textContent = 'BLUE TANK';
    p2BadgeEl.textContent = 'P2';
    controlHintsEl.innerHTML = `
      <span class="hint-p1"><strong>P1:</strong> WASD to Move, <strong>SPACE</strong> to Shoot, <strong>SHIFT</strong> to Boost</span>
      <span class="hint-divider">|</span>
      <span class="hint-p2"><strong>P2:</strong> ARROWS to Move, <strong>M</strong> to Shoot, <strong>.</strong> to Boost</span>`;
  } else if (mode === 'online-host') {
    game.p2IsBot = false;
    p2NameEl.textContent = 'OPPONENT';
    p2BadgeEl.textContent = '🌐';
    controlHintsEl.innerHTML = `<span class="hint-p1"><strong>YOU (RED):</strong> WASD to Move, <strong>SPACE</strong> to Shoot, <strong>SHIFT</strong> to Boost</span>`;
  } else if (mode === 'online-guest') {
    game.p2IsBot = false;
    p2NameEl.textContent = 'OPPONENT';
    p2BadgeEl.textContent = '🌐';
    controlHintsEl.innerHTML = `<span class="hint-p2"><strong>YOU (BLUE):</strong> WASD to Move, <strong>SPACE</strong> to Shoot, <strong>SHIFT</strong> to Boost</span>`;
  }

  game.init();

  if (mode === 'online-host' && net.isConnected) {
    // Send maze data to guest immediately
    net.sendMaze(game.buildMazeData());
  }

  lastTime = performance.now();
  loopRunning = true;
  requestAnimationFrame(loop);
}

// ===== Game Callbacks =====
function wireGameCallbacks(g: GameManager) {
  g.onScoreChange = (p1, p2) => {
    p1ScoreEl.textContent = p1.toString();
    p2ScoreEl.textContent = p2.toString();
  };
  g.onTimerChange = (seconds, isWarning) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    timerValEl.textContent = `${m}:${s}`;
    timerBoxEl.classList.toggle('warning', isWarning);
  };
  g.onWeaponChange = (w1, w2) => {
    p1WeaponEl.textContent = w1;
    p2WeaponEl.textContent = w2;
  };
  g.onSuddenDeath = (active) => {
    suddenDeathBannerEl.classList.toggle('active', active);
  };
  g.onKillMsg = (msg) => {
    const div = document.createElement('div');
    div.className = 'kill-msg';
    div.textContent = msg;
    killFeedEl.appendChild(div);
    setTimeout(() => div.remove(), 2500);
  };
  g.onMatchEnd = (winnerName, p1Score, p2Score) => {
    modalTitleEl.textContent = `${winnerName} WINS!`;
    modalSubtitleEl.textContent = `Final Tournament Score: Red ${p1Score} - ${p2Score} Blue`;
    matchModalEl.classList.remove('hidden');
  };
}

// ===== Controls Polling =====
function getLocalControls(): TankControls {
  const controls: TankControls = {
    forward: keysDown.has('KeyW'),
    reverse: keysDown.has('KeyS'),
    turnLeft: keysDown.has('KeyA'),
    turnRight: keysDown.has('KeyD'),
    shoot: keysDown.has('Space'),
    boost: keysDown.has('ShiftLeft') || keysDown.has('ShiftRight') || keysDown.has('KeyE')
  };

  // Also check gamepad slot 0
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = gamepads[0];
  if (gp && gp.connected) {
    const dz = 0.25;
    const sx = gp.axes[0] ?? 0;
    const sy = gp.axes[1] ?? 0;
    if (sx < -dz || gp.buttons[14]?.pressed) controls.turnLeft = true;
    if (sx > dz || gp.buttons[15]?.pressed) controls.turnRight = true;
    if (sy < -dz || gp.buttons[12]?.pressed) controls.forward = true;
    if (sy > dz || gp.buttons[13]?.pressed) controls.reverse = true;
    if (gp.buttons[0]?.pressed || gp.buttons[7]?.pressed) controls.shoot = true;
    if (gp.buttons[1]?.pressed || gp.buttons[6]?.pressed) controls.boost = true;
  }
  return controls;
}

function getP2LocalControls(): TankControls {
  const controls: TankControls = {
    forward: keysDown.has('ArrowUp'),
    reverse: keysDown.has('ArrowDown'),
    turnLeft: keysDown.has('ArrowLeft'),
    turnRight: keysDown.has('ArrowRight'),
    shoot: keysDown.has('KeyM') || keysDown.has('Enter') || keysDown.has('Numpad0'),
    boost: keysDown.has('Period') || keysDown.has('Slash')
  };

  // Gamepad slot 1
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = gamepads[1];
  if (gp && gp.connected) {
    const dz = 0.25;
    const sx = gp.axes[0] ?? 0;
    const sy = gp.axes[1] ?? 0;
    if (sx < -dz || gp.buttons[14]?.pressed) controls.turnLeft = true;
    if (sx > dz || gp.buttons[15]?.pressed) controls.turnRight = true;
    if (sy < -dz || gp.buttons[12]?.pressed) controls.forward = true;
    if (sy > dz || gp.buttons[13]?.pressed) controls.reverse = true;
    if (gp.buttons[0]?.pressed || gp.buttons[7]?.pressed) controls.shoot = true;
    if (gp.buttons[1]?.pressed || gp.buttons[6]?.pressed) controls.boost = true;
  }
  return controls;
}

// ===== Main Game Loop =====
let snapshotAccum = 0;

function loop(currentTime: number) {
  if (!loopRunning || !game) return;

  const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
  lastTime = currentTime;

  if (playMode === 'online-guest') {
    // GUEST: apply latest snapshot from host and render
    const myControls = getLocalControls();
    net.sendControls(myControls);

    if (net.latestSnapshot) {
      game.applySnapshot(net.latestSnapshot);
      // Update HUD
      if (game.onScoreChange) game.onScoreChange(game.p1Score, game.p2Score);
      if (game.onTimerChange) game.onTimerChange(
        Math.max(0, Math.ceil(game.suddenDeathTime)),
        game.suddenDeathTime < 10
      );
      if (game.onSuddenDeath) game.onSuddenDeath(game.suddenDeathActive);
      if (game.onWeaponChange) {
        game.onWeaponChange(
          game.p1.weapon + (game.p1.specialAmmo > 0 ? ` (${game.p1.specialAmmo})` : ''),
          game.p2.weapon + (game.p2.specialAmmo > 0 ? ` (${game.p2.specialAmmo})` : '')
        );
      }
      if (game.state === 'MATCH_OVER') {
        const winner = game.p1Score >= game.targetScore ? game.p1.name : game.p2.name;
        modalTitleEl.textContent = `${winner} WINS!`;
        modalSubtitleEl.textContent = `Score: Red ${game.p1Score} - ${game.p2Score} Blue`;
        matchModalEl.classList.remove('hidden');
      } else {
        matchModalEl.classList.add('hidden');
      }
    }

    // Smooth interpolation on guest (erases network jitter)
    game.interpolateGuest(dt);
    game.particles.update(dt);
    game.render(currentTime / 1000);

  } else if (playMode === 'online-host') {
    // HOST: run full simulation, use remote controls for P2
    const p1Controls = getLocalControls();
    const p2Controls = net.remoteControls;

    game.update(dt, p1Controls, p2Controls);
    game.render(currentTime / 1000);

    // Send snapshot to guest (~30 times per second for smooth low-latency motion)
    snapshotAccum += dt;
    if (snapshotAccum >= 0.033) {
      snapshotAccum = 0;
      net.sendSnapshot(game.buildSnapshot());
    }

    // Send new maze on round transitions
    if (game.state === 'COUNTDOWN' && game.countdownTimer > 3.0) {
      net.sendMaze(game.buildMazeData());
    }

  } else {
    // LOCAL: normal single-machine play
    const p1Controls = getLocalControls();
    const p2Controls = (playMode === 'local-2p') ? getP2LocalControls() : getLocalControls();

    game.update(dt, p1Controls, p2Controls);
    game.render(currentTime / 1000);
  }

  requestAnimationFrame(loop);
}

// ===== Lobby Button Events =====
btnLocal2P.addEventListener('click', () => {
  startGame('local-2p');
});

btnVsAI.addEventListener('click', () => {
  startGame('vs-ai');
});

btnOnlineHost.addEventListener('click', async () => {
  showLobbyPanel('host');
  roomCodeDisplay.textContent = '...';

  try {
    const code = await net.hostGame();
    roomCodeDisplay.textContent = code;

    // Click to copy
    roomCodeDisplay.onclick = () => {
      navigator.clipboard.writeText(code).catch(() => {});
      roomCodeDisplay.style.color = '#ffaa00';
      setTimeout(() => { roomCodeDisplay.style.color = ''; }, 500);
    };

    net.onConnect = () => {
      startGame('online-host');
      pingBadgeEl.classList.remove('hidden');
      pingBadgeEl.textContent = '🌐 CONNECTED';
    };

    net.onPing = (ms) => {
      pingBadgeEl.classList.remove('hidden');
      pingBadgeEl.textContent = `🟢 PING: ${ms}ms`;
    };

    net.onError = (msg) => {
      roomCodeDisplay.textContent = 'ERROR';
      console.error(msg);
    };
  } catch {
    roomCodeDisplay.textContent = 'FAIL';
  }
});

btnOnlineJoin.addEventListener('click', () => {
  showLobbyPanel('join');
  joinCodeInput.value = '';
  joinCodeInput.focus();
});

btnJoinConnect.addEventListener('click', async () => {
  const code = joinCodeInput.value.trim().toUpperCase();
  if (code.length < 4) {
    joinError.textContent = 'Enter a valid room code.';
    joinError.classList.remove('hidden');
    return;
  }

  showLobbyPanel('connecting');

  net.onError = (msg) => {
    showLobbyPanel('join');
    joinError.textContent = msg;
    joinError.classList.remove('hidden');
  };

  try {
    await net.joinGame(code);

    // Wait for maze data before starting
    net.onMazeReceived = () => {
      startGame('online-guest');
      pingBadgeEl.classList.remove('hidden');

      if (net.latestMaze && game) {
        game.applyMazeData(net.latestMaze);
      }
    };

    net.onPing = (ms) => {
      pingBadgeEl.classList.remove('hidden');
      pingBadgeEl.textContent = `🟢 PING: ${ms}ms`;
    };

    net.onDisconnect = (reason) => {
      disconnectBanner.classList.remove('hidden');
    };

    // If we already have maze data, start immediately
    if (net.latestMaze) {
      startGame('online-guest');
      if (game) game.applyMazeData(net.latestMaze);
    }
  } catch {
    showLobbyPanel('join');
  }
});

joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoinConnect.click();
});

// Cancel buttons
btnHostCancel.addEventListener('click', () => { net.disconnect(); showLobbyPanel('modes'); });
btnJoinCancel.addEventListener('click', () => showLobbyPanel('modes'));
btnConnectingCancel.addEventListener('click', () => { net.disconnect(); showLobbyPanel('modes'); });

// In-game buttons
btnNextRound.addEventListener('click', () => {
  if (!game) return;
  game.resetMatch();
  matchModalEl.classList.add('hidden');
  if (playMode === 'online-host') {
    net.sendMaze(game.buildMazeData());
  }
});

btnBackToLobby.addEventListener('click', goToLobby);
btnLobbyReturn.addEventListener('click', goToLobby);
btnDisconnectLobby.addEventListener('click', goToLobby);

btnToggleSound.addEventListener('click', () => {
  sound.enabled = !sound.enabled;
  soundStateTextEl.textContent = sound.enabled ? 'ON' : 'OFF';
});

btnRestartMatch.addEventListener('click', () => {
  if (!game) return;
  game.resetMatch();
  matchModalEl.classList.add('hidden');
  if (playMode === 'online-host') {
    net.sendMaze(game.buildMazeData());
  }
});

// Handle disconnect during online play
net.onDisconnect = () => {
  if (playMode === 'online-host' || playMode === 'online-guest') {
    disconnectBanner.classList.remove('hidden');
  }
};

// Window resize
window.addEventListener('resize', () => {
  if (game) game.resizeCanvas();
});
