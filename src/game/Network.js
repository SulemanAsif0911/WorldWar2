export class Network {
  constructor(){
    this.ws = null;
    this.id = null;
    this.players = new Map();
    this.callbacks = {};
    this.connected = false;
    this.latency = 0;
    this.lastPing = 0;
  }

  connect(){
    return new Promise((resolve, reject)=>{
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${location.host}/ws`;
      console.log('[Network] Connecting to', url);
      this.ws = new WebSocket(url);

      this.ws.onopen = ()=>{
        console.log('[Network] Connected');
        this.connected = true;
        this.emit('connected');
      };

      this.ws.onmessage = (e)=>{
        try{
          const msg = JSON.parse(e.data);
          this.handleMessage(msg);
        }catch(err){ console.error('WS parse', err); }
      };

      this.ws.onclose = ()=>{
        console.log('[Network] Disconnected');
        this.connected = false;
        this.emit('disconnected');
        // auto reconnect after 2s
        setTimeout(()=>this.connect(), 2000);
      };

      this.ws.onerror = (err)=>{
        console.error('[Network] Error', err);
        reject(err);
      };

      // resolve on welcome
      const onWelcome = (data)=>{
        this.off('welcome', onWelcome);
        resolve(data);
      };
      this.on('welcome', onWelcome);
    });
  }

  handleMessage(msg){
    switch(msg.t){
      case 'welcome':
        this.id = msg.id;
        msg.players.forEach(p=> this.players.set(p.id, p));
        this.emit('welcome', msg);
        break;
      case 'player-joined':
        this.players.set(msg.player.id, msg.player);
        this.emit('player-joined', msg.player);
        break;
      case 'player-left':
        this.players.delete(msg.id);
        this.emit('player-left', msg.id);
        break;
      case 'players-update':
        msg.players.forEach(p=>{
          if(p.id !== this.id){
            this.players.set(p.id, p);
          }
        });
        // remove stale? server already handles left
        this.emit('players-update', msg.players);
        break;
      case 'shoot':
        this.emit('shoot', msg);
        break;
      case 'hit':
        // update local player cache
        if(this.players.has(msg.targetId)){
          const pl = this.players.get(msg.targetId);
          pl.health = msg.health;
          pl.alive = !msg.killed ? pl.alive : false;
          if(msg.killed){
            pl.deaths = (pl.deaths||0)+1;
          }
        }
        if(msg.attackerId && this.players.has(msg.attackerId) && msg.killed){
          const atk = this.players.get(msg.attackerId);
          atk.kills = (atk.kills||0)+1;
        }
        this.emit('hit', msg);
        break;
      case 'respawn':
        if(this.players.has(msg.id)){
          const pl = this.players.get(msg.id);
          pl.pos = msg.pos;
          pl.health = 100;
          pl.alive = true;
          pl.weapon = msg.weapon;
        }
        this.emit('respawn', msg);
        break;
      case 'chat':
        this.emit('chat', msg);
        break;
      default:
        this.emit(msg.t, msg);
    }
  }

  send(obj){
    if(this.ws && this.ws.readyState === 1){
      this.ws.send(JSON.stringify(obj));
    }
  }

  join(name, weapon, pos){
    this.send({ t:'join', name, weapon, pos, rot:{x:0,y:0,z:0} });
  }

  update(state){
    this.send({ t:'update', ...state });
  }

  shoot(origin, dir, weapon){
    this.send({ t:'shoot', origin, dir, weapon });
  }

  hit(targetId, damage){
    this.send({ t:'hit', targetId, damage });
  }

  respawn(pos, weapon){
    this.send({ t:'respawn', pos, weapon });
  }

  chat(text){
    this.send({ t:'chat', text });
  }

  on(event, cb){
    if(!this.callbacks[event]) this.callbacks[event]=[];
    this.callbacks[event].push(cb);
  }
  off(event, cb){
    if(!this.callbacks[event]) return;
    this.callbacks[event]=this.callbacks[event].filter(f=>f!==cb);
  }
  emit(event, data){
    (this.callbacks[event]||[]).forEach(cb=>cb(data));
  }

  getRemotePlayers(){
    return Array.from(this.players.values()).filter(p=>p.id!==this.id);
  }
}
