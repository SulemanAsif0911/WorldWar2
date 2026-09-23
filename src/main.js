import './styles.css';
import { Game } from './game/Game.js';

console.log('%c WW2 RUINS ARENA ', 'background:#ff3b30;color:white;padding:10px;font-size:20px;font-weight:bold');
console.log('Made by Suleman Asif | LAN Multiplayer | Free For All');

const game = new Game();
game.init();
