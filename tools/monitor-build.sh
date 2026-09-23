#!/usr/bin/env bash
# Live monitor for the Jenkins job "build-mcp-server".
# Streams real-time console messages as a build runs, with the
# key stage confirmations highlighted. Works every run.
# Usage:  ./tools/monitor-build.sh            # newest build
#         ./tools/monitor-build.sh <build#>   # a specific build
set -u
JENKINS="http://localhost:8090"
JOB="build-mcp-server"

BUILD="${1:-}"
if [ -z "$BUILD" ]; then
  BUILD=$(curl -s "${JENKINS}/job/${JOB}/lastBuild/buildNumber")
fi
URL="${JENKINS}/job/${JOB}/${BUILD}"

echo "== Watching build #${BUILD} — http://localhost:8090/job/${JOB}/${BUILD}/console =="
echo "   Press Ctrl+C to stop."

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
OFFSET=0
while true; do
  STATE=$(curl -s "${URL}/api/json?tree=building,result" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["building"],"|",d["result"])' 2>/dev/null || echo "false | ?")
  BUILDING=$(echo "$STATE" | cut -d'|' -f1 | tr -d ' ')
  RES=$(echo "$STATE" | cut -d'|' -f2 | tr -d ' ')

  TEXT=$(curl -s "${URL}/consoleText")
  SIZE=${#TEXT}
  if [ "$SIZE" -gt "$OFFSET" ]; then
    DELTA="${TEXT:$OFFSET}"
    OFFSET=$SIZE
    while IFS= read -r line; do
      [ -z "${line//[$'\t\r\n ']/}" ] && continue
      case "$line" in
        *"PASS:"*|*"Test passed."*) echo "# ${GREEN}${line}${RESET}";;
        *"Building image"*|*"Updating mcp-server"*|*"Tagging for registry"*) echo "# ${YELLOW}${line}${RESET}";;
        *"digest:"*|*"Finished:"*) echo "# ${GREEN}${line}${RESET}";;
        *"FAIL"*|*"ERROR"*) echo "# ${RED}${line}${RESET}";;
        *"stage("*|*"[Pipeline] { ("*) ;;
        "[Pipeline] "*) ;;
        "+ echo"*|"+ docker"*|"+ npm"*|"+ node"*) ;;
        *) echo "  ${line}";;
      esac
    done <<< "$DELTA"
  fi

  if [ "$BUILDING" = "false" ]; then
    if [ "$RES" = "SUCCESS" ]; then echo; echo "# ${GREEN}>>> Build #${BUILD} FINISHED: SUCCESS${RESET}"
    elif [ "$RES" = "FAILURE" ]; then echo; echo "# ${RED}>>> Build #${BUILD} FINISHED: FAILURE${RESET}"
    else echo; echo "# >>> Build #${BUILD} FINISHED: ${RES:-?}"
    fi
    exit 0
  fi
  sleep 2
done