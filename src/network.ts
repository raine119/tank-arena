import Peer, { DataConnection } from 'peerjs';
import { TankControls } from './tank.ts';

export type NetworkRole = 'host' | 'guest' | null;

export interface NetMessage {
  type: string;
  [key: string]: unknown;
}

// Serialisable snapshot sent from host → guest
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
  timestamp: number;
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
  gridData: string;
  segmentData: string;
  p1Spawn: { x: number; y: number; angle: number };
  p2Spawn: { x: number; y: number; angle: number };
  canvasWidth: number;
  canvasHeight: number;
}

// Comprehensive STUN + TURN server pool
// Uses multiple STUN mirrors + OpenRelay TURN servers (traversing school symmetric NAT and firewalls)
export const ROBUST_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },

  // OpenRelay Public TURN Relay (Port 443 HTTPS bypasses school firewall blocks on raw UDP)
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

export class NetworkManager {
  public peer: Peer | null = null;
  public connection: DataConnection | null = null;
  public role: NetworkRole = null;
  public roomCode: string = '';
  public isConnected: boolean = false;
  public pingMs: number = 0;

  public remoteControls: TankControls = {
    forward: false, reverse: false, turnLeft: false, turnRight: false, shoot: false, boost: false
  };

  public latestSnapshot: GameSnapshot | null = null;
  public latestMaze: MazeDataMessage | null = null;

  public onMazeReceived?: (maze: MazeDataMessage) => void;
  public onConnect?: () => void;
  public onGuestReady?: () => void;
  public onDisconnect?: (reason: string) => void;
  public onError?: (msg: string) => void;
  public onPing?: (ms: number) => void;

  private pingIntervalId: number | null = null;

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  private createPeerInstance(id?: string): Peer {
    return new Peer(id as unknown as string, {
      debug: 1,
      config: {
        iceServers: ROBUST_ICE_SERVERS,
        iceCandidatePoolSize: 10
      }
    });
  }

  // HOST creates room and awaits connection
  public async hostGame(): Promise<string> {
    this.role = 'host';
    this.roomCode = this.generateRoomCode();

    return new Promise((resolve, reject) => {
      this.peer = this.createPeerInstance('tank-arena-' + this.roomCode);

      this.peer.on('open', () => {
        resolve(this.roomCode);
      });

      this.peer.on('error', (err: Error) => {
        if (err.message.includes('is taken') || err.message.includes('ID')) {
          this.peer?.destroy();
          this.roomCode = this.generateRoomCode();
          this.peer = this.createPeerInstance('tank-arena-' + this.roomCode);
          this.peer.on('open', () => resolve(this.roomCode));
          this.peer.on('error', (err2: Error) => {
            if (this.onError) this.onError('Failed to create room: ' + err2.message);
            reject(err2);
          });
          this.setupHostConnectionListener();
        } else {
          if (this.onError) this.onError('Connection error: ' + err.message);
          reject(err);
        }
      });

      this.setupHostConnectionListener();
    });
  }

  private setupHostConnectionListener() {
    if (!this.peer) return;

    this.peer.on('connection', (conn: DataConnection) => {
      conn.on('open', () => {
        this.connection = conn;
        this.isConnected = true;
        this.bindDataChannel(conn);
        if (this.onConnect) this.onConnect();
      });

      conn.on('close', () => {
        this.handleClose('Opponent disconnected.');
      });

      conn.on('error', (err: Error) => {
        console.warn('[NET] Host connection warning/error:', err);
        this.handleClose('Connection error: ' + err.message);
      });
    });
  }

  // GUEST joins an existing room
  public async joinGame(roomCode: string): Promise<void> {
    this.role = 'guest';
    this.roomCode = roomCode.toUpperCase().trim();

    return new Promise((resolve, reject) => {
      this.peer = this.createPeerInstance();

      let connectTimeout: number | null = null;

      this.peer.on('open', () => {
        const conn = this.peer!.connect('tank-arena-' + this.roomCode, {
          reliable: true
        });

        connectTimeout = window.setTimeout(() => {
          if (!this.isConnected) {
            if (this.onError) this.onError('Could not connect to room. Check the code and try again.');
            reject(new Error('Connection timeout'));
          }
        }, 15000);

        conn.on('open', () => {
          if (connectTimeout) {
            clearTimeout(connectTimeout);
            connectTimeout = null;
          }
          this.connection = conn;
          this.isConnected = true;
          this.bindDataChannel(conn);

          // Signal to host that guest is ready to receive maze
          conn.send({ type: 'ready' });

          if (this.onConnect) this.onConnect();
          resolve();
        });

        conn.on('close', () => {
          this.handleClose('Opponent disconnected.');
        });

        conn.on('error', (err: Error) => {
          console.warn('[NET] Guest connection warning/error:', err);
          this.handleClose('Connection error: ' + err.message);
          reject(err);
        });
      });

      this.peer.on('error', (err: Error) => {
        if (connectTimeout) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }
        const msg = err.message || '';
        if (msg.includes('Could not connect') || msg.includes('not found') || (err as { type?: string }).type === 'peer-unavailable') {
          if (this.onError) this.onError('Room not found. Check the room code.');
        } else {
          if (this.onError) this.onError('Error: ' + msg);
        }
        reject(err);
      });
    });
  }

  private bindDataChannel(conn: DataConnection) {
    conn.on('data', (raw: unknown) => {
      const data = raw as NetMessage;
      this.handleMessage(data);
    });

    // Start heartbeat ping
    if (this.role === 'guest') {
      if (this.pingIntervalId) clearInterval(this.pingIntervalId);
      this.pingIntervalId = window.setInterval(() => {
        if (this.isConnected && this.connection && this.connection.open) {
          this.connection.send({ type: 'ping', sentAt: performance.now() });
        }
      }, 1500);
    }
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
      if (this.onMazeReceived) this.onMazeReceived(this.latestMaze);
    } else if (data.type === 'ready' && this.role === 'host') {
      // Guest is ready! Send initial maze
      if (this.onGuestReady) this.onGuestReady();
    } else if (data.type === 'ping') {
      if (this.connection && this.connection.open) {
        this.connection.send({ type: 'pong', sentAt: data.sentAt });
      }
    } else if (data.type === 'pong') {
      const sentAt = data.sentAt as number;
      this.pingMs = Math.round(performance.now() - sentAt);
      if (this.onPing) this.onPing(this.pingMs);
    }
  }

  private handleClose(reason: string) {
    if (!this.isConnected) return;
    this.isConnected = false;
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
    if (this.onDisconnect) this.onDisconnect(reason);
  }

  // Safe send: Only sends if connection exists and is fully open!
  public sendSnapshot(snapshot: GameSnapshot) {
    if (this.connection && this.isConnected && this.connection.open) {
      this.connection.send(snapshot);
    }
  }

  public sendControls(controls: TankControls) {
    if (this.connection && this.isConnected && this.connection.open) {
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

  public sendMaze(mazeData: MazeDataMessage) {
    if (this.connection && this.isConnected && this.connection.open) {
      this.connection.send(mazeData);
    }
  }

  public disconnect() {
    this.isConnected = false;
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
    this.connection?.close();
    this.peer?.destroy();
    this.peer = null;
    this.connection = null;
    this.role = null;
  }
}
