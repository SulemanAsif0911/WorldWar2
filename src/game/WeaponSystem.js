import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getWeapon, WEAPONS } from './WeaponsData.js';

export class WeaponSystem {
  constructor(scene, camera, map, remoteManager){
    this.scene = scene;
    this.camera = camera;
    this.map = map;
    this.remote = remoteManager;
    this.loader = new GLTFLoader();

    this.currentWeaponId = 0;
    this.ammo = {}; // weaponId -> { current, reserve }
    this.isReloading = false;
    this.lastShotTime = 0;
    this.recoil = 0;
    this.recoilTarget = 0;
    this.sway = { x:0, y:0 };
    this.bobPhase = 0;

    this.weaponMeshes = []; // GLB meshes for first person
    this.weaponGroup = new THREE.Group();
    this.weaponGroup.name = 'FP_Weapon';
    camera.add(this.weaponGroup);

    this.muzzleFlash = null;
    this.initMuzzleFlash();

    // Input state
    this.isAiming = false;
    this.aimProgress = 0; // 0-1

    // Callbacks
    this.onShoot = null;
    this.onHit = null;
    this.onAmmoChange = null;

    this.initAmmo();
  }

  initAmmo(){
    WEAPONS.forEach(w=>{
      this.ammo[w.id] = { current: w.magSize, reserve: w.reserve };
    });
  }

  async loadWeapons(onProgress){
    return new Promise((resolve, reject)=>{
      const url = '/ww2_weapons.glb';
      this.loader.load(url, (gltf)=>{
        console.log('[Weapon] Loaded', gltf);
        // Extract 4 meshes
        const meshes = [];
        gltf.scene.traverse((c)=>{
          if(c.isMesh){
            meshes.push(c);
          }
        });
        console.log('[Weapon] Found meshes', meshes.length);

        // Sort by name to be deterministic
        meshes.sort((a,b)=> (a.name||'').localeCompare(b.name||''));

        // Create FP meshes for each weapon
        meshes.forEach((mesh, idx)=>{
          // Clone and prepare for FP view
          const clone = mesh.clone();
          clone.material = mesh.material.clone();
          // Enhance material
          if(clone.material){
            clone.material.roughness = 0.6;
            clone.material.metalness = 0.2;
          }
          clone.castShadow = true;
          clone.receiveShadow = true;

          // Position for FP view - will be adjusted per weapon
          // Normalize scale
          const box = new THREE.Box3().setFromObject(clone);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          if(maxDim > 2){
            const s = 1.5 / maxDim;
            clone.scale.setScalar(s);
          }

          // Store original transform
          clone.userData.originalScale = clone.scale.clone();

          this.weaponMeshes[idx] = clone;
        });

        // If less than 4 meshes, duplicate
        while(this.weaponMeshes.length < 4){
          const last = this.weaponMeshes[this.weaponMeshes.length-1];
          this.weaponMeshes.push(last ? last.clone() : new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,0.5), new THREE.MeshStandardMaterial({color:0x555555})));
        }

        this.equip(this.currentWeaponId);
        if(onProgress) onProgress(1);
        resolve();
      }, (xhr)=>{
        if(onProgress) onProgress(xhr.loaded / (xhr.total||495456) *0.9);
      }, (err)=>{
        console.error('[Weapon] Load failed', err);
        // Create fallback box weapons
        for(let i=0;i<4;i++){
          const geo = new THREE.BoxGeometry(0.05,0.08,0.6);
          const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(WEAPONS[i].color) });
          const mesh = new THREE.Mesh(geo, mat);
          this.weaponMeshes[i]=mesh;
        }
        this.equip(0);
        resolve();
      });
    });
  }

  initMuzzleFlash(){
    const geo = new THREE.ConeGeometry(0.05, 0.15, 6);
    const mat = new THREE.MeshBasicMaterial({ color:0xffcc44, transparent:true, opacity:0 });
    this.muzzleFlash = new THREE.Mesh(geo, mat);
    this.muzzleFlash.rotation.x = Math.PI/2;
    this.muzzleFlash.position.set(0, -0.05, -0.6);
    this.weaponGroup.add(this.muzzleFlash);

    this.muzzleLight = new THREE.PointLight(0xffaa44, 0, 3);
    this.muzzleLight.position.copy(this.muzzleFlash.position);
    this.weaponGroup.add(this.muzzleLight);
  }

  equip(id){
    this.currentWeaponId = id;
    // Clear group
    // Keep muzzle flash and light
    const keep = [this.muzzleFlash, this.muzzleLight];
    this.weaponGroup.children.slice().forEach(c=>{
      if(!keep.includes(c)) this.weaponGroup.remove(c);
    });

    const mesh = this.weaponMeshes[id];
    if(mesh){
      // Reset transforms per weapon type for detailed FP positioning
      const configs = [
        { pos:[0.25, -0.25, -0.5], rot:[0, Math.PI, 0], scale:1 }, // Garand
        { pos:[0.22, -0.22, -0.45], rot:[0, Math.PI, 0], scale:1.1 }, // Thompson
        { pos:[0.20, -0.28, -0.6], rot:[0, Math.PI, 0], scale:1 }, // Kar98k
        { pos:[0.24, -0.23, -0.48], rot:[0, Math.PI, 0], scale:1.05 }, // MP40
      ];
      const cfg = configs[id] || configs[0];
      mesh.position.set(...cfg.pos);
      mesh.rotation.set(...cfg.rot);
      mesh.scale.setScalar(cfg.scale);
      // Adjust for original scale
      if(mesh.userData.originalScale){
        mesh.scale.multiply(mesh.userData.originalScale);
      }
      this.weaponGroup.add(mesh);
    }

    this.isReloading = false;
    if(this.onAmmoChange) this.onAmmoChange(this.getAmmoState());
  }

  getAmmoState(){
    const w = getWeapon(this.currentWeaponId);
    const a = this.ammo[this.currentWeaponId];
    return { weapon: w, current: a.current, reserve: a.reserve, reloading: this.isReloading };
  }

  canShoot(){
    if(this.isReloading) return false;
    const ammo = this.ammo[this.currentWeaponId];
    if(ammo.current <=0) return false;
    const w = getWeapon(this.currentWeaponId);
    const now = performance.now();
    const interval = 60000 / w.rpm;
    return (now - this.lastShotTime) >= interval;
  }

  shoot(camera, isAiming=false){
    if(!this.canShoot()){
      if(this.ammo[this.currentWeaponId].current <=0){
        this.reload();
      }
      return null;
    }

    const w = getWeapon(this.currentWeaponId);
    const ammo = this.ammo[this.currentWeaponId];
    ammo.current--;
    this.lastShotTime = performance.now();

    // Recoil
    this.recoilTarget += w.recoil * 0.02;
    this.recoilTarget = Math.min(this.recoilTarget, 0.3);

    // Muzzle flash
    this.showMuzzleFlash();

    // Calculate spread
    let spread = w.spread;
    if(isAiming) spread *= 0.4;
    // Add movement spread could be handled by caller

    // Raycast from camera
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const direction = new THREE.Vector3(0,0,-1);
    direction.applyQuaternion(camera.quaternion);
    // Apply spread
    direction.x += (Math.random()-0.5)*spread;
    direction.y += (Math.random()-0.5)*spread;
    direction.z += (Math.random()-0.5)*spread;
    direction.normalize();

    // Check map hit
    let hit = null;
    let hitDistance = w.range;

    // Check remote players first
    if(this.remote){
      const playerHit = this.remote.raycastCheck(origin, direction, w.range);
      if(playerHit){
        hit = { type:'player', player: playerHit.player, point: playerHit.point, distance: playerHit.distance };
        hitDistance = playerHit.distance;
      }
    }

    // Check map if no player hit or map closer
    if(this.map){
      const mapHit = this.map.raycast(origin, direction, hitDistance);
      if(mapHit){
        // If we had player hit but map is closer, map wins
        if(!hit || mapHit.distance < hit.distance){
          hit = { type:'map', point: mapHit.point, normal: mapHit.face?.normal, distance: mapHit.distance, object: mapHit.object };
        }
      }
    }

    if(this.onAmmoChange) this.onAmmoChange(this.getAmmoState());
    if(this.onShoot) this.onShoot({ origin, direction, weapon: w, hit });

    return { origin, direction, weapon: w, hit };
  }

  showMuzzleFlash(){
    if(!this.muzzleFlash) return;
    this.muzzleFlash.material.opacity = 1;
    this.muzzleLight.intensity = 3;
    setTimeout(()=>{
      if(this.muzzleFlash){
        this.muzzleFlash.material.opacity = 0;
        this.muzzleLight.intensity = 0;
      }
    }, 40);
  }

  reload(){
    if(this.isReloading) return;
    const ammo = this.ammo[this.currentWeaponId];
    const w = getWeapon(this.currentWeaponId);
    if(ammo.current === w.magSize) return;
    if(ammo.reserve <=0) return;

    this.isReloading = true;
    if(this.onAmmoChange) this.onAmmoChange(this.getAmmoState());

    setTimeout(()=>{
      const needed = w.magSize - ammo.current;
      const take = Math.min(needed, ammo.reserve);
      ammo.current += take;
      ammo.reserve -= take;
      this.isReloading = false;
      if(this.onAmmoChange) this.onAmmoChange(this.getAmmoState());
    }, w.reloadTime*1000);
  }

  update(delta, input, moving, sprinting){
    // Aim progress
    const aimTarget = this.isAiming ? 1 : 0;
    this.aimProgress = THREE.MathUtils.lerp(this.aimProgress, aimTarget, delta*10);

    // Recoil recovery
    this.recoil = THREE.MathUtils.lerp(this.recoil, this.recoilTarget, delta*15);
    this.recoilTarget = THREE.MathUtils.lerp(this.recoilTarget, 0, delta*3);

    // Weapon bob
    if(moving){
      this.bobPhase += delta * (sprinting ? 12 : 8);
    }
    const bobX = Math.sin(this.bobPhase) * 0.015 * (sprinting ? 1.5 : 1);
    const bobY = Math.cos(this.bobPhase*2) * 0.01 * (sprinting ? 1.5 : 1);

    // Sway from mouse
    if(input){
      const { dx, dy } = input.consumeMouseDelta ? { dx:0, dy:0 } : { dx:0, dy:0 };
      // Actually sway handled via Input mouse delta but we need to store last
    }

    // Apply transforms to weapon group
    if(this.weaponGroup){
      // Base position lerp for ADS
      const w = getWeapon(this.currentWeaponId);
      const adsPos = [
        [0, -0.15, -0.35], // Garand
        [0, -0.14, -0.3],
        [-0.01, -0.18, -0.25], // sniper closer
        [0, -0.15, -0.32]
      ][this.currentWeaponId] || [0, -0.15, -0.35];

      const hipPos = [
        [0.25, -0.25, -0.5],
        [0.22, -0.22, -0.45],
        [0.20, -0.28, -0.6],
        [0.24, -0.23, -0.48]
      ][this.currentWeaponId] || [0.25, -0.25, -0.5];

      const currentMesh = this.weaponMeshes[this.currentWeaponId];
      if(currentMesh){
        // Lerp between hip and ads
        currentMesh.position.x = THREE.MathUtils.lerp(hipPos[0], adsPos[0], this.aimProgress) + bobX;
        currentMesh.position.y = THREE.MathUtils.lerp(hipPos[1], adsPos[1], this.aimProgress) + bobY - this.recoil*0.5;
        currentMesh.position.z = THREE.MathUtils.lerp(hipPos[2], adsPos[2], this.aimProgress);

        // Slight rotation for recoil
        currentMesh.rotation.x = THREE.MathUtils.lerp(0, -this.recoil, 1) + (isFinite(bobX)? bobX*0.5:0);
      }

      // Muzzle flash follows weapon
      if(this.muzzleFlash && currentMesh){
        this.muzzleFlash.position.set(currentMesh.position.x, currentMesh.position.y+0.05, currentMesh.position.z -0.4);
        this.muzzleLight.position.copy(this.muzzleFlash.position);
      }
    }
  }

  setAiming(aiming){
    this.isAiming = aiming;
  }
}
