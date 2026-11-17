export type Language = "zh-CN" | "en";
export interface Workspace {
  id: string;
  name: string;
}
export interface Connection {
  id: string;
  workspaceId: string;
  name: string;
  environment: string;
  transport: "ssh" | "unix" | "npipe" | "tls";
  endpoint: string;
  ssh: {
    host: string;
    port: number;
    user: string;
    auth: "key" | "password" | "agent";
    keyPath: string;
    alias?: string;
    parseConfig: boolean;
    socketPath: string;
    jumpHost?: string;
    proxyType?: string;
    proxyAddress?: string;
    proxyUser?: string;
  };
  tls: { caPath: string; certPath: string; keyPath: string };
  apiVersion: string;
  timeout: number;
  keepAlive: number;
  readOnly: boolean;
  hasCredentials: boolean;
}
export interface Secrets {
  password?: string;
  passphrase?: string;
  proxyPassword?: string;
}
export interface ConnectParams {
  connection: Connection;
  secrets: Secrets;
  remember: boolean;
}
export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  project: string;
  service: string;
  ports: string[];
  created: number;
  labels: Record<string, string>;
}
export interface Engine {
  version: string;
  apiVersion: string;
  serverApi: string;
  minApi: string;
  os: string;
  arch: string;
}
export interface Binding {
  connectionId: string;
  project: string;
  workingDirectory: string;
  files: string[];
  envFiles: string[];
  profiles: string[];
}
export interface Snapshot {
  connectionId: string;
  engine: Engine;
  containers: Container[];
  bindings: Binding[];
}
export interface LogEntry {
  connectionId: string;
  containerId: string;
  source: string;
  time: string;
  stream: string;
  level: string;
  message: string;
  seq: number;
}
export interface Stats {
  containerId: string;
  time: string;
  cpu: number;
  memory: number;
  memoryLimit: number;
  rx: number;
  tx: number;
}
export interface Operation {
  id: string;
  connectionId: string;
  target: string;
  action: string;
  status: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}
export interface Plan {
  token: string;
  connectionId: string;
  host: string;
  action: string;
  targets: Container[];
  expiresAt: string;
  binding?: Binding;
}
export interface AppError {
  code: string;
  message: string;
  data?: Record<string, string>;
}
export interface StreamEvent {
  streamId: string;
  kind: string;
  data?: unknown;
  error?: AppError;
}
export interface Resource {
  ID?: string;
  Id?: string;
  Name?: string;
  RepoTags?: string[];
  Driver?: string;
  Size?: number;
  Mountpoint?: string;
  Labels?: Record<string, string>;
  [key: string]: unknown;
}
export const newConnection = (): Connection => ({
  id: "",
  workspaceId: "default",
  name: "",
  environment: "development",
  transport: "ssh",
  endpoint: "",
  ssh: {
    host: "",
    port: 22,
    user: "",
    auth: "key",
    keyPath: "",
    parseConfig: true,
    socketPath: "/var/run/docker.sock",
    proxyType: "none",
  },
  tls: { caPath: "", certPath: "", keyPath: "" },
  apiVersion: "",
  timeout: 15,
  keepAlive: 30,
  readOnly: true,
  hasCredentials: false,
});
