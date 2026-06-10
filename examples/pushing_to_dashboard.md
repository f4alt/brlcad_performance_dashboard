# Connect a BRL-CAD performance runner to the dashboard repo

This repo ingests incoming results committed to its inbox:

~~~text
data/to_process/<run-id>/summary.json
~~~

A push to `data/to_process/**/summary.json` triggers the dashboard's
`ingest_and_deploy.yml` workflow, which validates the summary, appends it to the durable
master log, prunes the inbox, and redeploys the site. `<run-id>` is any unique directory
name (a `<timestamp>-<short-sha>` works well); the canonical identity actually used for
de-duplication is `run.id` **inside** the summary, so make sure that is set.

## 1. Create a dedicated SSH deploy key

Run locally:

~~~bash
ssh-keygen -t ed25519 -C "brlcad-performance-dashboard-deploy" -f brlcad_dashboard_deploy_key
~~~

This creates `brlcad_dashboard_deploy_key` (private) and `brlcad_dashboard_deploy_key.pub`
(public). Do not commit either file.

---

## 2. Add the public key to the dashboard (this) repo

In GitHub:

~~~text
  -> Settings
  -> Deploy keys
  -> Add deploy key   (enable "Allow write access" — the sender pushes commits here)
~~~

---

## 3. Add the private key to the sending repo's secrets

In GitHub:

~~~text
  -> Settings
  -> Secrets and variables
  -> Actions
  -> New repository secret      (e.g. DASHBOARD_DEPLOY_KEY)
~~~

---

## 4. Add this publish block to the sender's workflow

Place it after the step that produces the run's `summary.json`
(here `$RESULTS_ROOT/summary/run.json`):

~~~yaml
      - name: Checkout dashboard repo
        if: always()
        uses: actions/checkout@v4
        with:
          repository: f4alt/brlcad_performance_dashboard
          path: brlcad_performance_dashboard
          ssh-key: ${{ secrets.DASHBOARD_DEPLOY_KEY }}

      - name: Publish performance summary to dashboard inbox
        if: always()
        run: |
          set -Eeuo pipefail

          src="$RESULTS_ROOT/summary/run.json"
          test -f "$src"

          short_sha="${GITHUB_SHA::12}"
          timestamp="$(date -u +'%Y-%m-%dT%H%M%SZ')"
          run_id="${timestamp}-${short_sha}"

          dest_dir="brlcad_performance_dashboard/data/to_process/${run_id}"
          mkdir -p "$dest_dir"
          cp "$src" "$dest_dir/summary.json"

          cd brlcad_performance_dashboard

          git config user.name "brlcad-performance-bot"
          git config user.email "brlcad-performance-bot@users.noreply.github.com"

          git add "data/to_process/${run_id}/summary.json"

          if git diff --cached --quiet; then
            echo "No dashboard changes to commit."
            exit 0
          fi

          git commit -m "Add BRL-CAD performance summary ${run_id}"
          git push
~~~

---

## 5. Expected result

After a successful run the dashboard repo receives a commit adding:

~~~text
data/to_process/2026-05-12T030000Z-abcdef123456/summary.json
~~~

That push triggers `ingest_and_deploy.yml`, which moves the data into
`data/master/results.jsonl`, deletes the inbox entry, regenerates the derived dashboard
data, and deploys the github.io site. If the summary fails validation it is left in
`data/to_process/` and the run is marked red (the rest of the dashboard still deploys).
