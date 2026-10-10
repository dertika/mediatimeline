import { accessSync, constants, mkdirSync } from "node:fs";

/**
 * Makes sure the data dir exists and is writable. Returns a short hint for
 * the log instead of SQLite's "unable to open database file" when it is not,
 * e.g. a bind mount owned by root while the container runs as uid 1000.
 */
export function dataDirProblem(dir: string): string | null {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK | constants.X_OK);
    return null;
  } catch (err) {
    const uid = process.getuid?.() ?? "?";
    const gid = process.getgid?.() ?? "?";
    return [
      `Data directory ${dir} is not writable (${(err as NodeJS.ErrnoException).code ?? String(err)}).`,
      `mediatimeline runs as uid ${uid}, gid ${gid}. Either give the mounted host directory to that user,`,
      `e.g. \`sudo chown -R ${uid}:${gid} /path/to/data\`, or start the container as the directory's owner`,
      `(Docker/Compose: \`user: "<uid>:<gid>"\`). With Podman, mounting with \`:U\` does this automatically.`,
    ].join("\n");
  }
}
