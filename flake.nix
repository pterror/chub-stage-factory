{
  description = "chub-stage-factory - Self-contained Claude Code workspace for designing and shipping a Chub stage";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        chub-proxy = pkgs.writeShellScriptBin "chub-proxy" ''
          set -euo pipefail

          NETNS=""
          PORT=1080

          while [ $# -gt 0 ]; do
            case "$1" in
              --port)
                PORT="$2"
                shift 2
                ;;
              --port=*)
                PORT="''${1#--port=}"
                shift
                ;;
              -h|--help)
                echo "Usage: chub-proxy <netns-name> [--port PORT]"
                exit 0
                ;;
              *)
                if [ -z "$NETNS" ]; then
                  NETNS="$1"
                  shift
                else
                  echo "Unexpected argument: $1" >&2
                  exit 1
                fi
                ;;
            esac
          done

          if [ -z "$NETNS" ]; then
            echo "Usage: chub-proxy <netns-name> [--port PORT]" >&2
            exit 1
          fi

          MICROSOCKS_PID=""
          SOCAT_PID=""

          cleanup() {
            trap - INT TERM EXIT
            if [ -n "$SOCAT_PID" ] && kill -0 "$SOCAT_PID" 2>/dev/null; then
              sudo kill "$SOCAT_PID" 2>/dev/null || true
            fi
            if [ -n "$MICROSOCKS_PID" ] && kill -0 "$MICROSOCKS_PID" 2>/dev/null; then
              sudo kill "$MICROSOCKS_PID" 2>/dev/null || true
            fi
          }
          trap cleanup INT TERM EXIT

          sudo ip netns exec "$NETNS" ${pkgs.microsocks}/bin/microsocks -p "$PORT" &
          MICROSOCKS_PID=$!

          sleep 0.5

          sudo ${pkgs.socat}/bin/socat TCP-LISTEN:"$PORT",fork,reuseaddr \
            EXEC:"ip netns exec $NETNS ${pkgs.socat}/bin/socat STDIO TCP:127.0.0.1:$PORT" &
          SOCAT_PID=$!

          echo "CHUB_PROXY=socks5://localhost:$PORT"

          wait "$MICROSOCKS_PID" "$SOCAT_PID"
        '';
      in
      {
        packages.chub-proxy = chub-proxy;

        devShells.default = pkgs.mkShell rec {
          buildInputs = with pkgs; [
            stdenv.cc.cc
            nodejs_latest
            bun
            microsocks
            socat
            chub-proxy
          ];
          LD_LIBRARY_PATH = "${pkgs.lib.makeLibraryPath buildInputs}:$LD_LIBRARY_PATH";
        };
      }
    );
}
