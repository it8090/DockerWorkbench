import type { Connection, ConnectParams, Engine, Secrets } from "./types";

// Display metadata and client write permissions do not affect connectivity.
export function connectionTestKey(
  connection: Connection,
  secrets: Secrets = {},
) {
  const { id, transport, endpoint, ssh, tls, apiVersion, timeout, keepAlive } =
    connection;
  return JSON.stringify({
    id,
    transport,
    endpoint,
    ssh,
    tls,
    apiVersion,
    timeout,
    keepAlive,
    secrets: {
      password: secrets.password || "",
      passphrase: secrets.passphrase || "",
      proxyPassword: secrets.proxyPassword || "",
    },
  });
}

export function needsConnectionTest(
  params: ConnectParams,
  initial?: Connection,
  proof = "",
) {
  const key = connectionTestKey(params.connection, params.secrets);
  return proof !== key && (!initial?.id || key !== connectionTestKey(initial));
}

export async function saveConnectionSettings(
  params: ConnectParams,
  initial: Connection | undefined,
  proof: string,
  api: {
    test: (params: ConnectParams) => Promise<Engine>;
    save: (params: ConnectParams) => Promise<Connection>;
  },
) {
  const engine = needsConnectionTest(params, initial, proof)
    ? await api.test(params)
    : undefined;
  const connection = await api.save(params);
  return { connection, engine };
}
