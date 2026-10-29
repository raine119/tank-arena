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
  gridData: string; // JSON of cell grid
  segmentData: string; // JSON of segments
  p1Spawn: { x: number; y: number; angle: number };
  p2Spawn: { x: number; y: number; angle: number };
  canvasWidth: number;
  canvasHeight: number;
}

// Enterprise & School Wi-Fi ICE Server Configuration
// Includes STUN + Public OpenRelay TURN servers (bypasses restrictive symmetric NAT and school firewalls over port 443 TLS)
export const ROBUST_ICE_SERVERS: RTCIceServer[] = [
  // Fast public STUN servers for direct P2P hole punching
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },

  // OpenRelay free public TURN relays: forces traffic through HTTPS (port 443/80 TCP/TLS) when school firewall blocks UDP
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
  public onPing?: (ms: number) => void;

  private pingTimer: number = 0;

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  // Create Peer instance with full firewall-traversal configuration
  private createPeerInstance(id?: string): Peer {
    return new Peer(id as unknown as string, {
      debug: 1,
      config: {
        iceServers: ROBUST_ICE_SERVERS,
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all'
      }
    });
  }

  // HOST creates a room and waits for a guest to join
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
      this.peer = this.createPeerInstance();

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

        // 12-second connection timeout for slow mobile/school networks
        setTimeout(() => {
          if (!this.isConnected) {
            if (this.onError) this.onError('Connection timed out. Check the room code and try again.');
            reject(new Error('Connection timeout'));
          }
        }, 12000);
      });

      this.peer.on('error', (err: Error) => {
        if (err.message.includes('Could not connect') || err.message.includes('not found')) {
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

    // Start ping heartbeat
    if (this.role === 'guest') {
      window.setInterval(() => {
        if (this.isConnected && this.connection) {
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
      if (this.onMazeReceived) this.onMazeReceived();
    } else if (data.type === 'ping') {
      if (this.connection && this.isConnected) {
        this.connection.send({ type: 'pong', sentAt: data.sentAt });
      }
    } else if (data.type === 'pong') {
      const sentAt = data.sentAt as number;
      this.pingMs = Math.round(performance.now() - sentAt);
      if (this.onPing) this.onPing(this.pingMs);
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
