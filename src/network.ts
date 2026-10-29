import Peer, { DataConnection } from 'peerjs';
import { TankControls } from './tank.ts';

export type NetworkRole = 'host' | 'guest' | null;

export interface NetMessage {
  type: string;
  [key: string]: unknown;
}

// Serialisable snapshot sent from host → guest every tick
export interface GameSnapshot {
  type: 'state';
  p1: { x: number; y: number; angle: number; alive: boolean; weapon: string; ammo: number; boostCd: number };
  p2: { x: number; y: number; angle: number; alive: boolean; weapon: string; ammo: number; boostCd: number };
  bullets: { x: number; y: number; vx: number; vy: number; r: number; ownerId: number; isPellet: boolean }[];
  lasers: { points: { x: number; y: number }[]; alpha: number; ownerId: number }[];
  crates: { x: number; y: number; type: string; rotation: number }[];
  scores: [number, number];
  state: string;
  countdownTimer: number;
  suddenDeathTime: number;
  suddenDeathActive: boolean;
  timeScale: number;
}

export interface ControlsMessage {
  type: 'controls';
  forward: boolean;
  reverse: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  shoot: boolean;
  boost: boolean;
}

export interface MazeDataMessage {
  type: 'maze';
  cols: number;
  rows: number;
  cellSize: number;
  originX: number;
  originY: number;
  gridData: string; // JSON of cell grid
  segmentData: string; // JSON of segments
  p1Spawn: { x: number; y: number; angle: number };
  p2Spawn: { x: number; y: number; angle: number };
  canvasWidth: number;
  canvasHeight: number;
}

export class NetworkManager {
  public peer: Peer | null = null;
  public connection: DataConnection | null = null;
  public role: NetworkRole = null;
  public roomCode: string = '';
  public isConnected: boolean = false;

  // Guest receives latest remote controls to feed into host's game loop
  public remoteControls: TankControls = {
    forward: false, reverse: false, turnLeft: false, turnRight: false, shoot: false, boost: false
  };

  // Guest receives game snapshots from host
  public latestSnapshot: GameSnapshot | null = null;
  public latestMaze: MazeDataMessage | null = null;
  public onMazeReceived: (() => void) | null = null;

  // Callbacks for UI updates
  public onConnect?: () => void;
  public onDisconnect?: (reason: string) => void;
  public onError?: (msg: string) => void;

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  // HOST creates a room and waits for a guest to join
  public async hostGame(): Promise<string> {
    this.role = 'host';
    this.roomCode = this.generateRoomCode();

    return new Promise((resolve, reject) => {
      // Use the room code as the Peer ID so the guest can connect directly
      this.peer = new Peer('tank-arena-' + this.roomCode, {
        debug: 0
      });

      this.peer.on('open', (id: string) => {
        resolve(this.roomCode);
      });

      this.peer.on('error', (err: Error) => {
        // If ID is taken, try again with a new code
        if (err.message.includes('is taken') || err.message.includes('ID')) {
          this.peer?.destroy();
          this.roomCode = this.generateRoomCode();
          this.peer = new Peer('tank-arena-' + this.roomCode, { debug: 0 });
          this.peer.on('open', () => resolve(this.roomCode));
          this.peer.on('error', (err2: Error) => {
            if (this.onError) this.onError('Failed to create room: ' + err2.message);
            reject(err2);
          });
          this.peer.on('connection', (conn: DataConnection) => this.handleConnection(conn));
        } else {
          if (this.onError) this.onError('Connection error: ' + err.message);
          reject(err);
        }
      });

      this.peer.on('connection', (conn: DataConnection) => {
        this.handleConnection(conn);
      });
    });
  }

  // GUEST joins an existing room
  public async joinGame(roomCode: string): Promise<void> {
    this.role = 'guest';
    this.roomCode = roomCode.toUpperCase().trim();

    return new Promise((resolve, reject) => {
      this.peer = new Peer(undefined as unknown as string, { debug: 0 });

      this.peer.on('open', () => {
        const conn = this.peer!.connect('tank-arena-' + this.roomCode, {
          reliable: true
        });

        conn.on('open', () => {
          this.handleConnection(conn);
          resolve();
        });

        conn.on('error', (err: Error) => {
          if (this.onError) this.onError('Connection failed: ' + err.message);
          reject(err);
        });

        // Timeout if host isn't found in 10 seconds
        setTimeout(() => {
          if (!this.isConnected) {
            if (this.onError) this.onError('Room not found. Check the code and try again.');
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      });

      this.peer.on('error', (err: Error) => {
        if (err.message.includes('Could not connect')) {
          if (this.onError) this.onError('Room not found. Check the code and try again.');
        } else {
          if (this.onError) this.onError('Error: ' + err.message);
        }
        reject(err);
      });
    });
  }

  private handleConnection(conn: DataConnection) {
    this.connection = conn;
    this.isConnected = true;

    if (this.onConnect) this.onConnect();

    conn.on('data', (raw: unknown) => {
      const data = raw as NetMessage;
      this.handleMessage(data);
    });

    conn.on('close', () => {
      this.isConnected = false;
      if (this.onDisconnect) this.onDisconnect('Opponent disconnected.');
    });

    conn.on('error', (err: Error) => {
      this.isConnected = false;
      if (this.onDisconnect) this.onDisconnect('Connection error: ' + err.message);
    });
  }

  private handleMessage(data: NetMessage) {
    if (data.type === 'controls') {
      const c = data as unknown as ControlsMessage;
      this.remoteControls.forward = c.forward;
      this.remoteControls.reverse = c.reverse;
      this.remoteControls.turnLeft = c.turnLeft;
      this.remoteControls.turnRight = c.turnRight;
      this.remoteControls.shoot = c.shoot;
      this.remoteControls.boost = c.boost;
    } else if (data.type === 'state') {
      this.latestSnapshot = data as unknown as GameSnapshot;
    } else if (data.type === 'maze') {
      this.latestMaze = data as unknown as MazeDataMessage;
      if (this.onMazeReceived) this.onMazeReceived();
    }
  }

  // Host sends full game state to guest
  public sendSnapshot(snapshot: GameSnapshot) {
    if (this.connection && this.isConnected) {
      this.connection.send(snapshot);
    }
  }

  // Guest sends their controls to host
  public sendControls(controls: TankControls) {
    if (this.connection && this.isConnected) {
      const msg: ControlsMessage = {
        type: 'controls',
        forward: controls.forward,
        reverse: controls.reverse,
        turnLeft: controls.turnLeft,
        turnRight: controls.turnRight,
        shoot: controls.shoot,
        boost: controls.boost
      };
      this.connection.send(msg);
    }
  }

  // Host sends maze layout to guest
  public sendMaze(mazeData: MazeDataMessage) {
    if (this.connection && this.isConnected) {
      this.connection.send(mazeData);
    }
  }

  public disconnect() {
    this.isConnected = false;
    this.connection?.close();
    this.peer?.destroy();
    this.peer = null;
    this.connection = null;
    this.role = null;
  }
}
