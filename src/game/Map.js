import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree, CONTAINED, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export class GameMap {
  constructor(scene){
    this.scene = scene;
    this.colliders = [];
    this.bvhMeshes = [];
    this.spawnPoints = [];
    this.loaded = false;
    this.root = new THREE.Group();
    this.root.name = 'MapRoot';
    scene.add(this.root);
  }

  async load(onProgress){
    const loader = new GLTFLoader();
    const url = '/mercati_di_traiano_ruins.glb';
    // Fallback to root if not in public - vite serves from root
    const tryUrls = [url, '/mercati_di_traiano_ruins.glb', './mercati_di_traiano_ruins.glb', '../mercati_di_traiano_ruins.glb', '/home/user/WorldWar2/mercati_di_traiano_ruins.glb'];
    // Actually we will copy via vite assets? Let's try fetch with import
    // For dev, the file is in project root, we can load via /src/../? We'll use absolute fetch from public if exists, else use URL.createObjectURL from file? 
    // Simplest: vite will serve files from root as static? We need to ensure file is copied. We'll attempt to load from /mercati_di_traiano_ruins.glb and if fails, load from blob via fetch of relative path.

    let glbUrl = null;
    for(const u of [ '/mercati_di_traiano_ruins.glb', './mercati_di_traiano_ruins.glb' ]){
      try{
        const res = await fetch(u, { method:'HEAD' });
        if(res.ok){ glbUrl = u; break; }
      }catch{}
    }
    if(!glbUrl){
      // as last resort, try to load via import? We'll use the file in repo root served by vite public? We'll copy file to public folder in build step via vite config assets.
      // For now, assume it's at /mercati_di_traiano_ruins.glb after we copy in dev server via vite static handling - we manually expose via vite config? 
      // We'll attempt direct path that vite dev server should serve from root: /mercati_di_traiano_ruins.glb
      glbUrl = '/mercati_di_traiano_ruins.glb';
    }

    console.log('[Map] Loading from', glbUrl);

    return new Promise((resolve, reject)=>{
      loader.load(glbUrl, (gltf)=>{
        console.log('[Map] GLTF loaded', gltf);
        const model = gltf.scene;
        model.traverse((child)=>{
          if(child.isMesh){
            child.castShadow = true;
            child.receiveShadow = true;
            // Improve material for ruins detailing
            if(child.material){
              const mat = child.material;
              // Keep original texture but enhance
              if(mat.map){
                mat.map.encoding = THREE.sRGBEncoding;
                mat.map.anisotropy = 8;
              }
              mat.roughness = mat.roughness ?? 0.9;
              mat.metalness = mat.metalness ?? 0.05;
              // Enable shadows
              mat.needsUpdate = true;
            }
            // Build BVH for collision
            const geom = child.geometry;
            if(geom){
              geom.computeBoundsTree();
              this.bvhMeshes.push(child);
            }
            this.colliders.push(child);
          }
        });

        // Center and scale map - ruins is huge, need to normalize
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        console.log('[Map] Original size', size, 'center', center);

        // Move model so center at origin, and ground at y=0
        model.position.sub(center);
        // After centering, get new box
        const box2 = new THREE.Box3().setFromObject(model);
        const minY = box2.min.y;
        model.position.y -= minY; // put bottom at 0

        // Scale down if too large - ruins likely ~100-200 units, we want ~80 units arena
        const targetSize = 80;
        const maxDim = Math.max(size.x, size.z);
        let scale = 1;
        if(maxDim > targetSize){
          scale = targetSize / maxDim;
          model.scale.setScalar(scale);
        }
        // Re-center after scale
        model.position.multiplyScalar(scale);
        // Ensure ground at 0 again after scaling messing? We'll compute again
        const box3 = new THREE.Box3().setFromObject(model);
        model.position.y -= box3.min.y * scale + box3.min.y; // actually simpler: set y so min is 0
        // Let's brute force: move so min y =0
        const finalBox = new THREE.Box3().setFromObject(model);
        model.position.y -= finalBox.min.y;

        // Add slight offset so origin is in middle of map
        // Already centered x,z

        this.root.add(model);
        this.model = model;

        // Extract spawn points - find flat areas
        this.generateSpawnPoints();

        // Add extra lighting and fog for detailing
        this.addEnvironmentDetails();

        // Add invisible ground plane for safety collision
        const groundGeo = new THREE.PlaneGeometry(200,200);
        const groundMat = new THREE.MeshStandardMaterial({ color:0x2a2a2a, roughness:1, transparent:true, opacity:0.0 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI/2;
        ground.position.y = 0.05;
        ground.receiveShadow = true;
        ground.name = 'GroundCollider';
        // Don't add BVH for this, but add to colliders for raycast
        this.root.add(ground);
        this.colliders.push(ground);
        this.bvhMeshes.push(ground);
        ground.geometry.computeBoundsTree();

        this.loaded = true;
        if(onProgress) onProgress(1);
        resolve();
      }, (xhr)=>{
        if(onProgress){
          const p = xhr.loaded / (xhr.total || 36242588);
          onProgress(p*0.9);
        }
      }, (err)=>{
        console.error('[Map] Failed', err);
        reject(err);
      });
    });
  }

  generateSpawnPoints(){
    // Generate 12 spawn points around map perimeter and center
    this.spawnPoints = [
      { x: 0, y: 2, z: 0 },
      { x: 15, y: 2, z: 15 },
      { x: -15, y: 2, z: 15 },
      { x: 15, y: 2, z: -15 },
      { x: -15, y: 2, z: -15 },
      { x: 25, y: 2, z: 0 },
      { x: -25, y: 2, z: 0 },
      { x: 0, y: 2, z: 25 },
      { x: 0, y: 2, z: -25 },
      { x: 10, y: 5, z: 10 },
      { x: -10, y: 5, z: -10 },
      { x: 20, y: 2, z: 10 },
    ];
  }

  getRandomSpawn(){
    const idx = Math.floor(Math.random()*this.spawnPoints.length);
    const base = this.spawnPoints[idx];
    return {
      x: base.x + (Math.random()-0.5)*4,
      y: base.y,
      z: base.z + (Math.random()-0.5)*4
    };
  }

  addEnvironmentDetails(){
    // Add point lights inside ruins for atmosphere
    const lights = [
      { pos:[10,4,5], color:0xffaa44, intensity:2 },
      { pos:[-12,3,-8], color:0x44aaff, intensity:1.5 },
      { pos:[0,6,0], color:0xff4444, intensity:0.8 },
      { pos:[18,3,18], color:0xffaa44, intensity:1.2 },
    ];
    lights.forEach(l=>{
      const light = new THREE.PointLight(l.color, l.intensity, 20);
      light.position.set(...l.pos);
      light.castShadow = false;
      this.root.add(light);
    });

    // Add fog planes for depth
    // Fog is handled by scene fog, not here
  }

  // Collision: check if capsule at pos collides
  checkCollision(pos, radius=0.4, height=1.8){
    // Use BVH raycasts: for simplicity, use sphere checks against bvh meshes via closest point?
    // We'll do 5 raycasts: down for ground, and 4 horizontal for walls
    const origin = new THREE.Vector3(pos.x, pos.y + height*0.5, pos.z);
    const dirDown = new THREE.Vector3(0,-1,0);
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;

    // Ground check
    raycaster.ray.origin.copy(origin);
    raycaster.ray.direction.copy(dirDown);
    raycaster.far = height;

    let groundY = null;
    let minDist = Infinity;
    for(const mesh of this.bvhMeshes){
      const hit = raycaster.intersectObject(mesh, false)[0];
      if(hit && hit.distance < minDist){
        minDist = hit.distance;
        groundY = hit.point.y;
      }
    }

    // Wall collision - check 8 directions around
    const wallHits = [];
    const directions = [
      new THREE.Vector3(1,0,0),
      new THREE.Vector3(-1,0,0),
      new THREE.Vector3(0,0,1),
      new THREE.Vector3(0,0,-1),
      new THREE.Vector3(0.707,0,0.707),
      new THREE.Vector3(-0.707,0,0.707),
      new THREE.Vector3(0.707,0,-0.707),
      new THREE.Vector3(-0.707,0,-0.707),
    ];
    for(const dir of directions){
      raycaster.ray.origin.copy(new THREE.Vector3(pos.x, pos.y+0.5, pos.z));
      raycaster.ray.direction.copy(dir);
      raycaster.far = radius+0.2;
      for(const mesh of this.bvhMeshes){
        const hits = raycaster.intersectObject(mesh, false);
        if(hits.length>0 && hits[0].distance < radius+0.2){
          wallHits.push({ dir, dist: hits[0].distance, point: hits[0].point });
          break;
        }
      }
    }

    return { groundY, wallHits, isOnGround: groundY!==null && (origin.y - groundY) <= height+0.1 };
  }

  raycast(origin, direction, maxDist=100){
    const raycaster = new THREE.Raycaster();
    raycaster.ray.origin.copy(origin);
    raycaster.ray.direction.copy(direction);
    raycaster.far = maxDist;
    raycaster.firstHitOnly = true;
    let closest = null;
    let closestDist = Infinity;
    for(const mesh of this.bvhMeshes){
      const hits = raycaster.intersectObject(mesh, false);
      if(hits.length>0 && hits[0].distance < closestDist){
        closest = hits[0];
        closestDist = hits[0].distance;
      }
    }
    return closest;
  }
}
