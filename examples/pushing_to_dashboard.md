# Connect BRL-CAD Performance Runner to Dashboard Repo auto-deploy

This repo expects incoming data to be committed as
~~~text
data/runs/<timestamp>-<commit>/summary.json
~~~

## 1. Create a dedicated SSH deploy key

Run locally:

~~~bash
ssh-keygen -t ed25519 -C "brlcad-performance-dashboard-deploy" -f brlcad_dashboard_deploy_key
~~~

This creates:

~~~text
brlcad_dashboard_deploy_key      # private key
brlcad_dashboard_deploy_key.pub  # public key
~~~

Do not commit either file.

---

## 2. Add the public key to the dashboard (this) repo

In GitHub:

~~~text
  -> Settings
  -> Deploy keys
  -> Add deploy key
~~~

The write access checkbox is required because the sending workflow will push commits into this repo.

---

## 3. Add the private key to the sending repo secrets

In GitHub:

~~~text
  -> Settings
  -> Secrets and variables
  -> Actions
  -> New repository secret
~~~

The name will be used within the runners yml - use something like DASHBOARD_DEPLOY_KEY.

---

## 4. Add this minimal publish block to the sender's workflow

Place this after the step that creates:

~~~text
$RESULTS_ROOT/summary/run.json
~~~

Example:

~~~yaml
      - name: Checkout dashboard repo
        if: always()
        uses: actions/checkout@v4
        with:
          repository: f4alt/brlcad_performance_dashboard
          path: brlcad_performance_dashboard
          ssh-key: ${{ secrets.DASHBOARD_DEPLOY_KEY }}

      - name: Commit performance summary to dashboard repo
        if: always()
        run: |
          set -Eeuo pipefail

          src="$RESULTS_ROOT/summary/run.json"
          test -f "$src"

          short_sha="${GITHUB_SHA::12}"
          timestamp="$(date -u +'%Y-%m-%dT%H%M%SZ')"
          run_id="${timestamp}-${short_sha}"

          dest_dir="brlcad_performance_dashboard/data/runs/${run_id}"
          mkdir -p "$dest_dir"

          cp "$src" "$dest_dir/summary.json"

          cd brlcad_performance_dashboard

          git config user.name "brlcad-performance-bot"
          git config user.email "brlcad-performance-bot@users.noreply.github.com"

          git add "data/runs/${run_id}/summary.json"

          if git diff --cached --quiet; then
            echo "No dashboard changes to commit."
            exit 0
          fi

          git commit -m "Add BRL-CAD performance summary ${run_id}"
          git push
~~~

---

## 5. Expected dashboard repo result

After a successful performance run, the dashboard repo should receive a commit adding:

~~~text
data/runs/2026-05-12T030000Z-abcdef123456/summary.json
~~~

The dashboard repo can then run its own workflow on push to validate, update, and deploy the github.io site
