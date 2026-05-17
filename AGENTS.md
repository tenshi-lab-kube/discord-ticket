# Project Rules

- When modifying the Discord bot, prepare the GitHub push workflow: review the diff, run the relevant checks, stage the intended files, create a commit, and push the branch when the user wants the change shipped.
- ArgoCD deploys this project from `main` using `argocd/application.yaml` and the `k8s` manifests. For bot code changes that should roll out, update `spec.template.metadata.annotations.app.kubernetes.io/restarted-at` in `k8s/deployment.yaml` so ArgoCD applies a fresh Deployment rollout after the push.
- Keep rollout changes in the same commit as the bot change unless the user asks for a separate release commit.
