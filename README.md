# Tank Arena: Ricochet Protocol 🎮

An enhanced, modern web evolution of the classic labyrinth tank battle game *Tank Trouble*. Built with TypeScript, HTML5 Canvas, Web Audio API, and PeerJS WebRTC peer-to-peer multiplayer.

![Tank Arena Screenshot](https://raw.githubusercontent.com/placeholder/tank-arena.png)

## 🚀 Game Modes
* **Local 2 Player**: Play with a friend on the same computer (keyboard or gamepads).
* **VS AI Bot**: Battle against "Laika 2.0", an AI bot capable of calculating 1-bounce trick shots and dodging incoming fire.
* **Online Multiplayer (P2P)**: Play across two different computers anywhere in the world! One player hosts and gets a 5-letter Room Code; the other enters the code to join. Zero server hosting required (direct WebRTC connection via PeerJS).

## 🎮 Controls
| Action | Player 1 (Red Tank) | Player 2 (Blue Tank) | Gamepad (P1 / P2) |
| :--- | :--- | :--- | :--- |
| **Move / Drive** | <kbd>W</kbd> (Forward) / <kbd>S</kbd> (Reverse) | <kbd>↑</kbd> (Forward) / <kbd>↓</kbd> (Reverse) | Left Stick / D-Pad |
| **Steer / Rotate** | <kbd>A</kbd> (Left) / <kbd>D</kbd> (Right) | <kbd>←</kbd> (Left) / <kbd>→</kbd> (Right) | Left Stick / D-Pad |
| **Shoot** | <kbd>Space</kbd> | <kbd>M</kbd> or <kbd>Enter</kbd> | <kbd>A</kbd> / Cross or Right Trigger |
| **Boost Dash** | <kbd>Shift</kbd> or <kbd>E</kbd> | <kbd>.</kbd> or <kbd>/</kbd> | <kbd>B</kbd> / Circle or Left Trigger |

## 🌟 Key Features
* **Glitch-Free Continuous Ricochet Physics**: Bullets never tunnel through walls even at high velocities. Standard bullets bounce continuously for a full 12-second fuse.
* **Destructible Walls & Sudden Death**: Amber brick walls crumble after absorbing 2 hits. After 35 seconds, outer arena tiles collapse inward into an electric void to eliminate campers.
* **Weapon Pickups**:
  * ⚡ **Laser Beam**: Instant beam that calculates up to 3 specular bounces and cuts through walls.
  * 💥 **Shotgun Flak**: 5-pellet spread that blankets tight corridors.
* **Retro Procedural Synthesizer**: Web Audio API generates all sound effects natively without any audio files.
* **Equal Driving Speed**: Backwards driving speed is 100% equal to forward speed for quick tactical evasions.
* **3-2-1 Countdown**: Synchronized pre-round countdown before each battle begins.

## 📦 How to Run Locally
1. Clone or download this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the local development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🌐 Deploy to GitHub Pages
This repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically builds and publishes the game to GitHub Pages:

1. Create a new repository on [GitHub](https://github.com/new).
2. Push this project:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of Tank Arena"
   git branch -M main
   git remote add origin https://github.com/<YOUR-USERNAME>/<YOUR-REPO-NAME>.git
   git push -u origin main
   ```
3. Go to your repository on GitHub:
   * **Settings** → **Pages**
   * Under **Build and deployment** > **Source**, select **GitHub Actions**.
4. Your game will be live at `https://<YOUR-USERNAME>.github.io/<YOUR-REPO-NAME>/`!
