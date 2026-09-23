export class Input {
  constructor(){
    this.keys = {};
    this.mouse = { x:0, y:0, dx:0, dy:0, left:false, right:false };
    this.locked = false;
    this.sensitivity = 1.0;
    this.adsSensitivity = 0.7;
    this.invertY = false;

    this._onKeyDown = this.onKeyDown.bind(this);
    this._onKeyUp = this.onKeyUp.bind(this);
    this._onMouseMove = this.onMouseMove.bind(this);
    this._onMouseDown = this.onMouseDown.bind(this);
    this._onMouseUp = this.onMouseUp.bind(this);
    this._onLockChange = this.onLockChange.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  onKeyDown(e){
    const k = e.key.toLowerCase();
    this.keys[k] = true;
    // prevent stuck tab etc but allow chat input focus handling outside
    if(['w','a','s','d','shift','control',' ','r','b','tab','enter','escape'].includes(k)){
      // don't prevent if typing in input
      if(document.activeElement && (document.activeElement.tagName==='INPUT' || document.activeElement.tagName==='TEXTAREA')) return;
    }
  }
  onKeyUp(e){
    const k = e.key.toLowerCase();
    this.keys[k] = false;
  }
  onMouseMove(e){
    if(this.locked){
      this.mouse.dx = e.movementX || 0;
      this.mouse.dy = e.movementY || 0;
      this.mouse.x += this.mouse.dx;
      this.mouse.y += this.mouse.dy;
    }
  }
  onMouseDown(e){
    if(e.button===0) this.mouse.left = true;
    if(e.button===2) this.mouse.right = true;
  }
  onMouseUp(e){
    if(e.button===0) this.mouse.left = false;
    if(e.button===2) this.mouse.right = false;
  }
  onLockChange(){
    this.locked = document.pointerLockElement !== null;
  }

  isDown(key){
    return !!this.keys[key.toLowerCase()];
  }

  consumeMouseDelta(){
    const dx = this.mouse.dx;
    const dy = this.mouse.dy;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return { dx, dy };
  }

  lock(canvas){
    if(canvas) canvas.requestPointerLock();
  }
  unlock(){
    document.exitPointerLock();
  }

  destroy(){
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
