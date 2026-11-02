#!/usr/bin/env bash
# Manage who can sign in to Limn RGM (both the original page limn-rgm and the agentic release limn-rgm-v2).
# Run from Cloud Shell or anywhere gcloud is signed in. Works with macOS's built-in bash.
#
#   ./users.sh list              show every login and whether it is on or off
#   ./users.sh add <name>        create a login; prints a new password once
#   ./users.sh off <name>        turn that person's access off (login is kept)
#   ./users.sh on <name>         turn it back on (same password as before)
#   ./users.sh reset <name>      give them a new password (and turn access on)
#   ./users.sh remove <name>     delete the login entirely
#
# Logins live in the Secret Manager secret "limn-rgm-users" as password hashes only.
# Each change takes effect in about 30 seconds; no rebuild is needed.
set -euo pipefail

PROJECT="${PROJECT:-project-41b9f044-cbc3-4d0e-bec}"
REGION="${REGION:-us-central1}"
SERVICES="${SERVICES:-limn-rgm-v2 limn-rgm}"     # the first one is the link printed for new logins
SECRET="limn-rgm-users"

usage(){ sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
CMD="${1:-}"; NAME="${2:-}"
[ -n "$CMD" ] || usage

TMP="$(mktemp)"; trap 'rm -f "$TMP" "$TMP.new"' EXIT

fetch(){
  if ! gcloud secrets versions access latest --secret "$SECRET" --project "$PROJECT" > "$TMP" 2>/dev/null; then
    echo "Couldn't read the logins secret $SECRET in project $PROJECT." >&2; exit 1
  fi
}
check_name(){
  echo "$NAME" | grep -Eq '^[a-z0-9_-]{2,32}$' || { echo "Use a name of 2 to 32 lowercase letters, digits, - or _ (for example: jsmith)." >&2; exit 1; }
}
exists(){ grep -Eq "^(#off )?${NAME}:" "$TMP"; }
new_password(){ openssl rand -base64 24 | tr -d '/+=' | cut -c1-16; }

save(){
  local msg="$1"
  gcloud secrets versions add "$SECRET" --data-file="$TMP.new" --project "$PROJECT" >/dev/null
  # Keep the two newest versions, destroy older ones.
  gcloud secrets versions list "$SECRET" --project "$PROJECT" --filter="state=ENABLED" \
    --sort-by="~createTime" --format="value(name)" | tail -n +3 | while read -r v; do
      gcloud secrets versions destroy "$v" --secret "$SECRET" --project "$PROJECT" --quiet >/dev/null
    done
  # Roll a new revision of each service so every instance picks up the change right away.
  echo "Applying (about 30 seconds)..."
  for s in $SERVICES; do
    if gcloud run services describe "$s" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
      gcloud run services update "$s" --region "$REGION" --project "$PROJECT" \
        --update-env-vars "ACCESS_UPDATED=$(date +%s)" --quiet >/dev/null
    fi
  done
  echo "$msg"
}

link(){
  for s in $SERVICES; do
    u="$(gcloud run services describe "$s" --region "$REGION" --project "$PROJECT" --format 'value(status.url)' 2>/dev/null || true)"
    [ -n "$u" ] && { echo "$u"; return; }
  done
}

case "$CMD" in
  list)
    fetch
    echo "Login                State"
    awk '
      /^#off / { sub(/^#off /, ""); split($0, a, ":"); printf "%-20s off\n", a[1]; next }
      /^#/ || NF == 0 { next }
      { split($0, a, ":"); printf "%-20s on\n", a[1] }' "$TMP"
    ;;
  add)
    check_name; fetch
    if exists; then echo "$NAME already exists. Use: ./users.sh reset $NAME" >&2; exit 1; fi
    PW="$(new_password)"
    cp "$TMP" "$TMP.new"; printf '%s:%s\n' "$NAME" "$(openssl passwd -apr1 "$PW")" >> "$TMP.new"
    save "Created $NAME."
    printf '\nShare these (password is shown only once):\n  Link:     %s\n  Username: %s\n  Password: %s\n' "$(link)" "$NAME" "$PW"
    ;;
  off)
    check_name; fetch
    exists || { echo "No login called $NAME." >&2; exit 1; }
    if grep -q "^#off ${NAME}:" "$TMP"; then echo "$NAME is already off."; exit 0; fi
    sed -E "s/^${NAME}:/#off ${NAME}:/" "$TMP" > "$TMP.new"
    save "$NAME can no longer sign in. Turn back on with: ./users.sh on $NAME"
    ;;
  on)
    check_name; fetch
    exists || { echo "No login called $NAME." >&2; exit 1; }
    if grep -q "^${NAME}:" "$TMP"; then echo "$NAME is already on."; exit 0; fi
    sed -E "s/^#off ${NAME}:/${NAME}:/" "$TMP" > "$TMP.new"
    save "$NAME can sign in again with their existing password."
    ;;
  reset)
    check_name; fetch
    exists || { echo "No login called $NAME. Use: ./users.sh add $NAME" >&2; exit 1; }
    PW="$(new_password)"
    grep -Ev "^(#off )?${NAME}:" "$TMP" > "$TMP.new" || true
    printf '%s:%s\n' "$NAME" "$(openssl passwd -apr1 "$PW")" >> "$TMP.new"
    save "New password set for $NAME; their old password no longer works."
    printf '\n  Username: %s\n  Password: %s   (shown only once)\n' "$NAME" "$PW"
    ;;
  remove)
    check_name; fetch
    exists || { echo "No login called $NAME." >&2; exit 1; }
    grep -Ev "^(#off )?${NAME}:" "$TMP" > "$TMP.new" || true
    save "Removed $NAME."
    ;;
  *) usage ;;
esac
