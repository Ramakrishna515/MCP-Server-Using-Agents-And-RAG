# Docker Learning Journey — From Scratch with This Project

A hands-on, project-specific guide to learn Docker **using this exact repo**
(build-mcp-server: a Node.js + TypeScript MCP server with a web portal). Every
example below works against this folder. Companion to `RUN-GUIDE.md` (§ 10).

---

## Table of Contents

1. [Docker Basics](#1-docker-basics)
2. [Docker Architecture](#2-docker-architecture)
3. [Docker Images](#3-docker-images)
4. [Docker Containers](#4-docker-containers)
5. [Dockerfile Deep Dive (this project's Dockerfile)](#5-dockerfile-deep-dive-this-projects-dockerfile)
6. [Docker Compose](#6-docker-compose)
7. [Docker Networking](#7-docker-networking)
8. [Docker Volumes](#8-docker-volumes)
9. [Best Practices](#9-best-practices)
10. [Advanced Topics](#10-advanced-topics)
11. [Hands-On Learning Path for This Repo](#11-hands-on-learning-path-for-this-repo)
12. [Common Issues & Solutions](#12-common-issues--solutions)
13. [Commands Cheatsheet](#13-commands-cheatsheet)
14. [Resources](#14-resources)
15. [Pushing to GitHub Packages (GHCR) — Manual Steps](#15-pushing-to-github-packages-ghcr--manual-steps)

---

## 1. Docker Basics

### What is Docker?
Docker packages your app **and its dependencies** into *containers* — lightweight,
portable units that run identically everywhere.

For this project that means: Node, the compiled `dist/`, the web UI (`public/`),
the data folder (`data/`) and the start command are all packed into one image.
Anyone can run your whole MCP server + web portal with a single command.

### Why Docker (for this repo)?
| Problem without Docker | With Docker |
| --- | --- |
| "works on my machine" | same image, same behavior everywhere |
| Node version mismatch (v18 vs v22) | pinned `node:22` inside the image |
| manual `npm install` + `npm run build` | baked once into the image |
| secrets in the clone | `.env` passed at run time, never in the image |

### Key concepts
```
DOCKER IMAGE (blueprint)      DOCKER CONTAINER (instance)
- read-only template          - running process from an image
- built from a Dockerfile     - can start/stop/inspect/delete
- this repo -> image tag      - one tag can spin many containers
```

### Check your setup
```bash
docker --version          # Docker CLI
docker compose version    # Compose plugin
docker info               # daemon reachable? engine + registry info
```

---

## 2. Docker Architecture

```
+---------------------------+
|  docker CLI (your shell)  |   docker build/run/ps ...
+-------------+-------------+
              |
              v
+---------------------------+
|      Docker Daemon        |   builds images, runs containers,
|      (Engine)             |   manages networks + volumes
+-------------+-------------+
              |
              v
+---------------------------+
|     Registry (Hub)        |   docker hub: node:22, etc.
+---------------------------+
```

You type `docker build/run` → the CLI tells the daemon what to do → the daemon
pulls base images and runs containers.

---

## 3. Docker Images & Layers

### Layered filesystem
Every `FROM/COPY/RUN` in a Dockerfile adds a layer. Docker **caches** unchanged
layers, so rebuilds are fast:

```
Layer 4: dist + public + data   <- changes with every build (lowest cache hit)
Layer 3: prod npm ci result     <- changes when package.json changes
Layer 2: node:22-slim base      <- changes rarely
Layer 1: OS base                <- never
```

### Image commands applied to this repo
```bash
docker images                       # list your local images
docker pull node:22                  # fetch the base image used by our Dockerfile
docker build -t build-mcp-server:latest .   # build this repo's image
docker images | grep build-mcp-server       # your image listed
docker image inspect build-mcp-server       # layers, env, exposed ports
docker rmi build-mcp-server                 # (clean up when done)
```

> Exercise: run `docker build -t build-mcp-server:latest .` twice. The second run
> is much faster because cached layers (`npm ci`) are reused.

---

## 4. Docker Containers

### Lifecycle
```
build -> create -> start/running -> stop/paused -> remove
                     container has an ID + name
```

### Container commands (with this project's image)
```bash
# Foreground run — you see the logs, Ctrl+C stops it
docker run --rm -p 3000:3000 build-mcp-server:latest

# Background run (-d), named, with your secrets
docker run -d --name mcp-server -p 4001:3000 --env-file .env build-mcp-server:latest

# Look at it
docker ps                          # running containers: mcp-server, ports 3000
docker logs mcp-server             # "Chat portal running at http://localhost:3000"
docker logs -f mcp-server          # follow the log stream

# Get inside the running container (interactive shell)
docker exec -it mcp-server sh      # then e.g. `ls dist`, `node --version`, `exit`

# Stop / remove
docker stop mcp-server
docker rm mcp-server               # remove a stopped container
```

### Port mapping explained: `-p 3000:3000`
`host:container`. The app listens on 3000 *inside* the container (`EXPOSE 3000`);
the host port is what *you* open in the browser. === `-p 3210:3000` → open
`http://localhost:3210`. You can run two containers on different host ports.

> Exercise: start two containers on ports 3000 and 3001 — both are the same image,
> independent instances.

---

## 5. Dockerfile Deep Dive (this project's Dockerfile)

### The actual file in this repo
```dockerfile
# ---- Stage 1: build ----
FROM node:22 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY public/ ./public/
COPY data/ ./data/

EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "dist/http.js"]
```

### Line by line
| Instruction | What it does here |
| --- | --- |
| `FROM node:22 AS build` | Base image; names the stage `build` |
| `WORKDIR /app` | All later commands run in `/app` |
| `COPY package.json package-lock.json ./` | Copy manifests *before* source → `npm ci` layer is cached |
| `RUN npm ci` | Reproducible install (exact versions). Includes typescript |
| `COPY tsconfig.json ./` + `COPY src/ ./src/` | Copy the TS config + source |
| `RUN npm run build` | Runs `tsc` → creates `dist/` |
| `FROM node:22-slim AS runtime` | Second stage: fresh, small image. Compiler left behind |
| `ENV NODE_ENV=production` | Environment marker |
| `RUN npm ci --omit=dev` | **Production deps only** (express, cors, sdk, zod) |
| `COPY --from=build /app/dist ./dist` | Copy `dist/` out of the first stage |
| `COPY public/ ./public/` | Web UI — `http.ts` serves it (line 268) |
| `COPY data/ ./data/` | `index.json` (RAG index) so tools work |
| `EXPOSE 3000` | Document: container listens on 3000 |
| `CMD [...]` | Start command (same as `npm run web`; tolerates missing `.env`) |

### The `npm run web` equivalence
`npm run web` = `node --env-file-if-exists=.env dist/http.js` — exactly what `CMD`
executes. So the container behaves like running the app yourself, minus secrets.

### Every main instruction (cheat table)
| Instruction | Purpose | Example |
| --- | --- | --- |
| `FROM` | Base image / stage | `FROM node:22 AS build` |
| `WORKDIR` | Working dir | `WORKDIR /app` |
| `COPY` | Copy host → image | `COPY src/ ./src/` |
| `RUN` | Run during build | `RUN npm ci` |
| `CMD` | Default start command | `CMD ["node", "dist/http.js"]` |
| `ENTRYPOINT` | Container as executable | `ENTRYPOINT ["node"]` |
| `EXPOSE` | Document port | `EXPOSE 3000` |
| `ENV` | Env vars | `ENV NODE_ENV=production` |
| `ARG` | Build-time var | `ARG PORT=3000` |
| `HEALTHCHECK` | Liveness check | see §10 |
| `USER` | Run as non-root | see §9 |

### `.dockerignore` — what gets excluded from the build
```
node_modules
dist
.git
.env
.env.example
```
Why: `npm ci` regenerates node_modules/dist *inside* the image; `.env` must stay
out so **your API keys are never baked into the image**.

---

## 6. Docker Compose

### What it is
A YAML file that runs **one or more services** with one command. This project has
a single service (the web app), plus we can add a named volume so your notes
(`data/notes.json`) survive container restarts.

### Our `docker-compose.yml` (create in the repo root)
```yaml
services:
  app:
    build: .
    image: build-mcp-server:latest
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - app-data:/app/data
    restart: unless-stopped

volumes:
  app-data:
```

### Compose commands
```bash
docker compose up -d           # build image + start service in background
docker compose ps              # show the app service + port
docker compose logs -f app     # follow logs
docker compose down            # stop and remove containers (app-data volume stays)
docker compose up --build      # rebuild after code changes
```

> Compare with running it manually: compose is the same thing but declared in a
> file — easier to share and repeat.

---

## 7. Docker Networking

| Network type | Behavior |
| --- | --- |
| **bridge** (default) | containers talk to each other by name; isolated from host |
| **host** | container shares the host network (no isolation) |
| **none** | no networking |

### Commands
```bash
docker network ls                 # list networks
docker network inspect bridge     # see connected containers
docker network create my-net      # custom network
docker run --network my-net -d --name mcp2 build-mcp-server   # join a network
```

### The practical rule for this project
Other containers reach *this* app by its **service/container name**, not
`localhost`:
- Inside compose: `curl http://app:3000`
- `localhost` inside a container points to *that container itself*

> Exercise: `docker exec -it mcp-server sh` then `curl http://app:3000` fails
> (no service named app on the default network) while `curl http://localhost:3000`
> succeeds inside the container — that's network isolation in action.

---

## 8. Docker Volumes

### Why you need one here
`data/notes.json` + `data/index.json` hold your saved notes and RAG index. A
container's filesystem is **deleted** when the container is removed. A **volume**
keeps your notes across restarts and upgrades.

### Types
1. **Named volume** — managed by Docker (our `app-data`)
2. **Bind mount** — a host folder directly: `-v /my/local/notes:/app/data`
3. **Anonymous** — auto-created, usually throwaway

### Commands
```bash
docker volume ls                      # list
docker volume inspect <name>          # show mount point on the host
docker volume rm <name>               # explicit delete (careful!)
docker volume prune                   # remove all unused volumes

# Run with a named volume (notes persist!)
docker run -d --name mcp-server \
  -p 3000:3000 -v app-data:/app/data \
  --env-file .env build-mcp-server:latest
```

> Exercise: add a note, `docker compose down`, `docker compose up -d`, check the
> note is still there — persisted by the volume.

---

## 9. Best Practices

### 1. Multi-stage build (already done in our Dockerfile)
Compiler + full toolchain live in stage 1; the final image ships only what runs:
`slim Node base + prod deps + dist + public + data`.

### 2. Cache-friendly ordering (already done)
`COPY package*.json` → `RUN npm ci` **before** copying source, so dependency
install is cached unless `package.json` changes.

### 3. Keep secrets out (already done)
`.env` is in `.dockerignore`. Always run with `--env-file .env` or compose
`env_file:`. Never `COPY .env` into an image.

### 4. Run as a non-root user
```dockerfile
FROM node:22-slim AS runtime
# ... as before ...
RUN useradd --create-home appuser
USER appuser
COPY --chown=appuser:appuser --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "dist/http.js"]
```

### 5. Which base image: `node:22` vs `node:22-slim` vs `node:22-alpine`
- `node:22` full — has build tools (better for compiling)
- `node:22-slim` — smaller Debian (used for runtime here)
- `node:22-alpine` — smallest, but native modules can need extra toolchains

---

## 10. Advanced Topics

### 1. Healthcheck (web portal)
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
```
In compose:
```yaml
services:
  app:
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 3s
      retries: 3
```

### 2. Build args
```dockerfile
ARG NODE_MAJOR=22
FROM node:${NODE_MAJOR} AS build
```
```bash
docker build --build-arg NODE_MAJOR=18 -t build-mcp-server:node18 .
```

### 3. Resource limits
```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
```
(Run-time note: `deploy` works on Swarm/K8s; for plain `docker compose` also add
`mem_limit: 256m` — `--memory` flag for `docker run`.)

### 4. Cleanup housekeeping
```bash
docker system df        # how much is cached
docker system prune -a  # remove all stopped containers, unused images/networks
docker volume prune     # only remove unused volumes (keeps app-data if used)
```

---

## 11. Hands-On Learning Path for This Repo

### Day 1 — basics
- [ ] `docker --version`, `docker info`
- [ ] Build the image: `docker build -t build-mcp-server:latest .`
- [ ] Run foreground, Ctrl+C, run `-d`, `docker ps`, `docker logs`

### Day 2 — images & Dockerfile
- [ ] Read each line of `Dockerfile` — change port, rebuild, observe caching
- [ ] Remove `.dockerignore`, rebuild — see `dist`/`node_modules` in context
- [ ] `docker image inspect build-mcp-server`

### Day 3 — compose & volumes
- [ ] Write the `docker-compose.yml` above
- [ ] `docker compose up -d`, add a note, `down`, `up -d`, confirm persistence
- [ ] `docker volume ls / inspect`

### Day 4 — production hardening
- [ ] Add `USER appuser` and `HEALTHCHECK`
- [ ] Add resource limits
- [ ] Scan the image (`docker scout quickview build-mcp-server`)

---

## 12. Common Issues & Solutions

| Issue | Symptom | Fix |
| --- | --- | --- |
| Port busy | "port is already allocated" | map another host port: `-p 3210:3000` |
| Container exits instantly | app logs then pops out | `docker logs <name>` explains; run `docker run --rm -it <img> sh` to poke inside |
| Chat answers nothing | portal loads but no LLM reply | no secrets in container → add `--env-file .env` |
| Notes lost after restart | notes empty again | add a volume `/app/data` (`-v app-data:/app/data`) |
| Rebuild picks old code | you changed src/ but container looks same | rebuild: `docker compose up --build` (or `--no-cache`) |
| Slow build every time | `npm ci` reinstalling each time | keep the `COPY package*.json` before `COPY src/` ordering |
| Disk filling up | many old images/volumes | `docker system prune`, `docker volume prune` |

---

## 13. Commands Cheatsheet

```bash
# Images
docker images                              # list
docker build -t name:tag .                 # build from this repo's Dockerfile
docker pull node:22                        # download base image
docker rmi <image>                         # remove image
docker image prune                         # remove dangling images

# Containers
docker ps                                  # running
docker ps -a                               # all
docker run -d -p 3000:3000 --env-file .env build-mcp-server
docker stop <name> / docker start <name> / docker rm <name>
docker logs -f <name>                      # follow logs
docker exec -it <name> sh                  # shell inside

# Volumes
docker volume ls / rm / prune

# Compose
docker compose up -d / down / ps / logs -f / build

# System
docker system df
docker system prune -a
```

---

## 14. Resources

- Official docs: https://docs.docker.com
- Docker Hub: https://hub.docker.com
- Node official images: https://hub.docker.com/_/node
- Best practices: https://docs.docker.com/develop/dev-best-practices
- Compose spec: https://docs.docker.com/compose

---

## 15. Pushing to GitHub Packages (GHCR) — Manual Steps

GitHub Packages is GitHub's own container registry. There is **no "upload" button** —
the package is created automatically the first time you `docker push` an image whose
name starts with `ghcr.io/<owner>/`. If the image name matches a repo name, the
package is linked to that repo; otherwise it lives under your account.

### Step 0 — prerequisites
- A GitHub account (here `Ramakrishna515`).
- Docker CLI (already installed).
- A personal access token (PAT) with the `write:packages` scope.

Create the token here: https://github.com/settings/tokens/new
(scopes to tick: `write:packages` — auto-selects `read:packages` and `delete:packages`).

### Step 1 — log Docker into GHCR
```bash
echo "PASTE_your_token_here" | docker login ghcr.io -u Ramakrishna515 --password-stdin
```

### Step 2 — tag your local image with the registry path
```bash
docker tag build-mcp-server:latest ghcr.io/ramakrishna515/mcp-server-using-agents-and-rag:latest
```
> The tag (`latest`, or a commit SHA like `c8e50ce`) becomes the package version in GitHub.

### Step 3 — push (this is what creates/publishes the package)
```bash
docker push ghcr.io/ramakrishna515/mcp-server-using-agents-and-rag:latest
```
- Every new tag you push shows up as a new version of the package.

### Step 4 — verify
```bash
docker pull ghcr.io/ramakrishna515/mcp-server-using-agents-and-rag:latest
# "Status: Image is up to date for ghcr.io/..." = published successfully
```

### Where to see it on GitHub
- Your packages: https://github.com/Ramakrishna515?tab=packages
- Repo-linked package (name matches the repo): open the repo
  https://github.com/Ramakrishna515/MCP-Server-Using-Agents-And-RAG → **Packages** tab on the right.
- Manage/delete versions: open the package → ⚙️ Settings.

### Rules of thumb
- The package is **public** if the repo is public (and the token used has public access).
- You must be logged in to GHCR with a `write:packages` token to push; pulling needs no login for public packages.
- GHCR GUI/docs: https://docs.github.com/en/packages

---

*Every command in this guide is safe to run from the repo root and works with the
`Dockerfile` + `.dockerignore` already in this project.*