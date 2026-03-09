#!/usr/bin/env bash
# service.sh — Install / uninstall / status for network-profiler systemd service
set -euo pipefail

SERVICE_NAME="network-profiler"
INSTALL_DIR="/opt/network-profiler"
DATA_DIR="/var/lib/network-profiler"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_FILE="/etc/sysconfig/${SERVICE_NAME}"
DEFAULT_USER="netprofiler"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Defaults matching network_profiler.py ---
DEFAULT_PORT=8065
DEFAULT_INTERVAL=2

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo ":: $*"; }

need_root() {
    [[ $EUID -eq 0 ]] || die "This command must be run as root (use sudo)."
}

check_source_files() {
    [[ -f "${SCRIPT_DIR}/network_profiler.py" ]] || die "network_profiler.py not found in ${SCRIPT_DIR}"
    [[ -f "${SCRIPT_DIR}/requirements.txt" ]]    || die "requirements.txt not found in ${SCRIPT_DIR}"
}

# ---------------------------------------------------------------------------
# install
# ---------------------------------------------------------------------------

cmd_install() {
    local port="${DEFAULT_PORT}"
    local interval="${DEFAULT_INTERVAL}"
    local targets=""
    local dns_domains=""
    local run_user="${DEFAULT_USER}"
    local reset_on_shutdown=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --port)        port="$2";        shift 2 ;;
            --interval)    interval="$2";    shift 2 ;;
            --targets)     targets="$2";     shift 2 ;;
            --dns-domains) dns_domains="$2"; shift 2 ;;
            --user)        run_user="$2";    shift 2 ;;
            --reset-on-shutdown) reset_on_shutdown=true; shift 1 ;;
            *) die "Unknown install option: $1" ;;
        esac
    done

    need_root
    check_source_files
    command -v python3 >/dev/null 2>&1 || die "python3 not found in PATH"

    # 1. Stop existing service if running (for re-install / update)
    if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
        info "Stopping existing ${SERVICE_NAME} service …"
        systemctl stop "${SERVICE_NAME}"
    fi

    # 2. Create system user (idempotent)
    if [[ "${run_user}" == "${DEFAULT_USER}" ]]; then
        if ! id "${run_user}" &>/dev/null; then
            info "Creating system user ${run_user} …"
            useradd --system --no-create-home --shell /usr/sbin/nologin "${run_user}"
        fi
    else
        id "${run_user}" &>/dev/null || die "User '${run_user}' does not exist"
    fi

    # 3. Create directories
    info "Creating directories …"
    mkdir -p "${INSTALL_DIR}" "${DATA_DIR}"
    chown "${run_user}:${run_user}" "${DATA_DIR}"

    # 4. Copy application files
    info "Copying application files …"
    cp "${SCRIPT_DIR}/network_profiler.py" "${INSTALL_DIR}/"
    cp "${SCRIPT_DIR}/requirements.txt"    "${INSTALL_DIR}/"

    if [[ -d "${SCRIPT_DIR}/frontend/dist" ]]; then
        mkdir -p "${INSTALL_DIR}/frontend"
        # Use cp -a to preserve structure; remove old dist first for clean update
        rm -rf "${INSTALL_DIR}/frontend/dist"
        cp -a "${SCRIPT_DIR}/frontend/dist" "${INSTALL_DIR}/frontend/dist"
    else
        info "Warning: frontend/dist/ not found — dashboard will use embedded HTML fallback"
    fi

    # 5. Create venv + install dependencies
    info "Setting up Python virtual environment …"
    python3 -m venv "${INSTALL_DIR}/venv"
    "${INSTALL_DIR}/venv/bin/pip" install --upgrade pip --quiet
    "${INSTALL_DIR}/venv/bin/pip" install -r "${INSTALL_DIR}/requirements.txt" --quiet
    info "Python dependencies installed."

    # 6. Write environment config file
    info "Writing config to ${ENV_FILE} …"
    mkdir -p "$(dirname "${ENV_FILE}")"
    cat > "${ENV_FILE}" <<ENVEOF
# network-profiler service configuration
# Edit this file then: sudo systemctl restart ${SERVICE_NAME}
PORT=${port}
INTERVAL=${interval}
DB=${DATA_DIR}/network_profile.db
OUTPUT=${DATA_DIR}/network_profile.html
TARGETS=${targets}
DNS_DOMAINS=${dns_domains}
ENVEOF

    # 7. Write systemd unit file
    info "Writing systemd unit file …"
    cat > "${UNIT_FILE}" <<'UNITEOF'
[Unit]
Description=Network Profiler — continuous network monitor with web dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/sysconfig/network-profiler

ExecStart=/bin/bash -c '\
    ARGS="--port $PORT --interval $INTERVAL --db $DB --output $OUTPUT"; \
    [ -n "$TARGETS" ]     && ARGS="$ARGS --targets $TARGETS"; \
    [ -n "$DNS_DOMAINS" ] && ARGS="$ARGS --dns-domains $DNS_DOMAINS"; \
    exec /opt/network-profiler/venv/bin/python /opt/network-profiler/network_profiler.py $ARGS'

KillSignal=SIGINT
TimeoutStopSec=30
Restart=on-failure
RestartSec=5

WorkingDirectory=/var/lib/network-profiler

# Security hardening
ProtectSystem=strict
ReadWritePaths=/var/lib/network-profiler
ProtectHome=yes
PrivateTmp=yes
NoNewPrivileges=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK

UNITEOF

    # Inject the User= line (can't use variable inside heredoc with 'UNITEOF')
    sed -i "/^\[Service\]$/a User=${run_user}" "${UNIT_FILE}"

    if [[ "${reset_on_shutdown}" == true ]]; then
        cat >> "${UNIT_FILE}" <<'RESETEOF'

# Clean up database and output when service stops/shuts down
ExecStopPost=-/bin/rm -f ${DB} ${OUTPUT}
RESETEOF
    fi

    # Append [Install] section
    cat >> "${UNIT_FILE}" <<'INSTALLEOF'
[Install]
WantedBy=multi-user.target
INSTALLEOF

    # 8. Restore SELinux contexts if applicable
    if command -v restorecon &>/dev/null; then
        info "Restoring SELinux contexts …"
        restorecon -R "${INSTALL_DIR}" "${DATA_DIR}" "${UNIT_FILE}" "${ENV_FILE}"
    fi

    # 9. Enable and start
    info "Enabling and starting ${SERVICE_NAME} …"
    systemctl daemon-reload
    systemctl enable "${SERVICE_NAME}"
    systemctl start "${SERVICE_NAME}"

    # Brief pause then verify
    sleep 2
    if systemctl is-active --quiet "${SERVICE_NAME}"; then
        info "Service ${SERVICE_NAME} is running."
        echo ""
        echo "  Dashboard:  http://localhost:${port}"
        echo "  Config:     ${ENV_FILE}"
        echo "  Data dir:   ${DATA_DIR}"
        echo "  Logs:       journalctl -u ${SERVICE_NAME} -f"
        echo ""
    else
        echo ""
        echo "WARNING: Service did not start successfully. Check logs with:"
        echo "  journalctl -u ${SERVICE_NAME} --no-pager -n 40"
        echo ""
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# uninstall
# ---------------------------------------------------------------------------

cmd_uninstall() {
    local purge=false
    local remove_user=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --purge)       purge=true;       shift ;;
            --remove-user) remove_user=true; shift ;;
            *) die "Unknown uninstall option: $1" ;;
        esac
    done

    need_root

    # 1. Stop and disable
    if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
        info "Stopping ${SERVICE_NAME} …"
        systemctl stop "${SERVICE_NAME}"
    fi
    if systemctl is-enabled --quiet "${SERVICE_NAME}" 2>/dev/null; then
        info "Disabling ${SERVICE_NAME} …"
        systemctl disable "${SERVICE_NAME}"
    fi

    # 2. Remove unit file
    if [[ -f "${UNIT_FILE}" ]]; then
        info "Removing unit file …"
        rm -f "${UNIT_FILE}"
        systemctl daemon-reload
    fi

    # 3. Remove config
    if [[ -f "${ENV_FILE}" ]]; then
        info "Removing config file …"
        rm -f "${ENV_FILE}"
    fi

    # 4. Remove install dir
    if [[ -d "${INSTALL_DIR}" ]]; then
        info "Removing ${INSTALL_DIR} …"
        rm -rf "${INSTALL_DIR}"
    fi

    # 5. Purge data
    if [[ "${purge}" == true ]]; then
        if [[ -d "${DATA_DIR}" ]]; then
            info "Purging data directory ${DATA_DIR} …"
            rm -rf "${DATA_DIR}"
        fi
    else
        if [[ -d "${DATA_DIR}" ]]; then
            info "Data directory preserved at ${DATA_DIR} (use --purge to remove)"
        fi
    fi

    # 6. Remove user
    if [[ "${remove_user}" == true ]]; then
        if id "${DEFAULT_USER}" &>/dev/null; then
            info "Removing user ${DEFAULT_USER} …"
            userdel "${DEFAULT_USER}"
        fi
    fi

    info "Uninstall complete."
}

# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

cmd_status() {
    if [[ -f "${UNIT_FILE}" ]]; then
        systemctl status "${SERVICE_NAME}" --no-pager || true
    else
        echo "${SERVICE_NAME} is not installed (no unit file found)."
    fi

    # Show config if present
    if [[ -f "${ENV_FILE}" ]]; then
        echo ""
        echo "Config (${ENV_FILE}):"
        sed 's/^/  /' "${ENV_FILE}"
    fi
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: service.sh <command> [options]

Commands:
  install     Install network-profiler as a systemd service
  uninstall   Remove the systemd service
  status      Show service status and config

Install options:
  --port PORT           HTTP port (default: ${DEFAULT_PORT})
  --interval SECS       Seconds between ping rounds (default: ${DEFAULT_INTERVAL})
  --targets "h1 h2"    Hosts/IPs to ping
  --dns-domains "d1 d2" Domains for DNS tests
  --user USER           Run as USER instead of ${DEFAULT_USER}
  --reset-on-shutdown   Delete DB and HTML files on service stop/shutdown

Uninstall options:
  --purge               Also remove data in ${DATA_DIR}
  --remove-user         Remove the ${DEFAULT_USER} system user
EOF
}

case "${1:-}" in
    install)   shift; cmd_install "$@" ;;
    uninstall) shift; cmd_uninstall "$@" ;;
    status)    shift; cmd_status "$@" ;;
    -h|--help) usage ;;
    *)         usage; exit 1 ;;
esac
