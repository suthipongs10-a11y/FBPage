#!/usr/bin/env bash
# Read-only host inventory. Never installs, stops services, reads secrets or prunes.
set -eu
printf '\nSocialManage VPS preflight (read-only)\n'
date -u '+UTC %Y-%m-%dT%H:%M:%SZ'
printf '\nOS / CPU\n'
cat /etc/os-release
uname -m
getconf _NPROCESSORS_ONLN
printf '\nMemory / swap\n'
free -m
printf '\nDisk / inodes\n'
df -h / /var
df -i / /var
printf '\nListening TCP ports (no process arguments)\n'
ss -ltn
printf '\nRunning service names\n'
systemctl list-units --type=service --state=running --no-pager --no-legend || true
printf '\nDocker availability\n'
if command -v docker >/dev/null 2>&1; then
  docker --version
  docker compose version || true
  # Deliberately omit docker inspect, env, logs and container command arguments.
  if docker info --format 'CPUs={{.NCPU}} MemoryBytes={{.MemTotal}} Root={{.DockerRootDir}}' 2>/dev/null; then
    docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
    docker system df
  else
    printf 'Docker daemon inaccessible to current user; do not change group membership automatically.\n'
  fi
else
  printf 'Docker is not installed.\n'
fi
printf '\nNo deployment performed. Review resource headroom, existing services and domain before approval.\n'
