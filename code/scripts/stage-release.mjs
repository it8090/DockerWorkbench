import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({
  options: { platform: { type: "string" }, bundle: { type: "string" } },
});
const { platform, bundle } = values;
const updaterExtension = {
  "darwin-aarch64": ".app.tar.gz",
  "darwin-x86_64": ".app.tar.gz",
  "windows-x86_64": ".exe",
  "linux-x86_64": ".AppImage",
}[platform];
if (!updaterExtension || !bundle)
  throw new Error("Expected a supported --platform and --bundle directory");
const version = JSON.parse(readFileSync(join(root, "package.json"))).version;
const repository = process.env.GITHUB_REPOSITORY || "it8090/DockerWorkbench";
const destination = join(root, "outputs/release", platform);
mkdirSync(destination, { recursive: true });
const paths = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.endsWith(".app"))
      walk(join(directory, entry.name));
    else if (
      entry.isFile() &&
      /\.(dmg|app\.tar\.gz|exe|msi|AppImage|deb|rpm)$/.test(entry.name)
    )
      paths.push(join(directory, entry.name));
  }
}
walk(resolve(root, bundle));
let update;
for (const path of paths) {
  const extension = path.endsWith(".app.tar.gz")
    ? ".app.tar.gz"
    : path.slice(path.lastIndexOf("."));
  const filename = `DockerWorkbench_${version}_${platform}${extension}`;
  copyFileSync(path, join(destination, filename));
  if (extension === updaterExtension) {
    if (update) throw new Error(`Multiple update bundles for ${platform}`);
    const signature = readFileSync(`${path}.sig`, "utf8").trim();
    if (!signature)
      throw new Error(`Missing updater signature for ${platform}`);
    copyFileSync(`${path}.sig`, join(destination, `${filename}.sig`));
    update = {
      version,
      platform,
      filename,
      signature,
      url: `https://github.com/${repository}/releases/download/v${version}/${filename}`,
    };
  }
}
if (!update) throw new Error(`No signed update bundle for ${platform}`);
writeFileSync(
  join(destination, `update-${platform}.json`),
  JSON.stringify(update, null, 2) + "\n",
);
console.log(
  `Staged ${paths.length} installer(s) and signed updater for ${platform}`,
);
