import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = resolve(process.argv[2] || "release-assets");
const version = JSON.parse(readFileSync(join(root, "package.json"))).version;
const configuration = JSON.parse(
  readFileSync(join(root, "src-tauri/tauri.conf.json")),
);
const publicKey = Buffer.from(configuration.plugins.updater.pubkey, "base64")
  .toString("utf8")
  .trim()
  .split(/\r?\n/)
  .at(-1);
const repository = process.env.GITHUB_REPOSITORY || "it8090/DockerWorkbench";
const expected = [
  "darwin-aarch64",
  "darwin-x86_64",
  "windows-x86_64",
  "linux-x86_64",
];
const platforms = {};
const files = readdirSync(directory);
const temporary = mkdtempSync(join(tmpdir(), "workbench-signatures-"));
try {
  for (const platform of expected) {
    const fragment = JSON.parse(
      readFileSync(join(directory, `update-${platform}.json`)),
    );
    const expectedUrl = `https://github.com/${repository}/releases/download/v${version}/${fragment.filename}`;
    if (
      fragment.version !== version ||
      fragment.platform !== platform ||
      fragment.url !== expectedUrl ||
      fragment.filename !== fragment.filename.split(/[\\/]/).at(-1)
    )
      throw new Error(`Invalid update metadata for ${platform}`);
    const signature = readFileSync(
      join(directory, `${fragment.filename}.sig`),
      "utf8",
    ).trim();
    if (signature !== fragment.signature)
      throw new Error(`Signature metadata mismatch for ${platform}`);
    const decoded = join(temporary, `${platform}.minisig`);
    writeFileSync(decoded, Buffer.from(signature, "base64"));
    execFileSync(
      "minisign",
      [
        "-Vm",
        join(directory, fragment.filename),
        "-x",
        decoded,
        "-P",
        publicKey,
      ],
      { stdio: "inherit" },
    );
    platforms[platform] = { url: fragment.url, signature };
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
const notes = readFileSync(
  join(root, `../docs/releases/${version}.md`),
  "utf8",
);
writeFileSync(
  join(directory, "latest.json"),
  JSON.stringify(
    { version, notes, pub_date: new Date().toISOString(), platforms },
    null,
    2,
  ) + "\n",
);
const publicFiles = [
  ...files.filter(
    (name) =>
      !name.startsWith("update-") &&
      name !== "SHA256SUMS.txt" &&
      name !== "latest.json",
  ),
  "latest.json",
].sort();
writeFileSync(
  join(directory, "SHA256SUMS.txt"),
  publicFiles
    .map(
      (name) =>
        `${createHash("sha256")
          .update(readFileSync(join(directory, name)))
          .digest("hex")}  ${name}`,
    )
    .join("\n") + "\n",
);
console.log(
  `Verified all ${expected.length} platforms; generated latest.json and SHA256SUMS.txt`,
);
