import { defineConfig } from 'vite';
import { WebSocketServer } from 'ws';

// Simple WS plugin for when using plain vite command
function ww2MultiplayerPlugin() {
  let wss;
  const players = new Map();
  let idCounter = 1;

  return {
    name: 'ww2-multiplayer',
    configureServer(server) {
      wss = new WebSocketServer({ noServer: true });
      
      server.httpServer?.on('upgrade', (request, socket, head) => {
        const { url } = request;
        if (url === '/ws' || url?.startsWith('/ws?')) {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
        }
      });

      wss.on('connection', (ws) => {
        const id = 'p_' + (idCounter++) + '_' + Math.random().toString(36).slice(2,6);
        ws._id = id;
        console.log(`[WW2] Player connected: ${id}`);

        // Send welcome
        ws.send(JSON.stringify({
          t: 'welcome',
          id,
          players: Array.from(players.values())
        }));

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            handleMessage(ws, msg);
          } catch(e){ console.error('msg parse err', e); }
        });

        ws.on('close', () => {
          console.log(`[WW2] Player left: ${id}`);
          players.delete(id);
          broadcast({ t: 'player-left', id }, ws);
        });
      });

      function handleMessage(ws, msg){
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
              ping: 0,
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
            broadcast({ t: 'shoot', id, origin: msg.origin, dir: msg.dir, weapon: msg.weapon, time: Date.now() }, null);
            break;
          }
          case 'hit': {
            const target = players.get(msg.targetId);
            const attacker = players.get(id);
            if(!target || !attacker) return;
            if(!target.alive) return;
            // simple distance validation could be added
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
      }

      function broadcast(data, exclude){
        const str = JSON.stringify(data);
        wss.clients.forEach(c => {
          if(c.readyState === 1 && c !== exclude){
            c.send(str);
          }
        });
      }

      // Broadcast players list at 20hz
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
    }
  };
}

export default defineConfig({
  plugins: [ww2MultiplayerPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    hmr: { clientPort: 443 },
    cors: true,
    headers: { 'Access-Control-Allow-Origin': '*' }
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    cors: true
  },
  assetsInclude: ['**/*.glb'],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0
  }
});
