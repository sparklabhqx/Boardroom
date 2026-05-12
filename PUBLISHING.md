# Publishing Boardroom

The Boardroom v1 source is committed locally. The GitHub repository could not be populated from this Codex session because every available write path was blocked:

- The GitHub app has read-only access to `sparklabhqx/Boardroom`.
- The GitHub contents API returned `403 Resource not accessible by integration`.
- HTTPS Git push has no usable username/token.
- SSH Git push failed with `Permission denied (publickey)`.
- `~/.config/gh/hosts.yml` does not contain a GitHub token, and `gh` is not installed.

## Preferred Push

After GitHub credentials are available:

```bash
cd /Users/flo/Boardroom
git push -u origin main
```

## Import From Bundle

The verified bundle can recreate the local `main` branch:

```bash
cd /tmp
git clone /Users/flo/Boardroom/boardroom-v1.bundle Boardroom-import
cd Boardroom-import
git remote set-url origin https://github.com/sparklabhqx/Boardroom.git
git push -u origin main
```

## Apply Patch

The patch can be applied into a fresh empty clone:

```bash
git clone https://github.com/sparklabhqx/Boardroom.git Boardroom-import
cd Boardroom-import
git am /Users/flo/Boardroom/0001-Build-Boardroom-v1.patch
git push -u origin main
```

## Source Zip

`boardroom-v1-source.zip` contains only the committed project source. It excludes `node_modules`, `dist`, and local handoff artifacts.
