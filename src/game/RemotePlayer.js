import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getWeapon } from './WeaponsData.js';

export class RemotePlayerManager {
  constructor(scene, map){
    this.scene = scene;
    this.map = map;
    this.players = new Map();
    this.soldierTemplate = null;
    this.loader = new GLTFLoader();
    this.clock = new THREE.Clock();
  }

  async loadSoldierModel(onProgress){
    const urls = ['/soldier.glb', '/Soldier%20by%20KolosStudios%20-%20XT8jgwSesV.glb', '/ww2_weapons.glb']; // last fallback not ideal but try
    // Actually soldier URLs
    const soldierUrls = ['/soldier.glb', '/public/soldier.glb', '/Soldier%20by%20KolosStudios%20-%20XT8jgwSesV.glb'];
    
    for(const url of soldierUrls){
      try{
        console.log('[Remote] Trying', url);
        const response = await fetch(url);
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        console.log('[Remote] Fetched', arrayBuffer.byteLength, 'from', url);
        
        const gltf = await new Promise((resolve, reject)=>{
          this.loader.parse(arrayBuffer, '', (g)=>resolve(g), (e)=>reject(e));
        });
        
        this.soldierTemplate = gltf;
        console.log('[Remote] Soldier loaded from', url, gltf);
        if(onProgress) onProgress(1);
        return gltf;
      }catch(err){
        console.warn('[Remote] Failed', url, err);
        if(onProgress) onProgress(0.3);
      }
    }

    console.warn('[Remote] All soldier URLs failed, using fallback capsule');
    this.soldierTemplate = null;
    if(onProgress) onProgress(1);
    return null;
  }

  addPlayer(data){
    if(this.players.has(data.id)) return this.players.get(data.id);

    const group = new THREE.Group();
    group.name = `Remote_${data.id}`;

    let mesh = null;
    let mixer = null;

    if(this.soldierTemplate){
      const clone = this.soldierTemplate.scene.clone(true);
      clone.traverse((c)=>{
        if(c.isMesh){
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      clone.scale.set(1,1,1);
      const box = new THREE.Box3().setFromObject(clone);
      const size = box.getSize(new THREE.Vector3());
      if(size.y > 3){
        const s = 1.8 / size.y;
        clone.scale.setScalar(s);
      }
      const box2 = new THREE.Box3().setFromObject(clone);
      clone.position.y -= box2.min.y;

      mesh = clone;

      if(this.soldierTemplate.animations && this.soldierTemplate.animations.length>0){
        mixer = new THREE.AnimationMixer(clone);
        const clip = this.soldierTemplate.animations[0];
        const action = mixer.clipAction(clip);
        action.play();
      }
    } else {
      const geo = new THREE.CapsuleGeometry(0.3, 1.2, 4, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0x4a6a3a });
      const cap = new THREE.Mesh(geo, mat);
      cap.position.y = 0.9;
      cap.castShadow = true;
      mesh = new THREE.Group();
      mesh.add(cap);
    }

    group.add(mesh);

    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0,0,256,64);
    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 20px Teko';
    ctx.textAlign = 'center';
    ctx.fillText(data.name || 'Soldier', 128, 30);
    ctx.fillStyle = '#fff';
    ctx.font = '12px Share Tech Mono';
    const weapon = getWeapon(data.weapon);
    ctx.fillText(weapon.short, 128, 50);

    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest:false, depthWrite:false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.y = 2.4;
    sprite.scale.set(2,0.5,1);
    group.add(sprite);

    const healthCanvas = document.createElement('canvas');
    healthCanvas.width = 128; healthCanvas.height = 16;
    const hCtx = healthCanvas.getContext('2d');
    hCtx.fillStyle = '#ff3b30';
    hCtx.fillRect(0,0,128,16);
    const hTex = new THREE.CanvasTexture(healthCanvas);
    const hSpriteMat = new THREE.SpriteMaterial({ map: hTex });
    const hSprite = new THREE.Sprite(hSpriteMat);
    hSprite.position.y = 2.1;
    hSprite.scale.set(1,0.15,1);
    group.add(hSprite);

    this.scene.add(group);

    const entry = {
      id: data.id,
      group,
      mesh,
      mixer,
      sprite,
      healthSprite: hSprite,
      healthCanvas,
      canvas,
      data: { ...data },
      targetPos: new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z),
      currentPos: new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z),
      targetRot: new THREE.Euler(0, data.rot.y||0, 0),
      lastUpdate: performance.now()
    };

    this.players.set(data.id, entry);
    return entry;
  }

  removePlayer(id){
    const p = this.players.get(id);
    if(p){
      this.scene.remove(p.group);
      this.players.delete(id);
    }
  }

  updatePlayer(data){
    let entry = this.players.get(data.id);
    if(!entry){
      entry = this.addPlayer(data);
    }
    entry.data = { ...data };
    entry.targetPos.set(data.pos.x, data.pos.y, data.pos.z);
    entry.targetRot.set(0, data.rot.y||0, 0);
    entry.lastUpdate = performance.now();

    if(entry.healthCanvas){
      const ctx = entry.healthCanvas.getContext('2d');
      ctx.clearRect(0,0,128,16);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0,0,128,16);
      ctx.fillStyle = data.health > 50 ? '#2ecc71' : data.health > 25 ? '#ffcc00' : '#ff3b30';
      ctx.fillRect(0,0,128 * (data.health/100), 16);
      entry.healthSprite.material.map.needsUpdate = true;
      entry.healthSprite.visible = data.alive;
    }

    if(entry.canvas){
      const ctx = entry.canvas.getContext('2d');
      ctx.clearRect(0,0,256,64);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0,0,256,64);
      ctx.fillStyle = data.alive ? '#ffcc00' : '#ff3b30';
      ctx.font = 'bold 20px Teko';
      ctx.textAlign = 'center';
      ctx.fillText(data.name || 'Soldier', 128, 30);
      ctx.fillStyle = '#fff';
      ctx.font = '12px Share Tech Mono';
      const weapon = getWeapon(data.weapon);
      ctx.fillText(`${weapon.short} ${data.alive?'':'[DOWN]'}`, 128, 50);
      entry.sprite.material.map.needsUpdate = true;
    }

    if(entry.mesh){
      const targetHeight = data.crouch ? 0.7 : 1.0;
      entry.mesh.scale.y = THREE.MathUtils.lerp(entry.mesh.scale.y, targetHeight, 0.1);
    }

    entry.group.visible = data.alive;
  }

  update(delta){
    const now = performance.now();
    this.players.forEach(entry=>{
      entry.currentPos.lerp(entry.targetPos, Math.min(1, delta*10));
      entry.group.position.copy(entry.currentPos);

      const currentY = entry.group.rotation.y;
      const targetY = entry.targetRot.y;
      let diff = targetY - currentY;
      while(diff > Math.PI) diff -= Math.PI*2;
      while(diff < -Math.PI) diff += Math.PI*2;
      entry.group.rotation.y += diff * Math.min(1, delta*8);

      if(entry.mixer){
        entry.mixer.update(delta);
        const vel = entry.data.vel;
        const speed = vel ? Math.sqrt(vel.x*vel.x + vel.z*vel.z) : 0;
        entry.mixer.timeScale = entry.data.sprint ? 1.8 : (speed > 0.5 ? 1.2 : 0.8);
      }

      if(entry.data.vel){
        const speed = Math.sqrt(entry.data.vel.x**2 + entry.data.vel.z**2);
        if(speed > 0.1 && entry.data.alive){
          entry.group.position.y = entry.targetPos.y + Math.sin(now*0.01*speed*2)*0.05;
        }
      }
    });
  }

  raycastCheck(origin, dir, maxDist=100, ignoreId=null){
    const ray = new THREE.Raycaster(origin, dir, 0, maxDist);
    let closest = null;
    let closestDist = Infinity;
    let hitPlayer = null;
    this.players.forEach((entry, id)=>{
      if(id===ignoreId) return;
      if(!entry.data.alive) return;
      const box = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(entry.currentPos.x, entry.currentPos.y+0.9, entry.currentPos.z),
        new THREE.Vector3(0.8, 1.8, 0.8)
      );
      const intersect = ray.ray.intersectBox(box, new THREE.Vector3());
      if(intersect){
        const dist = origin.distanceTo(intersect);
        if(dist < closestDist){
          closestDist = dist;
          closest = intersect;
          hitPlayer = entry;
        }
      }
    });
    return hitPlayer ? { player: hitPlayer, point: closest, distance: closestDist } : null;
  }
}
