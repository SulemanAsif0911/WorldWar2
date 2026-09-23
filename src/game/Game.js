import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GameMap } from './Map.js';
import { PlayerController } from './Player.js';
import { RemotePlayerManager } from './RemotePlayer.js';
import { WeaponSystem } from './WeaponSystem.js';
import { Input } from './Input.js';
import { Network } from './Network.js';
import { WEAPONS, getWeapon } from './WeaponsData.js';

export class Game {
  constructor(){
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.map = null;
    this.player = null;
    this.remoteManager = null;
    this.weaponSystem = null;
    this.input = null;
    this.network = null;

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.selectedWeapon = 0;
    this.playerName = 'Soldier';
    this.settings = {
      sensitivity: 1.0,
      adsSensitivity: 0.7,
      invertY: false,
      crosshairType: 'cross',
      crosshairColor: '#ffffff',
      crosshairSize: 16,
      crosshairOpacity: 0.9,
      fov: 80,
      graphics: 'medium',
      shadows: true,
      ao: true,
      volume: 0.8
    };

    this.isDeployed = false;
    this.isPaused = false;
    this.killStreak = 0;
    this.lastKillTime = 0;

    this.bullets = []; // tracers
    this.decals = [];

    this.fps = 60;
    this.frameCount = 0;
    this.lastFpsUpdate = 0;
  }

  async init(){
    this.setupDOM();
    this.setupThree();
    this.setupInput();
    this.setupNetwork();
    this.loadSettings();
    this.setupUI();
    await this.loadAssets();
    this.animate();
  }

  setupDOM(){
    this.canvas = document.getElementById('game-canvas');
    this.loadingScreen = document.getElementById('loading-screen');
    this.mainMenu = document.getElementById('main-menu');
    this.hud = document.getElementById('hud');
    this.loadingProgress = document.getElementById('loading-progress');
    this.loadingText = document.getElementById('loading-text');
  }

  setupThree(){
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e13);
    this.scene.fog = new THREE.Fog(0x0a0e13, 30, 120);

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth/window.innerHeight, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference:'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.graphics==='ultra'?2: this.settings.graphics==='high'?1.5:1));
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // Lights - detailed for ruins
    const ambient = new THREE.AmbientLight(0x8a9bb0, 0.6);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff5e6, 1.2);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048,2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 150;
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.sun = sun;

    const hemi = new THREE.HemisphereLight(0x8aa0ff, 0x2a1a0a, 0.4);
    this.scene.add(hemi);

    window.addEventListener('resize', ()=>{
      this.camera.aspect = window.innerWidth/window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setupInput(){
    this.input = new Input();
    this.input.sensitivity = this.settings.sensitivity;
    this.input.adsSensitivity = this.settings.adsSensitivity;
    this.input.invertY = this.settings.invertY;

    // Prevent context menu on right click
    this.canvas.addEventListener('contextmenu', e=>e.preventDefault());
  }

  setupNetwork(){
    this.network = new Network();
    this.network.on('welcome', (data)=>{
      console.log('[Game] Welcome', data);
      document.getElementById('player-count').textContent = data.players.length+1;
      data.players.forEach(p=>{
        if(this.remoteManager) this.remoteManager.addPlayer(p);
      });
      this.updateScoreboard();
    });
    this.network.on('player-joined', (p)=>{
      console.log('[Game] Player joined', p);
      if(this.remoteManager) this.remoteManager.addPlayer(p);
      this.addKillfeed(`${p.name} joined the arena`, '#2ecc71');
      this.updateScoreboard();
      document.getElementById('player-count').textContent = this.network.players.size+1;
    });
    this.network.on('player-left', (id)=>{
      if(this.remoteManager) this.remoteManager.removePlayer(id);
      this.updateScoreboard();
      document.getElementById('player-count').textContent = this.network.players.size+1;
    });
    this.network.on('players-update', (players)=>{
      players.forEach(p=>{
        if(p.id===this.network.id) return;
        if(this.remoteManager) this.remoteManager.updatePlayer(p);
      });
      this.updateScoreboard();
      document.getElementById('hud-players').textContent = `${players.length+1} PLAYERS`;
    });
    this.network.on('shoot', (data)=>{
      if(data.id===this.network.id) return;
      // Show tracer for remote shot
      this.addTracer(data.origin, data.dir, data.weapon);
    });
    this.network.on('hit', (data)=>{
      console.log('[Game] Hit', data);
      if(data.targetId===this.network.id){
        // We got hit
        const dmg = data.damage;
        this.player.takeDamage(dmg);
        this.updateHealthHUD();
        this.showHitmarker(false);
        if(data.killed){
          this.handleDeath(data.attackerId);
        }
      } else if(data.attackerId===this.network.id){
        // We hit someone
        this.showHitmarker(true);
        if(data.killed){
          this.killStreak++;
          this.lastKillTime = performance.now();
          const target = this.network.players.get(data.targetId);
          const weapon = getWeapon(data.weapon);
          this.addKillfeed(`You eliminated ${target?.name||'Enemy'} [${weapon.short}]`, '#ff3b30');
          this.showKillstreak();
          this.updateScoreboard();
        }
      }

      // Update remote player health visuals
      if(this.remoteManager){
        const rp = this.remoteManager.players.get(data.targetId);
        if(rp){
          rp.data.health = data.health;
          rp.data.alive = !data.killed;
        }
      }
    });
    this.network.on('respawn', (data)=>{
      if(this.remoteManager){
        const p = this.remoteManager.players.get(data.id);
        if(p){
          p.data.alive = true;
          p.data.health = 100;
          p.targetPos.set(data.pos.x, data.pos.y, data.pos.z);
          p.currentPos.copy(p.targetPos);
          p.group.visible = true;
        }
      }
    });
    this.network.on('chat', (msg)=>{
      this.addChatMessage(msg.name, msg.text);
    });

    this.network.connect().catch(e=>console.error(e));
  }

  loadSettings(){
    try{
      const saved = JSON.parse(localStorage.getItem('ww2_settings')||'{}');
      this.settings = { ...this.settings, ...saved };
    }catch{}
    // Apply
    this.applySettings();
  }

  saveSettings(){
    localStorage.setItem('ww2_settings', JSON.stringify(this.settings));
  }

  applySettings(){
    if(this.camera){
      this.camera.fov = this.settings.fov;
      this.camera.updateProjectionMatrix();
    }
    if(this.renderer){
      this.renderer.shadowMap.enabled = this.settings.shadows;
      let ratio = 1;
      if(this.settings.graphics==='low') ratio = 0.75;
      else if(this.settings.graphics==='medium') ratio = 1;
      else if(this.settings.graphics==='high') ratio = 1.25;
      else if(this.settings.graphics==='ultra') ratio = Math.min(2, window.devicePixelRatio);
      this.renderer.setPixelRatio(ratio);
    }
    if(this.input){
      this.input.sensitivity = this.settings.sensitivity;
      this.input.adsSensitivity = this.settings.adsSensitivity;
      this.input.invertY = this.settings.invertY;
    }
    this.updateCrosshair();
  }

  setupUI(){
    // Weapon select grid
    const grid = document.querySelector('#weapon-select .weapons-grid');
    const ingameGrid = document.getElementById('ingame-weapons-grid');
    [grid, ingameGrid].forEach(g=>{
      if(!g) return;
      g.innerHTML = '';
      WEAPONS.forEach(w=>{
        const card = document.createElement('div');
        card.className = 'weapon-card';
        card.dataset.weapon = w.id;
        card.innerHTML = `
          <div class="weapon-card-img" style="color:${w.color}">${w.icon}</div>
          <h4>${w.name}</h4>
          <p>${w.desc}</p>
          <div class="weapon-card-stats">
            <span>DMG ${w.damage}</span><span>${w.magSize} MAG</span><span>${w.rpm} RPM</span>
          </div>
        `;
        card.addEventListener('click', ()=>{
          this.selectWeapon(w.id);
        });
        card.addEventListener('mouseenter', ()=>{
          this.showWeaponDetail(w.id);
        });
        g.appendChild(card);
      });
    });

    this.selectWeapon(0);
    this.showWeaponDetail(0);

    // Main menu buttons
    document.querySelectorAll('.menu-btn[data-action]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const action = btn.dataset.action;
        if(action==='deploy') this.deploy();
        else if(action==='settings') this.openModal('settings-modal');
        else if(action==='controls') this.openModal('controls-modal');
        else if(action==='credits') this.openModal('credits-modal');
      });
    });

    // Close modals
    document.querySelectorAll('.close-modal').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.close;
        document.getElementById(id).classList.remove('active');
      });
    });

    // Settings controls
    const bindRange = (id, key, displayId, parser = v=>parseFloat(v))=>{
      const el = document.getElementById(id);
      const disp = document.getElementById(displayId);
      if(!el) return;
      el.value = this.settings[key];
      if(disp) disp.textContent = el.value;
      el.addEventListener('input', ()=>{
        const val = parser(el.value);
        this.settings[key]=val;
        if(disp) disp.textContent = el.type==='range' && key!=='volume' ? val : (key==='volume'? Math.round(val*100)+'%' : val);
        this.applySettings();
        this.saveSettings();
      });
    };
    bindRange('set-sensitivity','sensitivity','set-sensitivity-v');
    bindRange('set-ads-sens','adsSensitivity','set-ads-sens-v');
    bindRange('set-crosshair-size','crosshairSize','set-crosshair-size-v', v=>parseInt(v));
    bindRange('set-crosshair-opacity','crosshairOpacity','set-crosshair-opacity-v');
    bindRange('set-fov','fov','set-fov-v', v=>parseInt(v));
    bindRange('set-volume','volume','set-volume-v', v=>parseFloat(v));

    const invertEl = document.getElementById('set-invert');
    if(invertEl){
      invertEl.checked = this.settings.invertY;
      invertEl.addEventListener('change', ()=>{
        this.settings.invertY = invertEl.checked;
        this.applySettings(); this.saveSettings();
      });
    }

    const crossType = document.getElementById('set-crosshair-type');
    if(crossType){
      crossType.value = this.settings.crosshairType;
      crossType.addEventListener('change', ()=>{
        this.settings.crosshairType = crossType.value;
        this.applySettings(); this.saveSettings();
      });
    }
    const crossColor = document.getElementById('set-crosshair-color');
    if(crossColor){
      crossColor.value = this.settings.crosshairColor;
      crossColor.addEventListener('input', ()=>{
        this.settings.crosshairColor = crossColor.value;
        this.applySettings(); this.saveSettings();
      });
    }
    const graphics = document.getElementById('set-graphics');
    if(graphics){
      graphics.value = this.settings.graphics;
      graphics.addEventListener('change', ()=>{
        this.settings.graphics = graphics.value;
        this.applySettings(); this.saveSettings();
      });
    }
    const shadows = document.getElementById('set-shadows');
    if(shadows){
      shadows.checked = this.settings.shadows;
      shadows.addEventListener('change', ()=>{
        this.settings.shadows = shadows.checked;
        this.applySettings(); this.saveSettings();
      });
    }

    // Player name
    const nameInput = document.getElementById('player-name');
    if(nameInput){
      const savedName = localStorage.getItem('ww2_playerName')||'Soldier';
      nameInput.value = savedName;
      this.playerName = savedName;
      nameInput.addEventListener('input', ()=>{
        this.playerName = nameInput.value || 'Soldier';
        localStorage.setItem('ww2_playerName', this.playerName);
      });
    }

    // In-game weapon menu
    document.getElementById('ingame-close')?.addEventListener('click', ()=> this.closeIngameWeaponMenu());
    document.getElementById('ingame-respawn')?.addEventListener('click', ()=>{
      this.respawnWithSelected();
    });

    // Chat
    const chatInput = document.getElementById('chat-input');
    window.addEventListener('keydown', (e)=>{
      if(e.key==='Enter'){
        if(document.activeElement===chatInput){
          const text = chatInput.value.trim();
          if(text){
            this.network.chat(text);
            this.addChatMessage(this.playerName, text, true);
          }
          chatInput.value='';
          chatInput.classList.remove('active');
          chatInput.blur();
          if(this.isDeployed && this.input) this.input.lock(this.canvas);
        } else {
          // Open chat if deployed
          if(this.isDeployed && !this.isPaused){
            chatInput.classList.add('active');
            chatInput.focus();
            document.exitPointerLock();
          }
        }
      }
      if(e.key==='Escape'){
        if(document.activeElement===chatInput){
          chatInput.classList.remove('active');
          chatInput.blur();
          if(this.isDeployed) this.input.lock(this.canvas);
        } else {
          if(this.isDeployed){
            if(document.getElementById('ingame-weapon-menu').classList.contains('active')){
              this.closeIngameWeaponMenu();
            } else {
              this.pauseGame();
            }
          }
        }
      }
      if(e.key.toLowerCase()==='b' && this.isDeployed){
        if(document.activeElement===chatInput) return;
        const menu = document.getElementById('ingame-weapon-menu');
        if(menu.classList.contains('active')){
          this.closeIngameWeaponMenu();
        } else {
          this.openIngameWeaponMenu();
        }
      }
      if(e.key.toLowerCase()==='r' && this.isDeployed){
        if(this.weaponSystem) this.weaponSystem.reload();
      }
      if(e.key==='Tab'){
        e.preventDefault();
        if(this.isDeployed){
          document.getElementById('scoreboard').classList.add('active');
        }
      }
    });
    window.addEventListener('keyup', (e)=>{
      if(e.key==='Tab'){
        document.getElementById('scoreboard').classList.remove('active');
      }
    });

    // Respawn button
    document.getElementById('respawn-now')?.addEventListener('click', ()=>{
      this.respawn();
    });
    window.addEventListener('keydown', (e)=>{
      if(e.key===' ' && !this.player?.alive && this.isDeployed){
        this.respawn();
      }
    });

    // Canvas click to lock
    this.canvas.addEventListener('click', ()=>{
      if(this.isDeployed && !this.isPaused && !document.getElementById('ingame-weapon-menu').classList.contains('active')){
        this.input.lock(this.canvas);
      }
    });

    // Host IP display
    const hostEl = document.getElementById('host-ip');
    if(hostEl){
      hostEl.textContent = location.host || 'localhost:3000';
    }
  }

  updateCrosshair(){
    const ch = document.getElementById('crosshair');
    if(!ch) return;
    ch.className = `crosshair ${this.settings.crosshairType}`;
    ch.style.color = this.settings.crosshairColor;
    ch.style.opacity = this.settings.crosshairOpacity;
    ch.style.width = this.settings.crosshairSize+'px';
    ch.style.height = this.settings.crosshairSize+'px';
  }

  selectWeapon(id){
    this.selectedWeapon = id;
    document.querySelectorAll('.weapon-card').forEach(c=>{
      c.classList.toggle('selected', parseInt(c.dataset.weapon)===id);
    });
    this.showWeaponDetail(id);
  }

  showWeaponDetail(id){
    const w = getWeapon(id);
    const nameEl = document.getElementById('wd-name');
    if(!nameEl) return;
    nameEl.textContent = w.name;
    document.getElementById('wd-desc').textContent = w.desc;
    const setBar = (barId, valId, value, max, suffix='')=>{
      const bar = document.getElementById(barId);
      const v = document.getElementById(valId);
      if(bar) bar.style.width = (value/max*100)+'%';
      if(v) v.textContent = value+suffix;
    };
    setBar('wd-dmg','wd-dmg-v', w.damage, 100);
    setBar('wd-rpm','wd-rpm-v', w.rpm, 800);
    setBar('wd-range','wd-range-v', w.range, 300, 'm');
    setBar('wd-mag','wd-mag-v', w.magSize, 35);
    setBar('wd-zoom','wd-zoom-v', w.zoom, 5, 'x');
  }

  openModal(id){
    document.getElementById(id).classList.add('active');
  }

  openIngameWeaponMenu(){
    document.getElementById('ingame-weapon-menu').classList.add('active');
    document.exitPointerLock();
    this.isPaused = true;
  }
  closeIngameWeaponMenu(){
    document.getElementById('ingame-weapon-menu').classList.remove('active');
    this.isPaused = false;
    if(this.isDeployed) this.input.lock(this.canvas);
  }

  async loadAssets(){
    this.updateLoading(0, 'Initializing WW2 Arena...');
    this.map = new GameMap(this.scene);
    this.remoteManager = new RemotePlayerManager(this.scene, this.map);

    // Load map
    this.updateLoading(0.1, 'Loading Traiano Ruins (36MB)...');
    try{
      await this.map.load((p)=>{
        this.updateLoading(0.1 + p*0.5, `Loading ruins... ${Math.round(p*100)}%`);
      });
    }catch(e){
      console.error('Map load failed, using fallback ground', e);
      // Fallback ground
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(100,100), new THREE.MeshStandardMaterial({color:0x3a3a3a}));
      ground.rotation.x = -Math.PI/2;
      ground.receiveShadow = true;
      this.scene.add(ground);
      this.map.spawnPoints = [{x:0,y:2,z:0},{x:10,y:2,z:10},{x:-10,y:2,z:-10}];
      this.map.bvhMeshes = [ground];
      this.map.colliders = [ground];
      ground.geometry.computeBoundsTree?.();
    }

    // Load soldier for remotes
    this.updateLoading(0.65, 'Loading soldier model...');
    await this.remoteManager.loadSoldierModel((p)=>{
      this.updateLoading(0.65 + p*0.15, `Loading soldier... ${Math.round(p*100)}%`);
    });

    // Load weapons
    this.updateLoading(0.8, 'Loading WW2 weapons...');
    this.weaponSystem = new WeaponSystem(this.scene, this.camera, this.map, this.remoteManager);
    this.weaponSystem.onAmmoChange = (state)=> this.updateAmmoHUD(state);
    this.weaponSystem.onShoot = ({origin, direction, weapon, hit})=>{
      this.addTracer(origin, direction, weapon.id);
      if(hit){
        if(hit.type==='map'){
          this.addDecal(hit.point, hit.normal);
        } else if(hit.type==='player'){
          // Hit player, send to server
          this.network.hit(hit.player.id, weapon.damage);
        }
      }
    };

    await this.weaponSystem.loadWeapons((p)=>{
      this.updateLoading(0.8 + p*0.15, `Loading weapons... ${Math.round(p*100)}%`);
    });

    // Player controller
    this.player = new PlayerController(this.camera, this.map, this.input, this.weaponSystem);

    this.updateLoading(1, 'Ready to deploy!');
    setTimeout(()=>{
      this.loadingScreen.classList.remove('active');
      this.mainMenu.classList.add('active');
      this.updateCrosshair();
    }, 500);

    // Tips rotation
    const tips = [
      'Use B to change weapons mid-battle',
      'Right click to scope - Kar98k has 4.5x zoom',
      'Crouch for accuracy, sprint for speed',
      'Control the upper terraces for sniper advantage',
      'Headshots deal 2x damage',
      'Host shares IP:3000 - no install needed for friends'
    ];
    let tipIdx=0;
    setInterval(()=>{
      tipIdx = (tipIdx+1)%tips.length;
      const el = document.getElementById('loading-tip');
      if(el) el.textContent = tips[tipIdx];
    }, 3000);
  }

  updateLoading(progress, text){
    if(this.loadingProgress) this.loadingProgress.style.width = (progress*100)+'%';
    if(this.loadingText) this.loadingText.textContent = text;
  }

  deploy(){
    const spawn = this.map.getRandomSpawn();
    this.player.spawn(spawn);
    this.playerName = document.getElementById('player-name').value || 'Soldier';
    this.weaponSystem.equip(this.selectedWeapon);
    this.weaponSystem.initAmmo(); // reset ammo on deploy? Keep reserve? Reset for fresh

    this.isDeployed = true;
    this.mainMenu.classList.remove('active');
    this.hud.classList.add('active');
    this.input.lock(this.canvas);

    // Network join
    this.network.join(this.playerName, this.selectedWeapon, spawn);

    this.updateHealthHUD();
    this.updateAmmoHUD(this.weaponSystem.getAmmoState());

    console.log('[Game] Deployed');
  }

  respawnWithSelected(){
    this.weaponSystem.equip(this.selectedWeapon);
    this.respawn();
    this.closeIngameWeaponMenu();
  }

  respawn(){
    if(this.player.alive) return;
    const spawn = this.map.getRandomSpawn();
    this.player.spawn(spawn);
    this.weaponSystem.initAmmo();
    this.weaponSystem.equip(this.selectedWeapon);
    this.network.respawn(spawn, this.selectedWeapon);
    document.getElementById('death-screen').classList.remove('active');
    this.updateHealthHUD();
    this.isPaused = false;
    this.input.lock(this.canvas);
  }

  pauseGame(){
    if(this.isPaused){
      this.isPaused = false;
      this.input.lock(this.canvas);
      document.getElementById('scoreboard').classList.remove('active');
    } else {
      this.isPaused = true;
      document.exitPointerLock();
      this.mainMenu.classList.add('active');
      this.hud.classList.remove('active');
      this.isDeployed = false;
    }
  }

  handleDeath(killerId){
    this.killStreak = 0;
    const killer = this.network.players.get(killerId);
    const killerName = killer?.name || 'Enemy';
    document.getElementById('death-killer').textContent = `Killed by ${killerName} [${getWeapon(killer?.weapon||0).short}]`;
    document.getElementById('death-screen').classList.add('active');
    document.exitPointerLock();

    // Auto respawn in 3 sec
    let timer = 3;
    const timerEl = document.getElementById('respawn-timer');
    const interval = setInterval(()=>{
      timer--;
      if(timerEl) timerEl.textContent = timer;
      if(timer<=0){
        clearInterval(interval);
        if(!this.player.alive) this.respawn();
      }
    }, 1000);
  }

  addTracer(origin, direction, weaponId){
    const w = getWeapon(weaponId);
    const length = w.range;
    const end = origin.clone().add(direction.clone().multiplyScalar(length));

    // Check map for end point to shorten tracer
    if(this.map){
      const hit = this.map.raycast(origin, direction, length);
      if(hit){
        end.copy(hit.point);
      }
    }

    const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const mat = new THREE.LineBasicMaterial({ color: weaponId===2?0xffcc00:0xffffff, transparent:true, opacity:0.8 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.bullets.push({ mesh: line, life: 0.05 });

    // Muzzle flash at origin already handled for local, for remote add small light
    const light = new THREE.PointLight(0xffaa44, 2, 5);
    light.position.copy(origin);
    this.scene.add(light);
    setTimeout(()=>this.scene.remove(light), 50);
  }

  addDecal(point, normal){
    // Simple bullet hole decal - small dark circle
    const geo = new THREE.CircleGeometry(0.05, 6);
    const mat = new THREE.MeshBasicMaterial({ color:0x111111, transparent:true, opacity:0.8, side:THREE.DoubleSide });
    const decal = new THREE.Mesh(geo, mat);
    decal.position.copy(point);
    if(normal){
      // orient to normal
      const n = normal.clone ? normal.clone() : new THREE.Vector3(0,1,0);
      decal.lookAt(point.clone().add(n));
    }
    decal.position.add(normal ? normal.clone().multiplyScalar(0.01) : new THREE.Vector3(0,0.01,0));
    this.scene.add(decal);
    this.decals.push({ mesh: decal, life: 10 });
    if(this.decals.length>100){
      const old = this.decals.shift();
      this.scene.remove(old.mesh);
    }
  }

  showHitmarker(isHit){
    const el = document.getElementById('hitmarker');
    if(!el) return;
    el.classList.add('active');
    el.style.color = isHit ? '#ffcc00' : '#ffffff';
    el.textContent = isHit ? '✕' : '·';
    setTimeout(()=>el.classList.remove('active'), 150);
  }

  addKillfeed(text, color='#fff'){
    const feed = document.getElementById('killfeed');
    if(!feed) return;
    const div = document.createElement('div');
    div.className = 'killfeed-item';
    div.textContent = text;
    div.style.borderLeftColor = color;
    feed.appendChild(div);
    setTimeout(()=>{ div.remove(); }, 4000);
  }

  showKillstreak(){
    const el = document.getElementById('killstreak');
    if(!el) return;
    if(this.killStreak>=2){
      el.textContent = `${this.killStreak} KILL STREAK!`;
      el.style.opacity = '1';
      setTimeout(()=>el.style.opacity='0', 2000);
    }
  }

  addChatMessage(name, text, isSelf=false){
    const box = document.getElementById('chat-messages');
    if(!box) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<b>${isSelf?'[YOU] ':''}${name}:</b> ${text}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    setTimeout(()=>div.remove(), 8000);
  }

  updateHealthHUD(){
    const fill = document.getElementById('health-fill');
    const txt = document.getElementById('health-text');
    if(fill) fill.style.width = this.player.health+'%';
    if(txt) txt.textContent = Math.round(this.player.health)+' HP';
    if(fill){
      fill.style.background = this.player.health>60 ? 'linear-gradient(90deg, #2ecc71, #27ae60)' : this.player.health>30 ? 'linear-gradient(90deg, #ffcc00, #ffaa00)' : 'linear-gradient(90deg, #ff3b30, #ff6b60)';
    }
  }

  updateAmmoHUD(state){
    if(!state) return;
    const cur = document.getElementById('ammo-current');
    const res = document.getElementById('ammo-reserve');
    const name = document.getElementById('weapon-name-hud');
    const reload = document.getElementById('reload-indicator');
    if(cur) cur.textContent = state.current;
    if(res) res.textContent = state.reserve;
    if(name) name.textContent = state.weapon.name;
    if(reload) reload.classList.toggle('active', state.reloading);
  }

  updateScoreboard(){
    const body = document.getElementById('scoreboard-body');
    if(!body) return;
    const players = [...this.network.players.values()];
    // Add self
    if(this.network.id && this.player){
      players.push({
        id: this.network.id,
        name: this.playerName,
        kills: this.network.players.get(this.network.id)?.kills || 0, // actually server tracks, but we have local? We'll use network's own? For self, kills tracked via server but we can get from network.players? self not in map, so we need to track locally? We'll use killStreak? Better: store kills in network's self? Let's just use local kill count approximated via server updates? For simplicity, show kills from network if exists, else 0
        deaths: 0,
        weapon: this.selectedWeapon,
        health: this.player.health,
        alive: this.player.alive
      });
    }
    // Sort by kills
    players.sort((a,b)=> (b.kills||0)-(a.kills||0));

    body.innerHTML = '';
    players.forEach(p=>{
      const tr = document.createElement('tr');
      const isSelf = p.id===this.network.id;
      tr.style.background = isSelf ? 'rgba(255,204,0,0.1)' : '';
      tr.innerHTML = `
        <td>${p.name}${isSelf?' (YOU)':''}</td>
        <td>${p.kills||0}</td>
        <td>${p.deaths||0}</td>
        <td>${getWeapon(p.weapon||0).short}</td>
        <td style="color:${p.alive?'#2ecc71':'#ff3b30'}">${p.alive?'ALIVE':'DOWN'}</td>
      `;
      body.appendChild(tr);
    });
  }

  animate(){
    requestAnimationFrame(()=>this.animate());

    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.frameCount++;
    const now = performance.now();
    if(now - this.lastFpsUpdate > 500){
      this.fps = Math.round(this.frameCount*1000/(now-this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = now;
      const fpsEl = document.getElementById('hud-fps');
      if(fpsEl) fpsEl.textContent = `${this.fps} FPS`;
    }

    if(this.isDeployed && !this.isPaused){
      // Player update
      if(this.player) this.player.update(delta);

      // Weapon shooting
      if(this.input.mouse.left && this.input.locked && this.player?.alive){
        const result = this.weaponSystem.shoot(this.camera, this.player.isAiming);
        if(result){
          this.network.shoot(result.origin, result.direction, result.weapon.id);
          // Handle hit locally for instant feedback, but server authoritative for damage
          if(result.hit && result.hit.type==='player'){
            // Don't call hit directly, let server handle, but show hitmarker
            this.showHitmarker(true);
          }
        }
      }

      // Scoping FOV
      const targetFov = this.player.isAiming ? this.settings.fov / getWeapon(this.selectedWeapon).zoom : this.settings.fov;
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, delta*10);
      this.camera.updateProjectionMatrix();

      const scopeOverlay = document.getElementById('scope-overlay');
      if(scopeOverlay){
        const isSniper = this.selectedWeapon===2;
        scopeOverlay.classList.toggle('active', this.player.isAiming && isSniper);
      }

      // Crosshair visibility
      const crosshair = document.getElementById('crosshair');
      if(crosshair){
        crosshair.style.display = this.player.isAiming ? 'none' : 'block';
        // Dynamic crosshair spread based on movement
        const moving = this.input.isDown('w')||this.input.isDown('a')||this.input.isDown('s')||this.input.isDown('d');
        const scale = this.player.isSprinting ? 1.8 : moving ? 1.3 : 1;
        crosshair.style.transform = `translate(-50%,-50%) scale(${scale})`;
        crosshair.classList.toggle('aiming', this.player.isAiming);
      }

      // Stamina HUD
      const staminaFill = document.getElementById('stamina-fill');
      if(staminaFill) staminaFill.style.width = this.player.stamina+'%';

      // Network update 20hz
      if(now - this.player.lastNetworkUpdate > 50){
        this.player.lastNetworkUpdate = now;
        const state = this.player.getStateForNetwork();
        state.weapon = this.selectedWeapon;
        this.network.update(state);
      }

      // Killstreak reset
      if(this.killStreak>0 && now - this.lastKillTime > 8000){
        this.killStreak = 0;
      }
    }

    // Remote players
    if(this.remoteManager) this.remoteManager.update(delta);

    // Bullets cleanup
    this.bullets = this.bullets.filter(b=>{
      b.life -= delta;
      if(b.life<=0){
        this.scene.remove(b.mesh);
        return false;
      }
      b.mesh.material.opacity = b.life*10;
      return true;
    });

    this.decals = this.decals.filter(d=>{
      d.life -= delta;
      return d.life>0;
    });

    // Render
    if(this.renderer && this.scene && this.camera){
      this.renderer.render(this.scene, this.camera);
    }
  }
}
