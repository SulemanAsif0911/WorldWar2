import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

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
    
    // Use absolute URLs from public folder - vite serves public at root
    // Try multiple URLs for robustness (symlink handling)
    const urls = [
      '/mercati_di_traiano_ruins.glb',
      '/public/mercati_di_traiano_ruins.glb',
      './mercati_di_traiano_ruins.glb'
    ];

    let lastError = null;
    for(const glbUrl of urls){
      try{
        console.log('[Map] Trying to load from', glbUrl);
        if(onProgress) onProgress(0.1);
        
        // Fetch as arrayBuffer manually for reliability (large 36MB file)
        const response = await fetch(glbUrl);
        if(!response.ok){
          throw new Error(`HTTP ${response.status} for ${glbUrl}`);
        }
        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength) : 36242588;
        
        // Stream with progress if possible
        let arrayBuffer;
        if(response.body && window.ReadableStream){
          const reader = response.body.getReader();
          let received = 0;
          const chunks = [];
          while(true){
            const {done, value} = await reader.read();
            if(done) break;
            chunks.push(value);
            received += value.length;
            if(onProgress){
              onProgress(0.1 + (received/total)*0.7);
            }
          }
          // Combine chunks
          const combined = new Uint8Array(received);
          let pos = 0;
          for(const chunk of chunks){
            combined.set(chunk, pos);
            pos += chunk.length;
          }
          arrayBuffer = combined.buffer;
        } else {
          // Fallback
          arrayBuffer = await response.arrayBuffer();
          if(onProgress) onProgress(0.8);
        }

        console.log('[Map] Fetched', arrayBuffer.byteLength, 'bytes');

        // Parse GLB
        const gltf = await new Promise((resolve, reject)=>{
          loader.parse(arrayBuffer, '', (g)=>resolve(g), (e)=>reject(e));
        });

        console.log('[Map] GLTF parsed', gltf);
        const model = gltf.scene;
        model.traverse((child)=>{
          if(child.isMesh){
            child.castShadow = true;
            child.receiveShadow = true;
            if(child.material){
              const mat = child.material;
              if(mat.map){
                mat.map.colorSpace = THREE.SRGBColorSpace;
                mat.map.anisotropy = 8;
              }
              mat.roughness = mat.roughness ?? 0.9;
              mat.metalness = mat.metalness ?? 0.05;
              mat.needsUpdate = true;
            }
            const geom = child.geometry;
            if(geom){
              try{
                geom.computeBoundsTree();
                this.bvhMeshes.push(child);
              }catch(e){
                console.warn('[Map] BVH failed for mesh', e);
                this.bvhMeshes.push(child);
              }
            }
            this.colliders.push(child);
          }
        });

        // Center and scale
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        console.log('[Map] Original size', size, 'center', center);

        model.position.sub(center);
        const box2 = new THREE.Box3().setFromObject(model);
        const minY = box2.min.y;
        model.position.y -= minY;

        const targetSize = 80;
        const maxDim = Math.max(size.x, size.z);
        let scale = 1;
        if(maxDim > targetSize){
          scale = targetSize / maxDim;
          model.scale.setScalar(scale);
        }
        model.position.multiplyScalar(scale);
        const finalBox = new THREE.Box3().setFromObject(model);
        model.position.y -= finalBox.min.y;

        this.root.add(model);
        this.model = model;

        this.generateSpawnPoints();
        this.addEnvironmentDetails();

        const groundGeo = new THREE.PlaneGeometry(200,200);
        const groundMat = new THREE.MeshStandardMaterial({ color:0x2a2a2a, roughness:1, transparent:true, opacity:0.0 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI/2;
        ground.position.y = 0.05;
        ground.receiveShadow = true;
        ground.name = 'GroundCollider';
        this.root.add(ground);
        this.colliders.push(ground);
        this.bvhMeshes.push(ground);
        try{ ground.geometry.computeBoundsTree(); }catch{}

        this.loaded = true;
        if(onProgress) onProgress(1);
        return; // success

      }catch(err){
        console.warn(`[Map] Failed to load from ${glbUrl}:`, err);
        lastError = err;
        continue;
      }
    }

    // All URLs failed, fallback to procedural ground
    console.error('[Map] All URLs failed, using fallback ground', lastError);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100,100),
      new THREE.MeshStandardMaterial({ color:0x3a3a3a, roughness:0.9 })
    );
    ground.rotation.x = -Math.PI/2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.bvhMeshes = [ground];
    this.colliders = [ground];
    try{ ground.geometry.computeBoundsTree(); }catch{}
    this.spawnPoints = [{x:0,y:2,z:0},{x:10,y:2,z:10},{x:-10,y:2,z:-10}];
    this.loaded = true;
    if(onProgress) onProgress(1);
  }

  generateSpawnPoints(){
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
    const lights = [
      { pos:[10,4,5], color:0xffaa44, intensity:2 },
      { pos:[-12,3,-8], color:0x44aaff, intensity:1.5 },
      { pos:[0,6,0], color:0xff4444, intensity:0.8 },
      { pos:[18,3,18], color:0xffaa44, intensity:1.2 },
    ];
    lights.forEach(l=>{
      const light = new THREE.PointLight(l.color, l.intensity, 20);
      light.position.set(...l.pos);
      this.root.add(light);
    });
  }

  checkCollision(pos, radius=0.4, height=1.8){
    const origin = new THREE.Vector3(pos.x, pos.y + height*0.5, pos.z);
    const dirDown = new THREE.Vector3(0,-1,0);
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;

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
