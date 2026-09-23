#!/usr/bin/env node
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';

function parseArgs(){
  const args = process.argv.slice(2);
  let host = '0.0.0.0';
  let port = 3000;
  for(let i=0;i<args.length;i++){
    const a = args[i];
    if(a === '-H' || a === '--host' || a === '--H'){
      host = args[i+1]; i++;
    } else if(a.startsWith('--host=')){
      host = a.split('=')[1];
    } else if(a === '-p' || a === '--port'){
      port = parseInt(args[i+1],10); i++;
    } else if(a.startsWith('--port=')){
      port = parseInt(a.split('=')[1],10);
    }
  }
  return { host, port };
}

const { host, port } = parseArgs();
console.log(`\n[WW2 Arena] Starting dev server...`);
console.log(`[WW2 Arena] Host: ${host} | Port: ${port}`);
console.log(`[WW2 Arena] Players will join via: http://${host}:${port}  (or your LAN IP:${port})`);
console.log(`[WW2 Arena] WebSocket at ws://${host}:${port}/ws\n`);

const players = new Map();
let idCounter = 1;

const viteServer = await createServer({
  configFile: false,
  root: process.cwd(),
  publicDir: 'public',
  server: {
    host,
    port,
    strictPort: true,
    cors: true,
    hmr: { clientPort: 443 },
    // Allow preview hosts (e2b.app etc)
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
  preview: {
    host,
    port,
    cors: true,
  },
  assetsInclude: ['**/*.glb'],
});

// Allow all hosts for preview proxy
viteServer.config.server.allowedHosts = true;
viteServer.config.server.host = host;

const wss = new WebSocketServer({ noServer: true });

viteServer.httpServer?.on('upgrade', (req, socket, head)=>{
  if(req.url === '/ws' || req.url?.startsWith('/ws')){
    wss.handleUpgrade(req, socket, head, (ws)=>{
      wss.emit('connection', ws, req);
    });
  }
});

wss.on('connection', (ws)=>{
  const id = 'p_' + (idCounter++) + '_' + Math.random().toString(36).slice(2,6);
  ws._id = id;
  console.log(`[WW2] Player connected: ${id}`);

  ws.send(JSON.stringify({
    t: 'welcome',
    id,
    players: Array.from(players.values())
  }));

  ws.on('message', (data)=>{
    try{
      const msg = JSON.parse(data.toString());
      const id = ws._id;
      switch(msg.t){
        case 'join': {
          const p = {
            id,
            name: (msg.name || 'Soldier').slice(0,16),
            pos: msg.pos || {x:0,y:2,z:0},
            rot: msg.rot || {x:0,y:0,z:0},
            vel: {x:0,y:0,z:0},
            health: 100,
            maxHealth: 100,
            weapon: msg.weapon ?? 0,
            kills: 0,
            deaths: 0,
            crouch: false,
            sprint: false,
            aim: false,
            alive: true,
            lastUpdate: Date.now()
          };
          players.set(id, p);
          broadcast({ t: 'player-joined', player: p });
          break;
        }
        case 'update': {
          const p = players.get(id);
          if(!p) return;
          if(msg.pos) p.pos = msg.pos;
          if(msg.rot) p.rot = msg.rot;
          if(msg.vel) p.vel = msg.vel;
          if(typeof msg.crouch !== 'undefined') p.crouch = msg.crouch;
          if(typeof msg.sprint !== 'undefined') p.sprint = msg.sprint;
          if(typeof msg.aim !== 'undefined') p.aim = msg.aim;
          if(typeof msg.health !== 'undefined') p.health = msg.health;
          if(typeof msg.weapon !== 'undefined') p.weapon = msg.weapon;
          if(typeof msg.alive !== 'undefined') p.alive = msg.alive;
          p.lastUpdate = Date.now();
          break;
        }
        case 'shoot': {
          broadcast({ t: 'shoot', id, origin: msg.origin, dir: msg.dir, weapon: msg.weapon, time: Date.now() });
          break;
        }
        case 'hit': {
          const target = players.get(msg.targetId);
          const attacker = players.get(id);
          if(!target || !attacker) return;
          if(!target.alive) return;
          target.health -= msg.damage;
          let killed = false;
          if(target.health <= 0){
            target.health = 0;
            target.alive = false;
            target.deaths++;
            attacker.kills++;
            killed = true;
          }
          broadcast({ t: 'hit', targetId: msg.targetId, attackerId: id, damage: msg.damage, health: target.health, killed, weapon: attacker.weapon });
          break;
        }
        case 'respawn': {
          const p = players.get(id);
          if(!p) return;
          p.pos = msg.pos || {x: Math.random()*20-10, y:2, z: Math.random()*20-10};
          p.health = 100;
          p.alive = true;
          if(typeof msg.weapon !== 'undefined') p.weapon = msg.weapon;
          broadcast({ t: 'respawn', id, pos: p.pos, weapon: p.weapon });
          break;
        }
        case 'chat': {
          const p = players.get(id);
          broadcast({ t: 'chat', id, name: p?.name || 'Soldier', text: (msg.text||'').slice(0,200), time: Date.now() });
          break;
        }
      }
    }catch(e){ console.error(e); }
  });

  ws.on('close', ()=>{
    console.log(`[WW2] Player left: ${id}`);
    players.delete(id);
    broadcast({ t: 'player-left', id });
  });
});

function broadcast(data){
  const str = JSON.stringify(data);
  wss.clients.forEach(c=>{
    if(c.readyState===1) c.send(str);
  });
}

setInterval(()=>{
  if(players.size===0) return;
  const list = Array.from(players.values()).map(p=>({
    id:p.id,
    name:p.name,
    pos:p.pos,
    rot:p.rot,
    vel:p.vel,
    health:p.health,
    weapon:p.weapon,
    kills:p.kills,
    deaths:p.deaths,
    crouch:p.crouch,
    sprint:p.sprint,
    aim:p.aim,
    alive:p.alive
  }));
  const msg = JSON.stringify({ t: 'players-update', players: list });
  wss.clients.forEach(c=>{
    if(c.readyState===1) c.send(msg);
  });
}, 50);

await viteServer.listen();
viteServer.printUrls();
console.log(`\n[WW2] Game server ready! Share http://${host}:${port} with your LAN\n`);
console.log(`[WW2] Instructions:`);
console.log(`  1. Host runs: npm run dev -H ${host} -p ${port}`);
console.log(`  2. Friends open: http://${host}:${port} (or your actual LAN IP:${port})`);
console.log(`  3. Choose weapon, DEPLOY, fight!`);
console.log(`  4. Free For All - No install for guests, just browser\n`);
