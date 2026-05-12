# Discord Ticket Kubernetes Deployment

This directory is synced by Argo CD.

Required secrets are created outside Git:

```sh
kubectl -n discord-ticket create secret generic discord-ticket-env \
  --from-literal=BOT_TOKEN=... \
  --from-literal=CLIENT_ID=... \
  --from-literal=DISCORD_OAUTH_CLIENT_ID=... \
  --from-literal=DISCORD_OAUTH_CLIENT_SECRET=... \
  --from-literal=SESSION_SECRET=...

kubectl -n discord-ticket create secret generic discord-ticket-config \
  --from-file=config.json=config.json
```

Cloudflare Tunnel public hostname:

```text
tickets.tenshi-lab.fr -> http://discord-ticket.discord-ticket.svc.cluster.local:3000
```

Discord OAuth callback:

```text
https://tickets.tenshi-lab.fr/auth/discord/callback
```

The runtime `config.json` is multi-guild. Keep the new 16k-member guild with
`enabled: false` until the staff pilot is complete.

To update an existing secret without deleting it first:

```sh
kubectl -n discord-ticket create secret generic discord-ticket-env \
  --from-literal=BOT_TOKEN=... \
  --from-literal=CLIENT_ID=... \
  --from-literal=DISCORD_OAUTH_CLIENT_ID=... \
  --from-literal=DISCORD_OAUTH_CLIENT_SECRET=... \
  --from-literal=SESSION_SECRET=... \
  --dry-run=client -o yaml | kubectl apply -f -
```
