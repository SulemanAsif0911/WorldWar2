import * as THREE from 'three';

export class PlayerController {
  constructor(camera, map, input, weaponSystem){
    this.camera = camera;
    this.map = map;
    this.input = input;
    this.weapon = weaponSystem;

    this.position = new THREE.Vector3(0,2,0);
    this.velocity = new THREE.Vector3(0,0,0);
    this.rotation = new THREE.Euler(0,0,0, 'YXZ');
    this.yaw = 0;
    this.pitch = 0;

    this.heightStanding = 1.75;
    this.heightCrouch = 1.1;
    this.currentHeight = this.heightStanding;
    this.targetHeight = this.heightStanding;

    this.radius = 0.35;

    this.isCrouching = false;
    this.isSprinting = false;
    this.isOnGround = false;
    this.isAiming = false;

    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;

    this.stamina = 100;
    this.maxStamina = 100;

    this.moveSpeed = 4.5;
    this.sprintSpeed = 7.2;
    this.crouchSpeed = 2.2;
    this.jumpForce = 5.5;
    this.gravity = 14;

    this.headBob = 0;
    this.weaponBob = 0;

    this.lastGroundY = 0;

    this.camera.position.copy(this.position);
    this.camera.position.y += this.currentHeight;

    // For network
    this.lastNetworkUpdate = 0;
  }

  spawn(pos){
    this.position.set(pos.x, pos.y, pos.z);
    this.velocity.set(0,0,0);
    this.health = 100;
    this.alive = true;
    this.isCrouching = false;
    this.targetHeight = this.heightStanding;
    this.currentHeight = this.heightStanding;
    console.log('[Player] Spawned at', pos);
  }

  update(delta){
    if(!this.alive) return;

    // Handle input
    const sensitivity = this.input.sensitivity * 0.002;
    const adsFactor = this.isAiming ? this.input.adsSensitivity : 1;

    if(this.input.locked){
      const { dx, dy } = this.input.consumeMouseDelta();
      this.yaw -= dx * sensitivity * adsFactor;
      this.pitch -= dy * sensitivity * adsFactor * (this.input.invertY ? -1 : 1);
      this.pitch = Math.max(-Math.PI/2 +0.05, Math.min(Math.PI/2 -0.05, this.pitch));
    }

    this.rotation.set(this.pitch, this.yaw, 0);

    // Crouch
    const wantsCrouch = this.input.isDown('control') || this.input.isDown('c');
    this.isCrouching = wantsCrouch;
    this.targetHeight = this.isCrouching ? this.heightCrouch : this.heightStanding;

    // Sprint
    const wantsSprint = this.input.isDown('shift') && !this.isCrouching && this.stamina > 5;
    const isMoving = this.input.isDown('w') || this.input.isDown('a') || this.input.isDown('s') || this.input.isDown('d');
    this.isSprinting = wantsSprint && isMoving && this.input.isDown('w'); // only forward sprint

    // Stamina
    if(this.isSprinting){
      this.stamina -= delta*18;
      if(this.stamina <0) this.stamina=0;
    } else {
      this.stamina += delta*22;
      if(this.stamina > this.maxStamina) this.stamina = this.maxStamina;
    }

    // Aiming
    this.isAiming = this.input.mouse.right && this.input.locked;
    if(this.weapon) this.weapon.setAiming(this.isAiming);

    // Movement direction
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();

    // Yaw only for movement (no pitch)
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), this.yaw);
    forward.set(0,0,-1).applyQuaternion(yawQuat);
    right.set(1,0,0).applyQuaternion(yawQuat);

    let moveDir = new THREE.Vector3(0,0,0);
    if(this.input.isDown('w')) moveDir.add(forward);
    if(this.input.isDown('s')) moveDir.sub(forward);
    if(this.input.isDown('a')) moveDir.sub(right);
    if(this.input.isDown('d')) moveDir.add(right);

    if(moveDir.length() >0){
      moveDir.normalize();
    }

    // Speed
    let speed = this.moveSpeed;
    if(this.isCrouching) speed = this.crouchSpeed;
    else if(this.isSprinting) speed = this.sprintSpeed;

    if(this.isAiming) speed *= 0.55;

    // Apply movement with momentum
    const accel = this.isOnGround ? 25 : 8;
    const targetVelX = moveDir.x * speed;
    const targetVelZ = moveDir.z * speed;

    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetVelX, delta*accel);
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetVelZ, delta*accel);

    // Jump
    if(this.input.isDown(' ') && this.isOnGround && !this.isCrouching){
      this.velocity.y = this.jumpForce;
      this.isOnGround = false;
    }

    // Gravity
    if(!this.isOnGround){
      this.velocity.y -= this.gravity * delta;
    }

    // Collision detection with map
    // Horizontal collision
    const nextPos = this.position.clone();
    nextPos.x += this.velocity.x * delta;
    nextPos.z += this.velocity.z * delta;

    // Check wall collisions via map
    if(this.map){
      const check = this.map.checkCollision(nextPos, this.radius, this.currentHeight);
      if(check.wallHits.length>0){
        // Slide along wall - push back
        for(const hit of check.wallHits){
          const push = hit.dir.clone().multiplyScalar(-(this.radius+0.2 - hit.dist));
          nextPos.add(push);
          // Reduce velocity in that direction
          const dot = this.velocity.dot(hit.dir);
          if(dot <0){
            // remove component
            this.velocity.sub(hit.dir.clone().multiplyScalar(dot));
          }
        }
      }
    }

    this.position.x = nextPos.x;
    this.position.z = nextPos.z;

    // Vertical
    this.position.y += this.velocity.y * delta;

    // Ground check
    if(this.map){
      const groundCheck = this.map.checkCollision(this.position, this.radius, this.currentHeight);
      if(groundCheck.groundY !== null){
        const groundY = groundCheck.groundY;
        if(this.position.y <= groundY + 0.1){
          if(this.velocity.y <0){
            // Land
            if(this.velocity.y < -6){
              // fall damage? maybe small
              const fallDamage = Math.max(0, -this.velocity.y - 8) * 3;
              if(fallDamage >0){
                this.takeDamage(fallDamage);
              }
            }
            this.velocity.y = 0;
          }
          this.position.y = groundY;
          this.isOnGround = true;
          this.lastGroundY = groundY;
        } else {
          // Slightly above ground but within step
          if(this.position.y - groundY < 0.6 && this.isOnGround){
            // Step up
            this.position.y = groundY;
            this.velocity.y = 0;
            this.isOnGround = true;
          } else {
            this.isOnGround = false;
          }
        }
      } else {
        // No ground found, check if falling below map
        if(this.position.y < -10){
          this.takeDamage(100); // kill
        }
        this.isOnGround = false;
      }
    } else {
      // No map, simple ground at 0
      if(this.position.y <=0){
        this.position.y = 0;
        this.velocity.y = 0;
        this.isOnGround = true;
      }
    }

    // Smooth height transition for crouch
    this.currentHeight = THREE.MathUtils.lerp(this.currentHeight, this.targetHeight, delta*10);

    // Head bob
    const isMovingGround = isMoving && this.isOnGround;
    if(isMovingGround){
      this.headBob += delta * (this.isSprinting ? 14 : this.isCrouching ? 6 : 10) * (moveDir.length());
    } else {
      this.headBob = THREE.MathUtils.lerp(this.headBob, 0, delta*5);
    }

    const bobY = Math.sin(this.headBob) * (this.isSprinting ? 0.08 : this.isCrouching ? 0.02 : 0.04) * (isMovingGround?1:0);
    const bobX = Math.cos(this.headBob*0.5) * (this.isSprinting ? 0.05 : 0.02) * (isMovingGround?1:0);

    // Update camera
    this.camera.rotation.copy(this.rotation);
    this.camera.position.copy(this.position);
    this.camera.position.y += this.currentHeight + bobY;
    this.camera.position.x += bobX;

    // Update weapon
    if(this.weapon){
      this.weapon.update(delta, this.input, isMovingGround, this.isSprinting);
    }
  }

  takeDamage(amount){
    if(!this.alive) return;
    this.health -= amount;
    if(this.health <=0){
      this.health = 0;
      this.alive = false;
      console.log('[Player] Died');
    }
  }

  getStateForNetwork(){
    return {
      pos: { x: this.position.x, y: this.position.y, z: this.position.z },
      rot: { x: this.pitch, y: this.yaw, z: 0 },
      vel: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      crouch: this.isCrouching,
      sprint: this.isSprinting,
      aim: this.isAiming,
      health: this.health,
      alive: this.alive
    };
  }

  getCamera(){
    return this.camera;
  }
}
