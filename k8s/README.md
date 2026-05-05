# Discord Ticket Kubernetes Deployment

This directory is synced by Argo CD.

Required secrets are created outside Git:

```sh
kubectl -n discord-ticket create secret generic discord-ticket-env \
  --from-env-file=.env

kubectl -n discord-ticket create secret generic discord-ticket-config \
  --from-file=config.json=config.json
```

Cloudflare Tunnel public hostname:

```text
tickets.tenshi-lab.fr -> http://discord-ticket.discord-ticket.svc.cluster.local:3000
```
