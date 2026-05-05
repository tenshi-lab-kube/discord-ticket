# Discord Ticket Kubernetes Deployment

This directory is synced by Argo CD.

Required secrets are created outside Git:

```sh
kubectl -n discord-ticket create secret generic discord-ticket-env \
  --from-env-file=.env

kubectl -n discord-ticket create secret generic discord-ticket-config \
  --from-file=config.json=config.json
```

Authentik OIDC provider:

```text
Name: discord-ticket
Slug: discord-ticket
Issuer: https://auth.tenshi-lab.fr/application/o/discord-ticket/
Redirect URI strict: https://tickets.tenshi-lab.fr/auth/oidc/callback
Scopes: openid profile email
```

Add these values to `.env` or recreate `discord-ticket-env` with literals:

```text
OIDC_ISSUER=https://auth.tenshi-lab.fr/application/o/discord-ticket/
OIDC_CLIENT_ID=<authentik-client-id>
OIDC_CLIENT_SECRET=<authentik-client-secret>
OIDC_REDIRECT_URI=https://tickets.tenshi-lab.fr/auth/oidc/callback
OIDC_SCOPES=openid profile email
```

Cloudflare Tunnel public hostname:

```text
tickets.tenshi-lab.fr -> http://discord-ticket.discord-ticket.svc.cluster.local:3000
```
