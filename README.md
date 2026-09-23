# WW2 RUINS ARENA - LAN Multiplayer FPS

**Made by Suleman Asif**

Free For All Deathmatch in the historic Mercati di Traiano Ruins. One host, many players, same network, just a browser.

---

## 🎮 How to Play (LAN)

### Host (1 person):
```bash
npm install
npm run build
npm run dev -H 10.0.0.12 -p 3000
# Replace 10.0.0.12 with your LAN IP (ipconfig / ifconfig)
```

### Friends (everyone else on same WiFi/LAN):
- Open browser
- Enter: `http://10.0.0.12:3000`
- No install needed!
- Choose weapon → DEPLOY → Fight!

---

## 🗺️ Map - Mercati di Traiano Ruins

Detailed 36MB photogrammetry scan of ancient Roman market ruins:

- **Lower Market Halls**: Tight CQB corridors, pillars for cover, dark shadows. Perfect for Thompson & MP40.
- **Upper Terraces**: Open sniper lines, broken columns, elevated advantage. Kar98k dominates.
- **Central Forum**: Large open area, high risk/reward, crossfire zone. All weapons viable.
- **Archways & Stairs**: Vertical gameplay, flank routes, ambush spots.

**Map detailing:**
- Realistic lighting: directional sun with soft shadows (2048), ambient + hemisphere, 4 point lights inside ruins
- Fog for depth (30-120 units)
- BVH accelerated collision (three-mesh-bvh) for precise wall/ground detection
- Spawn points distributed across perimeter and center

---

## 🚶 Movement - Detailed

Focus on fluid, momentum-based FPS movement:

- **WASD**: Strafe with momentum preservation, acceleration 25 on ground / 8 in air
- **Mouse**: Yaw/Pitch with sensitivity settings, ADS sensitivity multiplier, invert Y option
- **Shift (Sprint)**: 7.2 m/s (vs 4.5 walk), stamina drain 18/sec, regen 22/sec, increased weapon bob & sway, FOV unchanged but camera bob intensifies
- **Ctrl/C (Crouch)**: Height 1.75m → 1.1m smooth lerp (10x speed), speed 2.2 m/s, reduced hitbox, accurate shots, stamina regen faster
- **Space (Jump)**: 5.5 jump force, gravity 14, air control, fall damage if velocity < -8, step-up 0.6m for small ledges
- **Head Bob**: Sine-based tied to speed, sprint 14Hz vs walk 10Hz, crouch 6Hz
- **Weapon Bob**: Independent sine, 8-12Hz based on sprint
- **Collision**: Capsule (radius 0.35m), 8-direction wall raycasts, ground raycast down, slide along walls, pushback
- **Stamina**: Sprint drains, walk/crouch regen, blocks sprint when <5

---

## 🔫 Weapons (All Free)

All 4 WW2 weapons from `ww2_weapons.glb` (4 meshes):

1. **M1 Garand** (Object_2)
   - Semi-auto, Damage 48, RPM 300, Range 120m, Mag 8/80, Zoom 1.6x, Spread 0.008
   - Iconic ping, mid-range king

2. **Thompson M1A1** (Object_3)
   - Auto, Damage 28, RPM 700, Range 50m, Mag 30/120, Zoom 1.25x, Spread 0.025
   - CQB beast, hip-fire

3. **Kar98k Sniper** (Object_4)
   - Bolt-action, Damage 95, RPM 45, Range 300m, Mag 5/30, Zoom 4.5x, Spread 0.001
   - One-shot head/chest, scope overlay with vignette

4. **MP40** (Object_5)
   - Auto, Damage 31, RPM 600, Range 60m, Mag 32/128, Zoom 1.35x, Spread 0.018
   - Balanced, smooth recoil

**Weapon detailing:**
- First-person meshes extracted from GLB, scaled, positioned per weapon (hip vs ADS)
- Recoil: 0.6-2.5 per weapon, recovery lerp
- Muzzle flash: cone mesh + point light, 40ms
- Tracers: line + light for remote shots
- Bullet decals: circle geometry on map hit, 10 sec lifetime, max 100
- Spread: ADS reduces 60%, movement increases (handled via player state)
- Reload: 1.9-3.2 sec, blocks shooting

---

## 🎯 Scoping (Right Mouse)

- Hold RMB to ADS
- FOV lerps: 80 → 80/zoom (e.g., 80/4.5=17.7 for Kar98k)
- Weapon moves to center: hip pos → ads pos lerp (aimProgress 0-1, 10x lerp)
- Crosshair hidden when aiming
- Sniper: full scope overlay (black vignette, circle border, h/v lines, dots)
- Non-sniper: slight zoom + weapon closer, no overlay

---

## 🎮 Main Menu

1. **Deploy**: Weapon selection grid (4 cards with stats, hover detail), Callsign input, server info, network help
2. **Settings**:
   - Sensitivity 0.1-3, ADS 0.1-2, Invert Y
   - Crosshair: type (cross/dot/circle/tactical), color, size 8-32, opacity 0.2-1
   - Graphics: low/medium/high/ultra (pixel ratio, shadows), FOV 60-110, shadows toggle, AO toggle
   - Audio: master volume
3. **Credits**: Made by Suleman Asif, map/weapon/soldier credits, hosting instructions, FREE FOR ALL badge
4. **Controls**: Detailed key bindings + map navigation guide

---

## ⌨️ Controls

- **WASD**: Move
- **Mouse**: Look
- **Left Click**: Shoot (hold for auto)
- **Right Click**: Scope / ADS
- **Shift**: Sprint
- **Ctrl/C**: Crouch
- **Space**: Jump
- **R**: Reload
- **B**: Weapon Menu (in-game, change anytime)
- **Esc**: Pause / Main Menu
- **Tab**: Scoreboard (hold)
- **Enter**: Chat

---

## 🌐 Network Architecture

- **Single Host**: One person runs `npm run dev -H IP -p 3000`
- **WebSocket**: `/ws` path on same HTTP server, no extra ports
- **Server**: Node `ws` library, in-memory player dict, 20Hz broadcast of all players
- **Messages**:
  - Client→Server: join, update (pos/rot/vel/crouch/sprint/aim/health/weapon/alive), shoot, hit, respawn, chat
  - Server→Client: welcome (id + existing players), player-joined, player-left, players-update (20Hz), shoot, hit, respawn, chat
- **Authoritative**: Server validates health, kills/deaths, but trusts client pos (LAN low latency)
- **Lag Compensation**: Client-side interpolation (lerp pos 10x, rot 8x), prediction for local player
- **Tracers**: Remote shoots broadcast to all
- **Hit**: Client raycasts remote players (box) + map (BVH), sends hit to server, server applies damage and broadcasts

---

## 🛠️ Tech Stack

- **Three.js 0.160**: Rendering, GLTFLoader, shadows, fog, tone mapping
- **three-mesh-bvh 0.7.8**: BVH for fast raycasts against 36MB ruins
- **ws 8.17**: WebSocket server
- **Vite 5**: Dev server, build, HMR
- **Express 4.19**: Production server (serves dist + WS)

---

## 📦 Scripts

- `npm run dev -H 10.0.0.12 -p 3000` → Dev server with WS (custom script parsing -H/-p)
- `npm run dev:vite` → Plain Vite (uses plugin from vite.config.js)
- `npm run build` → Build to dist
- `npm run preview` / `npm start` → Production server (Express + WS) serving dist

---

## 🎨 Graphics Settings Detail

- **Low**: pixelRatio 0.75, no shadows, no AO, fog 30-80
- **Medium**: ratio 1, shadows 1024, fog 30-120 (default balanced)
- **High**: ratio 1.25-1.5, shadows 2048, AO on, tone mapping ACES
- **Ultra**: ratio 2, shadows 2048, AO on, exposure 1.1, anisotropy 8 on map textures

---

## 🔧 Soldier & Weapons Assets

- **Soldier**: `Soldier by KolosStudios - XT8jgwSesV.glb` (382KB, 75 nodes, Armature|Standing animation) → used for remote players, with name tag sprite + health bar
- **Weapons**: `ww2_weapons.glb` (495KB, 4 meshes Object_2..5) → extracted for FP view, each with unique stats
- **Map**: `mercati_di_traiano_ruins.glb` (36MB, 14 meshes) → ruins, enhanced materials, BVH, collision

---

## 🆓 Free For All

- No paywall, no lootboxes, all weapons free from start
- Change weapon anytime with B
- Deathmatch: kill = +1, death = +1, respawn 3 sec (or Space)
- Killstreak: 2+ kills within 8 sec shows banner
- Killfeed: top-right, 4 sec
- Chat: Enter to open, Enter to send

---

## 📝 Credits

- **Made by Suleman Asif**
- Map: Mercati di Traiano Ruins (Sketchfab photogrammetry)
- Soldier: KolosStudios
- Weapons: WW2 Pack
- Engine: Three.js + WS LAN

Enjoy the battle, soldier! ⚔️

---

## 🐛 Troubleshooting

- **Port in use**: Change `-p 3001`
- **Friends can't connect**: Check firewall, ensure same WiFi, use `ipconfig` (Windows) or `ifconfig` (Mac/Linux) to get LAN IP
- **Map not loading**: Ensure `public/mercati_di_traiano_ruins.glb` exists (36MB)
- **WS not connecting**: Ensure host IP correct, not localhost for friends (use 192.168.x.x)
- **Low FPS**: Settings → Graphics → Low, FOV 80, shadows off
